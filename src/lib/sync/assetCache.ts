import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import type { AssetRecord } from '@/types/domain';

/** Never overwrite an unsynchronised local asset with a stale server response. */
export async function cacheAndMergeServerAssets(
  institutionId: string,
  serverAssets: AssetRecord[],
  db: BadoLocalDatabase = badoDb,
): Promise<AssetRecord[]> {
  return db.transaction('rw', db.assets, async () => {
    const pending = await db.assets.where('institutionId').equals(institutionId)
      .filter(a => a.localSyncStatus === 'pending' && a.archivedAt === null).toArray();
    const pendingIds = new Set(pending.map(a => a.id));
    const safe = serverAssets.filter(a => a.institutionId === institutionId && !pendingIds.has(a.id));
    await db.assets.bulkPut(safe);
    const merged = new Map(safe.map(a => [a.id, a]));
    for (const asset of pending) merged.set(asset.id, asset);
    return [...merged.values()];
  });
}
