import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PendingMedia } from '@/features/assets/PendingMedia';
import { BadoLocalDatabase } from '@/lib/db/badoDb';
import { enqueueSyncOperation } from '@/lib/sync/syncQueue';
import type { AssetDocumentRecord } from '@/types/domain';

let db: BadoLocalDatabase;
const record: AssetDocumentRecord = { id: 'doc', institutionId: 'inst', assetId: 'asset', storagePath: 'path', fileName: 'drawing.pdf', mimeType: 'application/pdf', fileSizeBytes: 3, documentKind: 'other', title: 'Drawing', description: null, uploadedBy: null, createdAt: '2026-01-01T00:00:00Z', localBlobId: 'blob' };
describe('local pending media on asset detail', () => {
  beforeEach(async () => { db = new BadoLocalDatabase(`pending_ui_${crypto.randomUUID()}`); await db.open(); await db.assetDocuments.put(record); });
  afterEach(async () => { await db.delete(); });
  it('shows unconfirmed status and reacts to queue updates', async () => {
    const entry = await enqueueSyncOperation({ institutionId: 'inst', campusId: 'campus', actorUserId: 'actor', recordType: 'asset_documents', recordId: record.id, operationType: 'upload_document', payload: { meta: record, localBlobId: 'blob' } }, db);
    const view = render(<MemoryRouter><PendingMedia db={db} institutionId="inst" campusId="campus" assetId="asset" actorId="actor" /></MemoryRouter>);
    expect(await screen.findByText('Drawing')).toBeInTheDocument();
    expect(screen.getByText('Waiting to sync')).toBeInTheDocument();
    expect(screen.getByText(/local file preview is unavailable/i)).toBeInTheDocument();
    await db.syncQueue.update(entry.id, { status: 'failed', errorDetails: 'response lost' });
    expect(await screen.findByText('Sync failed')).toBeInTheDocument();
    expect(screen.getByText('response lost')).toBeInTheDocument();
    await db.syncQueue.update(entry.id, { status: 'synced' });
    await waitFor(() => expect(screen.queryByText('Drawing')).not.toBeInTheDocument());
    view.unmount();
  });
  it('removes another user’s local media on a user change', async () => {
    await enqueueSyncOperation({ institutionId: 'inst', campusId: 'campus', actorUserId: 'other', recordType: 'asset_documents', recordId: record.id, operationType: 'upload_document', payload: { meta: record, localBlobId: 'blob' } }, db);
    const view = render(<MemoryRouter><PendingMedia key="other" db={db} institutionId="inst" campusId="campus" assetId="asset" actorId="other" /></MemoryRouter>);
    expect(await screen.findByText('Drawing')).toBeInTheDocument();
    view.rerender(<MemoryRouter><PendingMedia key="actor" db={db} institutionId="inst" campusId="campus" assetId="asset" actorId="actor" /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText('Drawing')).not.toBeInTheDocument());
    view.unmount();
  });
});
