import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sync/pendingMedia', () => ({ loadPendingMedia: load }));
import { PendingMedia } from '@/features/assets/PendingMedia';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('local media object URLs', () => {
  it('revokes preview URLs on unmount', async () => {
    const create = vi.fn().mockReturnValue('blob:local-photo');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    load.mockResolvedValue([{ queueId: 'queue', recordId: 'photo', kind: 'photo', status: 'pending', name: 'Trench', fileName: 'photo.jpg', blob: new Blob(['abc'], { type: 'image/jpeg' }), errorDetails: null }]);
    const view = render(<MemoryRouter><PendingMedia institutionId="inst" campusId="campus" assetId="asset" actorId="actor" /></MemoryRouter>);
    expect(await screen.findByRole('img', { name: 'Trench' })).toHaveAttribute('src', 'blob:local-photo');
    expect(screen.getByRole('link', { name: /download local copy/i })).toHaveAttribute('download', 'photo.jpg');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:local-photo');
  });
});
