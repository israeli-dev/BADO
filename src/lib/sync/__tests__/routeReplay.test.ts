import { beforeEach, describe, expect, it, vi } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import { enqueueSyncOperation } from '@/lib/sync/syncQueue';
import { claimNextRouteMutation, processRouteQueue } from '@/lib/sync/routeReplay';

const institutionId = 'institution-a';
const actorUserId = 'user-a';
async function enqueue(recordId: string, operationType: 'create' | 'update' = 'create', actor = actorUserId) {
  return enqueueSyncOperation({ institutionId, actorUserId: actor, recordType: 'linear_routes', recordId, operationType, payload: {}, baseVersion: operationType === 'update' ? 1 : null });
}
describe('offline route replay', () => {
  beforeEach(async () => { await badoDb.delete(); await badoDb.open(); });
  it('serialises concurrent workers and processes create before edit', async () => {
    const first = await enqueue('route-1');
    const second = await enqueue('route-1', 'update');
    const claim = await claimNextRouteMutation(institutionId, actorUserId);
    expect(claim?.id).toBe(first.id);
    expect(await claimNextRouteMutation(institutionId, actorUserId)).toBeNull();
    await badoDb.syncQueue.update(first.id, { status: 'pending', claimId: null });
    const replay = vi.fn().mockResolvedValue(undefined);
    expect(await processRouteQueue(institutionId, actorUserId, replay)).toBe(2);
    expect(replay.mock.calls.map(c => c[0].id)).toEqual([first.id, second.id]);
    expect((await badoDb.syncQueue.get(second.id))?.status).toBe('synced');
  });
  it('blocks later mutations on a conflict but permits unrelated routes', async () => {
    const first = await enqueue('route-1');
    const second = await enqueue('route-1', 'update');
    const other = await enqueue('route-2');
    const replay = vi.fn().mockImplementation(async (item) => { if (item.id === first.id) throw { code: '40001', message: 'version conflict' }; });
    expect(await processRouteQueue(institutionId, actorUserId, replay)).toBe(1);
    expect((await badoDb.syncQueue.get(first.id))?.status).toBe('requires_review');
    expect((await badoDb.syncQueue.get(second.id))?.status).toBe('pending');
    expect((await badoDb.syncQueue.get(other.id))?.status).toBe('synced');
  });
  it('does not upload another user or legacy operations and waits on earlier unsupported work', async () => {
    const foreign = await enqueue('route-foreign', 'create', 'user-b');
    const legacy = await enqueueSyncOperation({ institutionId, recordType: 'assets', recordId: 'route-legacy', operationType: 'create', payload: {} });
    const later = await enqueue('route-legacy', 'update');
    const replay = vi.fn().mockResolvedValue(undefined);
    expect(await processRouteQueue(institutionId, actorUserId, replay)).toBe(0);
    expect(replay).not.toHaveBeenCalled();
    expect((await badoDb.syncQueue.get(foreign.id))?.status).toBe('pending');
    expect((await badoDb.syncQueue.get(legacy.id))?.status).toBe('pending');
    expect((await badoDb.syncQueue.get(later.id))?.status).toBe('pending');
  });
  it('waits for an offline point before uploading its photo', async () => {
    const create = await enqueueSyncOperation({ institutionId, actorUserId, recordType: 'assets', recordId: 'point-1', operationType: 'create', payload: { assetInsert: { id: 'point-1' } } });
    const photo = await enqueueSyncOperation({ institutionId, actorUserId, recordType: 'asset_photos', recordId: 'photo-1', operationType: 'upload_photo', payload: { meta: { assetId: 'point-1' } } });
    const replay = vi.fn().mockRejectedValueOnce(new Error('offline'));
    await processRouteQueue(institutionId, actorUserId, replay);
    expect((await badoDb.syncQueue.get(create.id))?.status).toBe('failed');
    expect((await badoDb.syncQueue.get(photo.id))?.status).toBe('pending');
    await badoDb.syncQueue.update(create.id, { status: 'pending' });
    replay.mockResolvedValue(undefined);
    expect(await processRouteQueue(institutionId, actorUserId, replay)).toBe(2);
    expect(replay.mock.calls.slice(1).map(call => call[2])).toEqual(['point', 'photo']);
  });
  it('recovers a stale lease using the same mutation ID', async () => {
    const item = await enqueue('route-1');
    const claim = await claimNextRouteMutation(institutionId, actorUserId);
    await badoDb.syncQueue.update(item.id, { lastAttemptAt: new Date(Date.now() - 600_000).toISOString() });
    const next = await claimNextRouteMutation(institutionId, actorUserId);
    expect(next?.id).toBe(item.id);
    expect(next?.claimId).not.toBe(claim?.claimId);
  });
  it('keeps a depth observation pending until its earlier route creation succeeds', async () => {
    const create = await enqueue('route-1');
    const depth = await enqueueSyncOperation({ institutionId, actorUserId, recordType: 'utility_depth_observations', recordId: 'depth-1', operationType: 'create', payload: { depthObservationInsert: { asset_id: 'route-1' } } });
    const fail = vi.fn().mockRejectedValue({ code: '42501', message: 'permission denied' });
    expect(await processRouteQueue(institutionId, actorUserId, fail)).toBe(0);
    expect((await badoDb.syncQueue.get(create.id))?.status).toBe('failed');
    expect((await badoDb.syncQueue.get(depth.id))?.status).toBe('pending');
    expect(fail).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge a failed request and can retry the same mutation', async () => {
    const item = await enqueue('route-1');
    const replay = vi.fn().mockRejectedValueOnce(new Error('network response lost')).mockResolvedValueOnce(undefined);
    expect(await processRouteQueue(institutionId, actorUserId, replay)).toBe(0);
    expect((await badoDb.syncQueue.get(item.id))?.status).toBe('failed');
    await badoDb.syncQueue.update(item.id, { status: 'pending' });
    expect(await processRouteQueue(institutionId, actorUserId, replay)).toBe(1);
    expect(replay.mock.calls.map(call => call[0].id)).toEqual([item.id, item.id]);
  });

});
