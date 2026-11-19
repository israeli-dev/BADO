// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import { enqueueSyncOperation } from '@/lib/sync/syncQueue';
import { replayPhoto, type PhotoReplayTransport } from '@/lib/sync/photoReplay';
import type { AssetPhotoRecord } from '@/types/domain';

const institutionId = 'institution';
const assetId = 'asset';
const photo: AssetPhotoRecord = {
  id: 'photo', institutionId, assetId, observationId: null, storagePath: 'institution/campus/asset/photos/photo_test.jpg', fileName: 'test.jpg', mimeType: 'image/jpeg', fileSizeBytes: 3, widthPx: null, heightPx: null, photoKind: 'exposed_trench', caption: null, capturedAt: '2026-01-01T00:00:00.000Z', uploadedBy: null, createdAt: '2026-01-01T00:00:00.000Z', localBlobId: 'blob',
};
const serverRow = { id: photo.id, institution_id: institutionId, asset_id: assetId, observation_id: null, storage_path: photo.storagePath, file_name: photo.fileName, mime_type: photo.mimeType, file_size_bytes: 3, width_px: null, height_px: null, photo_kind: 'exposed_trench' as const, caption: null, captured_at: photo.capturedAt, uploaded_by: null, created_at: photo.createdAt };
describe('offline photo replay', () => {
  beforeEach(async () => { await badoDb.delete(); await badoDb.open(); await badoDb.assetPhotos.put(photo); await badoDb.localMediaBlobs.put({ id: 'blob', institutionId, assetId, mediaKind: 'photo', fileName: 'test.jpg', mimeType: 'image/jpeg', blob: new Blob(['abc'], { type: 'image/jpeg' }), createdAt: photo.createdAt }); });
  async function item() { return enqueueSyncOperation({ institutionId, actorUserId: 'user', campusId: 'campus', recordType: 'asset_photos', recordId: photo.id, operationType: 'upload_photo', payload: { localBlobId: 'blob', meta: photo } }); }
  function transport(): PhotoReplayTransport { return { upload: vi.fn().mockResolvedValue(null), download: vi.fn().mockResolvedValue(new Blob(['abc'])), insert: vi.fn().mockResolvedValue(null), find: vi.fn().mockResolvedValue(serverRow) }; }
  it('uploads bytes and metadata', async () => { const t = transport(); await replayPhoto(await item(), t); expect(t.upload).toHaveBeenCalledOnce(); expect(t.insert).toHaveBeenCalledOnce(); });
  it('verifies matching bytes and metadata after a lost response', async () => { const t = transport(); vi.mocked(t.upload).mockResolvedValue({ status: 409, message: 'exists' }); vi.mocked(t.insert).mockResolvedValue({ code: '23505', message: 'exists' }); await replayPhoto(await item(), t); expect(t.download).toHaveBeenCalledOnce(); expect(t.find).toHaveBeenCalledOnce(); });
  it('does not accept different bytes on a duplicate path', async () => { const t = transport(); vi.mocked(t.upload).mockResolvedValue({ status: 409, message: 'exists' }); vi.mocked(t.download).mockResolvedValue(new Blob(['bad'])); await expect(replayPhoto(await item(), t)).rejects.toThrow(/different file/); expect(t.insert).not.toHaveBeenCalled(); });
  it('rejects mismatched existing metadata', async () => { const t = transport(); vi.mocked(t.insert).mockResolvedValue({ code: '23505', message: 'exists' }); vi.mocked(t.find).mockResolvedValue({ ...serverRow, asset_id: 'other' }); await expect(replayPhoto(await item(), t)).rejects.toThrow(/conflicts/); });
});
