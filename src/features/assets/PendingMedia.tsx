import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import { loadPendingMedia, type PendingMediaItem } from '@/lib/sync/pendingMedia';

const statusLabels: Record<PendingMediaItem['status'], string> = {
  pending: 'Waiting to sync', syncing: 'Syncing', failed: 'Sync failed', requires_review: 'Requires review',
};

function PendingFile({ item }: { item: PendingMediaItem }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    try {
      if (item.blob instanceof Blob && typeof URL.createObjectURL === 'function') created = URL.createObjectURL(item.blob);
    } catch { /* Missing, invalid or unsupported Blob; leave the queue item intact. */ }
    setUrl(created);
    return () => { if (created) URL.revokeObjectURL(created); };
  }, [item.blob]);
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-900">{item.name || `${item.kind === 'photo' ? 'Photo' : 'Document'} metadata unavailable`}</span>
        <Badge tone={item.status === 'failed' || item.status === 'requires_review' ? 'warning' : 'info'}>{statusLabels[item.status]}</Badge>
      </div>
      <p className="text-xs text-slate-600">{item.kind === 'photo' ? 'Photo' : 'Document'} · saved on this device; server confirmation is pending.</p>
      {item.kind === 'photo' && url && <img src={url} alt={item.name || item.fileName || 'Locally saved photo'} className="h-32 max-w-full rounded-md object-cover" />}
      {url && item.fileName && <a href={url} download={item.fileName} className="inline-block text-xs font-semibold text-bado-navy-800 underline underline-offset-2">Download local copy</a>}
      {!url && <p className="text-xs text-amber-800">Local file preview is unavailable. Keep this device and check the sync queue.</p>}
      {item.errorDetails && <p className="text-xs text-red-700">{item.errorDetails}</p>}
    </li>
  );
}

export function PendingMedia({ institutionId, assetId, campusId, actorId, db = badoDb }: {
  institutionId: string; assetId: string; campusId: string; actorId: string; db?: BadoLocalDatabase;
}) {
  const items = useLiveQuery(() => loadPendingMedia(institutionId, assetId, campusId, actorId, db), [institutionId, assetId, campusId, actorId, db]);
  if (!items?.length) return null;
  return (
    <Card title={`Media awaiting confirmation (${items.length})`} description="Only captures made by your signed-in account are shown here.">
      <p className="mb-3 text-xs text-slate-600">These files are stored on this device. A failed or interrupted upload may already exist on the server; do not upload another copy or clear browser data. Check the <Link to="/sync" className="font-semibold underline">sync queue</Link> for status and retries.</p>
      <ul className="divide-y divide-slate-100">{items.map(item => <PendingFile key={item.queueId} item={item} />)}</ul>
    </Card>
  );
}
