import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadoLocalDatabase } from '@/lib/db/badoDb';
import {
  enqueueSyncOperation,
  getInstitutionSyncSummary,
  listInstitutionSyncQueue,
  retrySyncOperation,
  updateSyncRecordStatus,
} from '@/lib/sync/syncQueue';

describe('offline synchronisation queue (Dexie / IndexedDB)', () => {
  let db: BadoLocalDatabase;

  beforeEach(() => {
    db = new BadoLocalDatabase(`bado_test_sync_${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('preserves original field capture timestamps and prevents duplicate creates on retry', async () => {
    const fieldTimestamp = '2026-11-18T06:15:00.000Z';
    const mutationId = crypto.randomUUID();

    const first = await enqueueSyncOperation(
      {
        id: mutationId,
        institutionId: 'inst-1',
        campusId: 'campus-1',
        recordType: 'assets',
        recordId: 'asset-101',
        operationType: 'create',
        payload: { name: 'Main Gate Borehole' },
        capturedAt: fieldTimestamp,
      },
      db,
    );

    // Retry with same mutation ID
    const replayById = await enqueueSyncOperation(
      {
        id: mutationId,
        institutionId: 'inst-1',
        recordType: 'assets',
        recordId: 'asset-101',
        operationType: 'create',
        payload: { name: 'Main Gate Borehole' },
      },
      db,
    );

    // Retry with new mutation ID while original create for same asset is still pending
    const replayByEntity = await enqueueSyncOperation(
      {
        institutionId: 'inst-1',
        recordType: 'assets',
        recordId: 'asset-101',
        operationType: 'create',
        payload: { name: 'Main Gate Borehole' },
      },
      db,
    );

    expect(replayById.id).toBe(first.id);
    expect(replayByEntity.id).toBe(first.id);
    expect(first.capturedAt).toBe(fieldTimestamp);

    const items = await listInstitutionSyncQueue('inst-1', db);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('pending');
  });

  it('tracks failure retries and guards conflicting records as requires_review', async () => {
    const opA = await enqueueSyncOperation(
      {
        institutionId: 'inst-1',
        recordType: 'assets',
        recordId: 'asset-a',
        operationType: 'update',
        baseVersion: 2,
        payload: { operationalStatus: 'active' },
      },
      db,
    );

    const opB = await enqueueSyncOperation(
      {
        institutionId: 'inst-1',
        recordType: 'utility_routes',
        recordId: 'route-b',
        operationType: 'update',
        baseVersion: 1,
        payload: { diameterMm: 150 },
      },
      db,
    );

    // Separate institution record must never leak into inst-1 counts
    await enqueueSyncOperation(
      {
        institutionId: 'inst-2',
        recordType: 'assets',
        recordId: 'asset-other',
        operationType: 'create',
        payload: { name: 'Other Institution Asset' },
      },
      db,
    );

    const failed = await updateSyncRecordStatus(
      opA.id,
      'failed',
      { errorDetails: 'Network timeout', incrementRetry: true },
      db,
    );
    expect(failed.retryCount).toBe(1);
    expect(failed.errorDetails).toBe('Network timeout');

    await updateSyncRecordStatus(
      opB.id,
      'requires_review',
      {
        errorDetails: 'Server version is 3 (expected 1).',
        conflictSnapshot: { diameterMm: 200, version: 3 },
      },
      db,
    );

    const summary = await getInstitutionSyncSummary('inst-1', db);
    expect(summary).toEqual({
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 1,
      requiresReview: 1,
      actionableTotal: 2,
    });

    // Failed item can be re-queued; conflict item cannot be blindly auto-retried
    const retried = await retrySyncOperation(opA.id, 'inst-1', db);
    expect(retried.status).toBe('pending');
    expect(retried.errorDetails).toBeNull();

    await expect(retrySyncOperation(opB.id, 'inst-1', db)).rejects.toThrow(
      /Only failed operations/,
    );
  });
});
