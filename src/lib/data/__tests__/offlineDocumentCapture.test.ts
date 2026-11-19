import { beforeEach, describe, expect, it, vi } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import type { AssetRecord } from '@/types/domain';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ auth }) }));
import { SupabaseDataGateway } from '@/lib/data/supabaseGateway';

const institutionId = '11111111-1111-4111-8111-111111111101';
const assetId = '77777777-7777-4777-8777-777777777701';
const campusId = '22222222-2222-4222-8222-222222222201';
const gateway = new SupabaseDataGateway();
const input = () => ({ assetId, file: new File(['test'], 'test.pdf', { type: 'application/pdf' }), title: 'Test document', documentKind: 'other' as const, saveOffline: true });
describe('offline document capture', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await badoDb.delete(); await badoDb.open();
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
    await badoDb.assets.put({ id: assetId, institutionId, campusId, archivedAt: null } as AssetRecord);
  });
  it('stores document, bytes, and actor-bound queue entry together', async () => {
    const saved = await gateway.uploadAssetDocument(institutionId, input());
    const entries = await badoDb.syncQueue.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorUserId: 'user-1', institutionId, campusId, recordId: saved.id, operationType: 'upload_document' });
    expect(await badoDb.assetDocuments.get(saved.id)).toBeDefined();
    expect(await badoDb.localMediaBlobs.get(saved.localBlobId!)).toMatchObject({ institutionId, assetId, mediaKind: 'document' });
  });
  it('rolls back metadata and bytes if queue insertion fails', async () => {
    vi.spyOn(badoDb.syncQueue, 'add').mockRejectedValueOnce(new Error('disk full'));
    await expect(gateway.uploadAssetDocument(institutionId, input())).rejects.toThrow('disk full');
    expect(await badoDb.assetDocuments.count()).toBe(0);
    expect(await badoDb.localMediaBlobs.count()).toBe(0);
    expect(await badoDb.syncQueue.count()).toBe(0);
  });
  it('refuses capture without an authenticated user or a same-tenant cached asset', async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(gateway.uploadAssetDocument(institutionId, input())).rejects.toThrow(/signed-in/);
    await expect(gateway.uploadAssetDocument('different-institution', input())).rejects.toThrow(/offline cache/);
    expect(await badoDb.localMediaBlobs.count()).toBe(0);
  });
  it('queues instead of uploading when the parent asset is still pending', async () => {
    await badoDb.assets.update(assetId, { localSyncStatus: 'pending' });
    await gateway.uploadAssetDocument(institutionId, { ...input(), saveOffline: false });
    expect(await badoDb.syncQueue.count()).toBe(1);
  });
});
