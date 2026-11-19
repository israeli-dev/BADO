import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/features/auth/AuthContext';
import { badoDb } from '@/lib/db/badoDb';
import {
  listInstitutionSyncQueue,
  retrySyncOperation,
} from '@/lib/sync/syncQueue';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';
import type { CacheMetaRecord, SyncStatus } from '@/types/domain';

const STATUS_BADGE: Record<SyncStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'info' },
  syncing: { label: 'Syncing', tone: 'info' },
  synced: { label: 'Synced', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  requires_review: { label: 'Requires Review', tone: 'warning' },
};

export function SyncQueuePage() {
  const { activeInstitution } = useAuth();
  const isOnline = useOnlineStatus();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const institutionId = activeInstitution?.id ?? '';

  const queueItems = useLiveQuery(
    () =>
      institutionId
        ? listInstitutionSyncQueue(institutionId)
        : Promise.resolve([]),
    [institutionId],
  );

  const cacheEntries = useLiveQuery(
    async (): Promise<CacheMetaRecord[]> => {
      if (!institutionId) return [];
      return badoDb.cacheMeta.where('institutionId').equals(institutionId).toArray();
    },
    [institutionId],
  );

  const handleRetry = async (id: string) => {
    setErrorMessage(null);
    try {
      await retrySyncOperation(id, institutionId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to retry operation.',
      );
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Offline Storage &amp; Synchronisation Queue
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Inspect locally queued field operations and cached reference data freshness.
        </p>
      </div>

      {!isOnline && (
        <Alert tone="warning" title="Working Offline">
          Internet connectivity is currently unavailable. Locally captured records
          stay safely stored in IndexedDB with their original field timestamps until
          connectivity returns.
        </Alert>
      )}

      <Alert tone="warning" title="Route sync is limited">
        Supported point assets, routes, depth observations and photos captured by the same signed-in user are sent when online. Failed items must be requeued; conflicts require review and cannot yet be resolved here. Documents, other operations and older records without capture-user information are not automatically uploaded. Keep this device and its browser data; Supabase integration testing is still required.
      </Alert>
      {errorMessage && <Alert tone="danger">{errorMessage}</Alert>}

      <Card
        title="Queued Field Operations"
        description="Scoped strictly to the active institution. Route conflicts are marked Requires Review; unsupported records remain on this device."
      >
        {!queueItems || queueItems.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Synchronisation queue is clear"
            description="No pending, failed, or conflicting local operations exist for this institution."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {queueItems.map((item) => {
              const badge = STATUS_BADGE[item.status];
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <span className="text-sm font-semibold text-slate-900">
                        {item.operationType.toUpperCase()} · {item.recordType}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        Retries: {item.retryCount}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-500">
                      Mutation UUID: {item.id} · Captured:{' '}
                      {new Date(item.capturedAt).toLocaleString()}
                    </p>
                    {item.errorDetails && (
                      <p className="text-xs font-medium text-red-700">
                        Error: {item.errorDetails}
                      </p>
                    )}
                  </div>
                  {item.status === 'failed' && (
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                      onClick={() => void handleRetry(item.id)}
                    >
                      Requeue
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Local Reference Cache Freshness"
        description="Timestamps of the most recent local cache update per institutional dataset."
      >
        {!cacheEntries || cacheEntries.length === 0 ? (
          <p className="text-sm text-slate-500">
            No cached datasets recorded yet for this session.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cacheEntries.map((entry) => (
              <div
                key={entry.key}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {entry.scope}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {entry.recordCount} record{entry.recordCount === 1 ? '' : 's'}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Synced {new Date(entry.syncedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
