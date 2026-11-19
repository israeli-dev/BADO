import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import type { SyncStatus } from '@/types/domain';

export interface PendingMediaItem {
  queueId: string;
  recordId: string;
  kind: 'photo' | 'document';
  status: Exclude<SyncStatus, 'synced'>;
  name: string | null;
  fileName: string | null;
  blob: Blob | null;
  errorDetails: string | null;
}

/** Local media remains owned by the original capture user, never inferred for legacy entries. */
export async function loadPendingMedia(
  institutionId: string,
  assetId: string,
  campusId: string,
  actorId: string,
  db: BadoLocalDatabase = badoDb,
): Promise<PendingMediaItem[]> {
  if (!institutionId || !assetId || !campusId || !actorId) return [];
  return db.transaction('r', [db.syncQueue, db.assetPhotos, db.assetDocuments, db.localMediaBlobs], async () => {
    const queue = await db.syncQueue.where('institutionId').equals(institutionId).filter(row => {
      const meta = row.payload.meta;
      return row.status !== 'synced' && row.actorUserId === actorId && row.campusId === campusId &&
        ((row.recordType === 'asset_photos' && row.operationType === 'upload_photo') ||
         (row.recordType === 'asset_documents' && row.operationType === 'upload_document')) &&
        !!meta && typeof meta === 'object' && 'assetId' in meta && meta.assetId === assetId;
    }).toArray();
    const items: PendingMediaItem[] = [];
    for (const row of queue) {
      const kind = row.recordType === 'asset_photos' ? 'photo' : 'document';
      const metadata = kind === 'photo' ? await db.assetPhotos.get(row.recordId) : await db.assetDocuments.get(row.recordId);
      const valid = metadata && metadata.institutionId === institutionId && metadata.assetId === assetId &&
        metadata.localBlobId && metadata.localBlobId === row.payload.localBlobId;
      const blobRecord = valid ? await db.localMediaBlobs.get(metadata.localBlobId!) : undefined;
      const blob = blobRecord && blobRecord.institutionId === institutionId && blobRecord.assetId === assetId &&
        blobRecord.mediaKind === kind && blobRecord.mimeType === metadata?.mimeType && blobRecord.blob?.size === metadata?.fileSizeBytes
        ? blobRecord.blob : null;
      items.push({
        queueId: row.id, recordId: row.recordId, kind, status: row.status as Exclude<SyncStatus, 'synced'>,
        name: valid ? ('title' in metadata ? metadata.title : metadata.caption || metadata.fileName) : null,
        fileName: valid ? metadata.fileName : null, blob, errorDetails: row.errorDetails,
      });
    }
    return items.sort((a, b) => a.queueId.localeCompare(b.queueId));
  });
}
