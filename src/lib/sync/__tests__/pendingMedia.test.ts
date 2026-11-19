// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadoLocalDatabase } from '@/lib/db/badoDb';
import { enqueueSyncOperation } from '@/lib/sync/syncQueue';
import { loadPendingMedia } from '@/lib/sync/pendingMedia';
import type { AssetDocumentRecord, AssetPhotoRecord } from '@/types/domain';

let db: BadoLocalDatabase;
const institutionId = 'institution'; const campusId = 'campus'; const actorId = 'user'; const assetId = 'asset';
const photo: AssetPhotoRecord = { id: 'photo', institutionId, assetId, observationId: null, storagePath: 'path', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSizeBytes: 3, widthPx: null, heightPx: null, photoKind: 'overview', caption: 'Trench', capturedAt: '2026-01-01T00:00:00Z', uploadedBy: null, createdAt: '2026-01-01T00:00:00Z', localBlobId: 'photo-blob' };
const document: AssetDocumentRecord = { id: 'document', institutionId, assetId, storagePath: 'path', fileName: 'plan.pdf', mimeType: 'application/pdf', fileSizeBytes: 3, documentKind: 'other', title: 'Plan', description: null, uploadedBy: null, createdAt: '2026-01-01T00:00:00Z', localBlobId: 'document-blob' };
async function queue(record: AssetPhotoRecord | AssetDocumentRecord, actor: string | null = actorId, campus = campusId) {
  const isPhoto = 'photoKind' in record;
  return enqueueSyncOperation({ institutionId, campusId: campus, actorUserId: actor, recordType: isPhoto ? 'asset_photos' : 'asset_documents', operationType: isPhoto ? 'upload_photo' : 'upload_document', recordId: record.id, payload: { localBlobId: record.localBlobId, meta: record } }, db);
}
describe('pending media visibility', () => {
  beforeEach(async () => { db = new BadoLocalDatabase(`pending_media_${crypto.randomUUID()}`); await db.open(); await db.assetPhotos.put(photo); await db.assetDocuments.put(document); await db.localMediaBlobs.bulkPut([{ id: 'photo-blob', institutionId, assetId, mediaKind: 'photo', fileName: photo.fileName, mimeType: photo.mimeType, blob: new Blob(['abc']), createdAt: photo.createdAt }, { id: 'document-blob', institutionId, assetId, mediaKind: 'document', fileName: document.fileName, mimeType: document.mimeType, blob: new Blob(['abc']), createdAt: document.createdAt }]); });
  afterEach(async () => { await db.delete(); });
  it('shows only the current capture user and asset/campus/institution and excludes synced and legacy items', async () => {
    const p = await queue(photo); const doc = await queue(document);
    await queue({ ...photo, id: 'foreign-user' }, 'someone-else');
    await queue({ ...photo, id: 'legacy' }, null);
    await queue({ ...photo, id: 'other-campus' }, actorId, 'other-campus');
    await queue({ ...photo, id: 'other-asset', assetId: 'another' });
    const rows = await loadPendingMedia(institutionId, assetId, campusId, actorId, db);
    expect(rows.map(r => r.recordId).sort()).toEqual(['document', 'photo']);
    expect(rows.find(r => r.queueId === p.id)).toMatchObject({ kind: 'photo', name: 'Trench', status: 'pending' });
    expect(rows.find(r => r.queueId === doc.id)?.blob?.size).toBe(3);
    expect(await loadPendingMedia('other-institution', assetId, campusId, actorId, db)).toEqual([]);
    expect(await loadPendingMedia(institutionId, assetId, campusId, 'other-user', db)).toEqual([]);
    await db.syncQueue.update(p.id, { status: 'synced' });
    await db.syncQueue.update(doc.id, { status: 'failed', errorDetails: 'response lost' });
    expect(await loadPendingMedia(institutionId, assetId, campusId, actorId, db)).toMatchObject([{ recordId: 'document', status: 'failed', errorDetails: 'response lost' }]);
  });
  it('never uses a mismatched blob or missing metadata', async () => {
    await queue(photo); await queue(document);
    await db.localMediaBlobs.update('photo-blob', { institutionId: 'other' });
    await db.assetDocuments.delete(document.id);
    const rows = await loadPendingMedia(institutionId, assetId, campusId, actorId, db);
    expect(rows.find(r => r.recordId === photo.id)?.blob).toBeNull();
    expect(rows.find(r => r.recordId === document.id)).toMatchObject({ name: null, fileName: null, blob: null });
  });
});
