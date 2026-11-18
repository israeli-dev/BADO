import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { badoDb } from '@/lib/db/badoDb';
import type { ReactNode } from 'react';

let clicks = 0;
vi.mock('@/components/map/BadoMapCanvas', () => ({
  BadoMapCanvas: ({ onMapClick, children }: { onMapClick?: (p: { lat: number; lng: number }) => void; children?: ReactNode }) => <div><button type="button" onClick={() => onMapClick?.({ lat: 7.304, lng: 5.138 + (++clicks % 2) * 0.001 })}>Test map click</button>{children}</div>,
  createPlacementPinIcon: () => ({}),
  createAssetDivIcon: () => ({}), createDepthBadgeDivIcon: () => ({}), createJunctionDivIcon: () => ({}), createRouteVertexDivIcon: () => ({}),
  DEFAULT_CAMPUS_CENTER: { lat: 7.304, lng: 5.138 }, DEFAULT_CAMPUS_ZOOM: 16,
}));
vi.mock('react-leaflet', () => ({ Marker: () => null, Polyline: () => null, Polygon: () => null, Circle: () => null, CircleMarker: () => null, Tooltip: () => null }));

describe('route editor', () => {
  beforeEach(async () => { localStorage.clear(); window.history.pushState({}, '', '/login'); await badoDb.delete(); await badoDb.open(); });
  it('records route attributes, snapped depth and junction and persists a draft', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Field Technician \/ Artisan/i }));
    await user.click(await screen.findByText(/TRACE INFRASTRUCTURE/i));
    await screen.findByRole('heading', { name: /record linear infrastructure/i });
    const type = await screen.findByLabelText('Utility type');
    await screen.findByRole('option', { name: 'Water Pipeline' });
    const campus = screen.getByLabelText('Campus') as HTMLSelectElement;
    await waitFor(() => expect(campus.options.length).toBeGreaterThan(1));
    await user.selectOptions(campus, campus.options[1]!.value);
    await user.selectOptions(type, Array.from((type as HTMLSelectElement).options).find(o => o.text === 'Water Pipeline')!.value);
    await user.type(screen.getByLabelText('Route ID'), 'WP-UI-100');
    await user.type(screen.getByLabelText('Route name'), 'UI water line');
    await user.selectOptions(screen.getByLabelText(/Water Service Type/), 'Secondary service line');
    await user.click(screen.getByText('Test map click'));
    await user.click(screen.getByText('Test map click'));
    await user.type(screen.getByLabelText('Depth (m)'), '1.3');
    await user.click(screen.getByLabelText('Documented before covering'));
    await user.click(screen.getByRole('button', { name: /place depth observation/i }));
    await user.click(screen.getByText('Test map click'));
    expect(screen.getByText(/1.3 m · chainage/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Junction label'), 'Valve chamber');
    await user.click(screen.getByRole('button', { name: /place junction/i }));
    await user.click(screen.getByText('Test map click'));
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(async () => expect((await badoDb.assets.toArray()).find(a => a.assetCode === 'WP-UI-100')).toBeTruthy());
    const asset = (await badoDb.assets.toArray()).find(a => a.assetCode === 'WP-UI-100');
    expect((await badoDb.depthObservations.toArray()).filter(d => d.assetId === asset!.id).length).toBe(1);
    expect((await badoDb.utilityJunctions.toArray()).filter(j => j.assetId === asset!.id).length).toBe(1);
  });
});
