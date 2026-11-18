import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import type {
  CacheMetaRecord,
  SyncOperationType,
  SyncQueueRecord,
  SyncStatus,
} from '@/types/domain';

export interface EnqueueSyncInput {
  /** Optional deterministic UUID for idempotent caller retries; generated if omitted. */
  id?: string;
  institutionId: string;
  campusId?: string | null;
  recordType: string;
  recordId: string;
  operationType: SyncOperationType;
  payload: Record<string, unknown>;
  baseVersion?: number | null;
  /** True field capture time; defaults to current UTC ISO string. */
  capturedAt?: string;
}

export interface SyncStatusSummary {
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  requiresReview: number;
  actionableTotal: number;
}

/**
 * Adds an offline operation to the local IndexedDB synchronisation queue
 * without creating duplicate entries when retried with the same mutation ID
 * or repeated pending `create` for the same entity ID.
 */
export async function enqueueSyncOperation(
  input: EnqueueSyncInput,
  db: BadoLocalDatabase = badoDb,
): Promise<SyncQueueRecord> {
  const now = new Date().toISOString();
  const mutationId = input.id ?? crypto.randomUUID();

  return db.transaction('rw', db.syncQueue, async () => {
    const existingById = await db.syncQueue.get(mutationId);
    if (existingById) {
      return existingById;
    }

    if (input.operationType === 'create') {
      const existingCreate = await db.syncQueue
        .where('[institutionId+recordType+recordId]')
        .equals([input.institutionId, input.recordType, input.recordId])
        .filter(
          (row) =>
            row.operationType === 'create' &&
            (row.status === 'pending' || row.status === 'syncing'),
        )
        .first();

      if (existingCreate) {
        return existingCreate;
      }
    }

    const record: SyncQueueRecord = {
      id: mutationId,
      institutionId: input.institutionId,
      campusId: input.campusId ?? null,
      recordType: input.recordType,
      recordId: input.recordId,
      operationType: input.operationType,
      payload: input.payload,
      baseVersion: input.baseVersion ?? null,
      capturedAt: input.capturedAt ?? now,
      createdAt: now,
      lastAttemptAt: null,
      status: 'pending',
      retryCount: 0,
      errorDetails: null,
      conflictSnapshot: null,
    };

    await db.syncQueue.add(record);
    return record;
  });
}

export async function updateSyncRecordStatus(
  id: string,
  status: SyncStatus,
  options: {
    errorDetails?: string | null;
    conflictSnapshot?: Record<string, unknown> | null;
    incrementRetry?: boolean;
  } = {},
  db: BadoLocalDatabase = badoDb,
): Promise<SyncQueueRecord> {
  return db.transaction('rw', db.syncQueue, async () => {
    const current = await db.syncQueue.get(id);
    if (!current) {
      throw new Error(`Sync queue item "${id}" not found.`);
    }

    const updated: SyncQueueRecord = {
      ...current,
      status,
      lastAttemptAt: new Date().toISOString(),
      retryCount: options.incrementRetry ? current.retryCount + 1 : current.retryCount,
      errorDetails:
        options.errorDetails !== undefined
          ? options.errorDetails
          : status === 'synced'
            ? null
            : current.errorDetails,
      conflictSnapshot:
        options.conflictSnapshot !== undefined
          ? options.conflictSnapshot
          : current.conflictSnapshot,
    };

    await db.syncQueue.put(updated);
    return updated;
  });
}

export async function retrySyncOperation(
  id: string,
  institutionId: string,
  db: BadoLocalDatabase = badoDb,
): Promise<SyncQueueRecord> {
  const current = await db.syncQueue.get(id);
  if (!current || current.institutionId !== institutionId) {
    throw new Error('Sync queue item not found for the active institution.');
  }
  if (current.status !== 'failed') {
    throw new Error(
      `Only failed operations can be auto-retried (current status: ${current.status}).`,
    );
  }
  const updated: SyncQueueRecord = {
    ...current,
    status: 'pending',
    errorDetails: null,
  };
  await db.syncQueue.put(updated);
  return updated;
}

export async function listInstitutionSyncQueue(
  institutionId: string,
  db: BadoLocalDatabase = badoDb,
): Promise<SyncQueueRecord[]> {
  const rows = await db.syncQueue
    .where('institutionId')
    .equals(institutionId)
    .toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getInstitutionSyncSummary(
  institutionId: string,
  db: BadoLocalDatabase = badoDb,
): Promise<SyncStatusSummary> {
  const rows = await db.syncQueue
    .where('institutionId')
    .equals(institutionId)
    .toArray();

  const summary: SyncStatusSummary = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    requiresReview: 0,
    actionableTotal: 0,
  };

  for (const row of rows) {
    switch (row.status) {
      case 'pending':
        summary.pending += 1;
        break;
      case 'syncing':
        summary.syncing += 1;
        break;
      case 'synced':
        summary.synced += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'requires_review':
        summary.requiresReview += 1;
        break;
    }
  }

  summary.actionableTotal =
    summary.pending + summary.syncing + summary.failed + summary.requiresReview;

  return summary;
}

export function buildCacheMetaKey(
  institutionId: string,
  campusId: string | null,
  scope: string,
): string {
  return `${institutionId}:${campusId ?? 'all'}:${scope}`;
}

export async function recordCacheSync(
  institutionId: string,
  campusId: string | null,
  scope: string,
  recordCount: number,
  db: BadoLocalDatabase = badoDb,
): Promise<CacheMetaRecord> {
  const record: CacheMetaRecord = {
    key: buildCacheMetaKey(institutionId, campusId, scope),
    institutionId,
    campusId,
    scope,
    syncedAt: new Date().toISOString(),
    recordCount,
  };
  await db.cacheMeta.put(record);
  return record;
}

export async function getCacheMeta(
  institutionId: string,
  campusId: string | null,
  scope: string,
  db: BadoLocalDatabase = badoDb,
): Promise<CacheMetaRecord | undefined> {
  return db.cacheMeta.get(buildCacheMetaKey(institutionId, campusId, scope));
}
