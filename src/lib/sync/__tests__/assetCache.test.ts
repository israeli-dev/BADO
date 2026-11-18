import { beforeEach, describe, expect, it } from 'vitest';
import { badoDb } from '@/lib/db/badoDb';
import { DEMO_IDS } from '@/lib/data/demoSeed';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { cacheAndMergeServerAssets } from '@/lib/sync/assetCache';
import { enqueueSyncOperation } from '@/lib/sync/syncQueue';

describe('offline cache safety', () => {
  beforeEach(async () => {
    localStorage.clear(); await badoDb.delete(); await badoDb.open();
    await new LocalDemoDataGateway().signInAsDemoUser(DEMO_IDS.userTechnician);
  });
  it('does not replace pending local edits with stale remote data', async () => {
    const assets = await badoDb.assets.where('institutionId').equals(DEMO_IDS.primaryInstitution).toArray();
    const base = assets[0]!;
    const local = { ...base, name: 'Unsynchronised edit', localSyncStatus: 'pending' as const };
    await badoDb.assets.put(local);
    const result = await cacheAndMergeServerAssets(DEMO_IDS.primaryInstitution, [{ ...base, name: 'Old server value', localSyncStatus: 'synced' }]);
    expect(result.find(a => a.id === base.id)?.name).toBe('Unsynchronised edit');
    expect((await badoDb.assets.get(base.id))?.name).toBe('Unsynchronised edit');
  });
  it('rolls back local data and queue entries together when a transaction fails', async () => {
    const base = (await badoDb.assets.where('institutionId').equals(DEMO_IDS.primaryInstitution).toArray())[0]!;
    await expect(badoDb.transaction('rw', [badoDb.assets, badoDb.syncQueue], async () => {
      await badoDb.assets.put({ ...base, name: 'Should roll back' });
      await enqueueSyncOperation({ institutionId: base.institutionId, recordType: 'assets', recordId: base.id, operationType: 'update', payload: {} });
      throw new Error('test failure');
    })).rejects.toThrow('test failure');
    expect((await badoDb.assets.get(base.id))?.name).toBe(base.name);
    expect(await badoDb.syncQueue.count()).toBe(0);
  });
});
