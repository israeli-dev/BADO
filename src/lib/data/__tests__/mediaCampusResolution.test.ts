import { beforeEach, describe, expect, it, vi } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
const client = vi.hoisted(() => ({ from: vi.fn(), storage: { from: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => client }));
import { SupabaseDataGateway } from '@/lib/data/supabaseGateway';
const institution = '11111111-1111-4111-8111-111111111101';
const campus = '22222222-2222-4222-8222-222222222201';
const asset = '77777777-7777-4777-8777-777777777701';
describe('media campus resolution', () => {
  beforeEach(async () => { vi.resetAllMocks(); await badoDb.delete(); await badoDb.open(); });
  it('looks up the accessible asset campus when online cache is empty', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { campus_id: campus }, error: null });
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
    const upload = vi.fn().mockResolvedValue({ error: null });
    client.storage.from.mockReturnValue({ upload });
    const single = vi.fn().mockResolvedValue({ data: { id: 'id', institution_id: institution, asset_id: asset, storage_path: 'path', file_name: 'a.pdf', mime_type: 'application/pdf', file_size_bytes: 3, document_kind: 'other', title: 'Test', description: null, uploaded_by: null, created_at: '' }, error: null });
    const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    client.from.mockImplementation((table: string) => table === 'assets' ? query : { insert });
    await new SupabaseDataGateway().uploadAssetDocument(institution, { assetId: asset, file: new File(['abc'], 'a.pdf', { type: 'application/pdf' }), documentKind: 'other', title: 'Test' });
    expect(upload.mock.calls[0][0]).toMatch(new RegExp(`^${institution}/${campus}/${asset}/docs/`));
  });
  it('does not upload when the asset cannot be found or accessed', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
    client.from.mockReturnValue(query);
    await expect(new SupabaseDataGateway().uploadAssetDocument(institution, { assetId: asset, file: new File(['abc'], 'a.pdf', { type: 'application/pdf' }), documentKind: 'other', title: 'Test' })).rejects.toThrow(/not found or is not accessible/);
    expect(client.storage.from).not.toHaveBeenCalled();
  });
});
