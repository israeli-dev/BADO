import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Json } from '@/types/database';
import type { SyncQueueRecord } from '@/types/domain';

const LEASE_MS = 5 * 60_000;
type Replay = (item: SyncQueueRecord, assetId: string, operation: 'create' | 'update' | 'depth') => Promise<void>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function routeOperation(item: SyncQueueRecord): { assetId: string; operation: 'create' | 'update' | 'depth' } | null {
  if (item.recordType === 'linear_routes' && (item.operationType === 'create' || item.operationType === 'update')) {
    return { assetId: item.recordId, operation: item.operationType };
  }
  if (item.recordType === 'utility_depth_observations' && item.operationType === 'create') {
    const assetId = asObject(item.payload.depthObservationInsert)?.asset_id;
    if (typeof assetId === 'string') return { assetId, operation: 'depth' };
  }
  return null;
}
function entityId(item: SyncQueueRecord): string | null {
  const route = routeOperation(item);
  if (route) return route.assetId;
  if (item.recordType === 'assets' || item.recordType === 'linear_routes') return item.recordId;
  const meta = asObject(item.payload.meta);
  return typeof meta?.assetId === 'string' ? meta.assetId : null;
}
function order(item: SyncQueueRecord): number {
  return item.queueOrder ?? Date.parse(item.createdAt) * 1000;
}

/** Claim one operation, maintaining order for each asset and refusing to guess legacy ownership. */
export async function claimNextRouteMutation(institutionId: string, actorId: string, db: BadoLocalDatabase = badoDb): Promise<SyncQueueRecord | null> {
  return db.transaction('rw', db.syncQueue, async () => {
    const rows = await db.syncQueue.where('institutionId').equals(institutionId).toArray();
    const now = Date.now();
    for (const row of rows) {
      if (row.status === 'syncing' && (!row.lastAttemptAt || now - Date.parse(row.lastAttemptAt) >= LEASE_MS)) {
        row.status = 'pending'; row.claimId = null;
        await db.syncQueue.put(row);
      }
    }
    // One active writer per institution across tabs. Stale attempts may be safely retried
    // because the server commits mutation IDs together with their effects.
    if (rows.some(row => row.status === 'syncing')) return null;
    rows.sort((a, b) => order(a) - order(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const route = routeOperation(row);
      if (!route || row.status !== 'pending' || row.actorUserId !== actorId) continue;
      if (rows.slice(0, i).some(previous => previous.status !== 'synced' && entityId(previous) === route.assetId)) continue;
      const claimed: SyncQueueRecord = { ...row, status: 'syncing', claimId: crypto.randomUUID(), lastAttemptAt: new Date(now).toISOString(), retryCount: row.retryCount + 1, errorDetails: null };
      await db.syncQueue.put(claimed);
      return claimed;
    }
    return null;
  });
}

export async function processRouteQueue(institutionId: string, actorId: string, replay: Replay, db: BadoLocalDatabase = badoDb): Promise<number> {
  let completed = 0;
  while (true) {
    const item = await claimNextRouteMutation(institutionId, actorId, db);
    if (!item) return completed;
    const route = routeOperation(item)!;
    try {
      await replay(item, route.assetId, route.operation);
      await db.transaction('rw', [db.syncQueue, db.assets], async () => {
        const current = await db.syncQueue.get(item.id);
        if (!current || current.claimId !== item.claimId || current.status !== 'syncing') return;
        await db.syncQueue.put({ ...current, status: 'synced', claimId: null, errorDetails: null });
        const remaining = await db.syncQueue.where('institutionId').equals(institutionId)
          .filter(row => row.id !== item.id && row.status !== 'synced' && routeOperation(row)?.assetId === route.assetId && routeOperation(row)?.operation !== 'depth').toArray();
        if (remaining.length === 0) {
          const asset = await db.assets.get(route.assetId);
          if (asset?.institutionId === institutionId && asset.localSyncStatus === 'pending') await db.assets.put({ ...asset, localSyncStatus: 'synced' });
        }
      });
      completed++;
    } catch (error) {
      const problem = error as { code?: string; message?: string };
      await db.transaction('rw', db.syncQueue, async () => {
        const current = await db.syncQueue.get(item.id);
        if (!current || current.claimId !== item.claimId || current.status !== 'syncing') return;
        await db.syncQueue.put({ ...current, status: problem.code === '40001' ? 'requires_review' : 'failed', claimId: null, errorDetails: problem.message ?? 'Could not synchronise route.' });
      });
      // Continue with unrelated assets; subsequent operations on this asset remain blocked.
    }
  }
}

export async function replayRouteToSupabase(item: SyncQueueRecord, assetId: string, operation: 'create' | 'update' | 'depth'): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session?.user.id || item.actorUserId !== session.session.user.id) throw new Error('The original capture user must be signed in to synchronise.');
  const { data, error } = await supabase.rpc('replay_linear_route_mutation', {
    p_mutation_id: item.id, p_institution_id: item.institutionId, p_actor_id: item.actorUserId,
    p_asset_id: assetId, p_operation: operation, p_payload: item.payload as Json, p_base_version: item.baseVersion,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.applied !== true) throw new Error('Server did not confirm the mutation.');
}
