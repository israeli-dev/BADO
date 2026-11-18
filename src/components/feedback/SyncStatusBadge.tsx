import { clsx } from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getInstitutionSyncSummary } from '@/lib/sync/syncQueue';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';

export function SyncStatusBadge({ institutionId }: { institutionId: string }) {
  const isOnline = useOnlineStatus();
  const summary = useLiveQuery(
    () => getInstitutionSyncSummary(institutionId),
    [institutionId],
  );

  const failedOrConflict = (summary?.failed ?? 0) + (summary?.requiresReview ?? 0);
  const pendingOrSyncing = (summary?.pending ?? 0) + (summary?.syncing ?? 0);

  let label = 'Online · Synced';
  let styleClass =
    'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100';
  let Icon = CheckCircle2;

  if (!isOnline) {
    label =
      pendingOrSyncing > 0
        ? `Offline · ${pendingOrSyncing} queued`
        : 'Offline · Local ready';
    styleClass = 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100';
    Icon = CloudOff;
  } else if (failedOrConflict > 0) {
    label = `${failedOrConflict} sync issue${failedOrConflict === 1 ? '' : 's'}`;
    styleClass = 'border-red-300 bg-red-50 text-red-900 hover:bg-red-100';
    Icon = AlertCircle;
  } else if (pendingOrSyncing > 0) {
    label = `${pendingOrSyncing} pending sync`;
    styleClass = 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100';
    Icon = RefreshCw;
  }

  return (
    <Link
      to="/sync"
      className={clsx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
        styleClass,
      )}
      aria-label={`Synchronisation status: ${label}`}
    >
      <Icon
        className={clsx(
          'h-3.5 w-3.5 shrink-0',
          (summary?.syncing ?? 0) > 0 && 'animate-spin',
        )}
        aria-hidden="true"
      />
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}
