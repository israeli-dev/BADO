// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import { enqueueSyncOperation } from '@/lib/sync/syncQueue';
import { replayDocument, type DocumentReplayTransport } from '@/lib/sync/documentReplay';
import type { AssetDocumentRecord } from '@/types/domain';

const institutionId = 'institution';
const assetId = 'asset';
const doc: AssetDocumentRecord = {
  id: 'document', institutionId, assetId, storagePath: 'institution/campus/asset/docs/document_test.pdf', fileName: 'test.pdf', mimeType: 'application/pdf', fileSizeBytes: 3, documentKind: 'other', title: 'Test plan', description: null, uploadedBy: null, createdAt: '2026-01-01T00:00:00.000Z', localBlobId: 'blob',
};
const serverRow = { id: doc.id, institution_id: institutionId, asset_id: assetId, storage_path: doc.storagePath, file_name: doc.fileName, mime_type: doc.mimeType, file_size_bytes: 3, document_kind: doc.documentKind, title: doc.title, description: null, uploaded_by: null, created_at: doc.createdAt };
describe('offline document replay', () => {
  beforeEach(async () => { await badoDb.delete(); await badoDb.open(); await badoDb.assetDocuments.put(doc); await badoDb.localMediaBlobs.put({ id: 'blob', institutionId, assetId, mediaKind: 'document', fileName: doc.fileName, mimeType: doc.mimeType, blob: new Blob(['abc'], { type: doc.mimeType }), createdAt: doc.createdAt }); });
  async function item() { return enqueueSyncOperation({ institutionId, actorUserId: 'user', campusId: 'campus', recordType: 'asset_documents', recordId: doc.id, operationType: 'upload_document', payload: { localBlobId: 'blob', meta: doc } }); }
  function transport(): DocumentReplayTransport { return { upload: vi.fn().mockResolvedValue(null), download: vi.fn().mockResolvedValue(new Blob(['abc'])), insert: vi.fn().mockResolvedValue(null), find: vi.fn().mockResolvedValue(serverRow) }; }
  it('uploads bytes and metadata', async () => { const t = transport(); await replayDocument(await item(), t); expect(t.upload).toHaveBeenCalledOnce(); expect(t.insert).toHaveBeenCalledOnce(); });
  it('confirms matching bytes and metadata on a lost response', async () => { const t = transport(); vi.mocked(t.upload).mockResolvedValue({ status: 409, message: 'exists' }); vi.mocked(t.insert).mockResolvedValue({ code: '23505', message: 'exists' }); await replayDocument(await item(), t); expect(t.download).toHaveBeenCalledOnce(); expect(t.find).toHaveBeenCalledOnce(); });
  it('rejects different existing bytes before writing metadata', async () => { const t = transport(); vi.mocked(t.upload).mockResolvedValue({ status: 409, message: 'exists' }); vi.mocked(t.download).mockResolvedValue(new Blob(['bad'])); await expect(replayDocument(await item(), t)).rejects.toThrow(/different file/); expect(t.insert).not.toHaveBeenCalled(); });
  it('rejects conflicting metadata', async () => { const t = transport(); vi.mocked(t.insert).mockResolvedValue({ code: '23505', message: 'exists' }); vi.mocked(t.find).mockResolvedValue({ ...serverRow, title: 'different' }); await expect(replayDocument(await item(), t)).rejects.toThrow(/conflicts/); });
  it('rejects missing or wrong-tenant local bytes', async () => { const t = transport(); await badoDb.localMediaBlobs.update('blob', { institutionId: 'other' }); await expect(replayDocument(await item(), t)).rejects.toThrow(/unavailable/); expect(t.upload).not.toHaveBeenCalled(); });
  it('does not treat authorization errors as duplicates', async () => { const t = transport(); const error = { status: 403, message: 'denied' }; vi.mocked(t.upload).mockResolvedValue(error); await expect(replayDocument(await item(), t)).rejects.toEqual(error); expect(t.download).not.toHaveBeenCalled(); });
});
