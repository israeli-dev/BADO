import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { badoDb } from '@/lib/db/badoDb';

describe('Phase 2 Asset Registry UI flows', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/sign-in');
    await badoDb.delete();
    await badoDb.open();
  });

  it('searches benchmarks by Reference ID and filters assets cleanly', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole('button', { name: /Administrator/i }),
    );
    await screen.findByText(/LOG NEW ASSET/i);

    // Navigate to Assets
    await user.click(screen.getAllByRole('link', { name: /^Assets$/i })[0]!);
    await screen.findByRole('heading', {
      name: /Institutional Asset Register/i,
    });

    // Seeded simulated borehole appears in list
    expect(
      await screen.findByText(/Demo Senate Quad Borehole No\. 1/i),
    ).toBeInTheDocument();

    // Filter by benchmark Reference ID
    const searchBox = screen.getByPlaceholderText(/Search by Asset ID/i);
    await user.type(searchBox, 'BM-DEMO-001');

    expect(
      await screen.findByText(/Demo North Gate Primary Benchmark/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Demo Senate Quad Borehole No\. 1/i),
    ).not.toBeInTheDocument();
  });

  it('dynamically adapts registration fields by asset type, captures GPS, and submits unverified record', async () => {
    const user = userEvent.setup();

    // Mock browser Geolocation API for single-point GPS capture
    const mockGetCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 7.304812,
          longitude: 5.138744,
          accuracy: 3.6,
          altitude: 365,
          altitudeAccuracy: 7.2,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      } as GeolocationPosition);
    });
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: mockGetCurrentPosition },
    });

    render(<App />);

    // Sign in as Field Technician
    await user.click(
      await screen.findByRole('button', {
        name: /Field Technician \/ Artisan/i,
      }),
    );

    // Launch LOG NEW ASSET directly from Dashboard
    await user.click(await screen.findByText(/LOG NEW ASSET/i));
    await screen.findByRole('heading', {
      name: /Log New Infrastructure Asset/i,
    });

    // Benchmark category card is disabled for Field Technician
    expect(
      screen.getByRole('button', { name: /Survey Benchmark/i }),
    ).toBeDisabled();

    // Default surface type is Borehole -> shows Total Drilled Depth (m)
    expect(
      await screen.findByLabelText(/Total Drilled Depth \(m\)/i),
    ).toBeInTheDocument();

    // Switch Asset Type to Distribution Transformer -> swaps fields to Rated Capacity (kVA) & Voltage Ratio
    const typeSelect = screen.getByLabelText(/^Asset Type/i);
    const transformerOption = Array.from(
      (typeSelect as HTMLSelectElement).options,
    ).find((o) => o.text === 'Distribution Transformer')!;
    await user.selectOptions(typeSelect, transformerOption.value);

    expect(
      await screen.findByLabelText(/Rated Capacity \(kVA\)/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Total Drilled Depth \(m\)/i),
    ).not.toBeInTheDocument();

    // Fill dynamic fields + core identification
    await user.type(screen.getByLabelText(/Rated Capacity \(kVA\)/i), '300');
    await user.selectOptions(
      screen.getByLabelText(/Voltage Ratio/i),
      '11kV / 0.415kV',
    );
    await user.type(
      screen.getByLabelText(/^Asset Name/i),
      'Workshop Substation Transformer T-3',
    );

    // Capture GPS position and fine-adjust (+2m N -> marks Manually adjusted)
    await user.click(
      screen.getByRole('button', { name: /Capture Current GPS/i }),
    );
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /\+2m N/i }));
    expect(screen.getByText(/Manually adjusted/i)).toBeInTheDocument();

    // Submit for Verification -> navigates to detail page with Submitted badge
    await user.click(
      screen.getByRole('button', { name: /Submit for Verification/i }),
    );

    expect(
      await screen.findByRole('heading', {
        name: /Workshop Substation Transformer T-3/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Submitted$/i).length).toBeGreaterThan(0);
    expect(screen.getByText('300 kVA')).toBeInTheDocument();

    // Field technician must NOT see supervisor approval panel
    expect(
      screen.queryByText(/Verification & Approval Decision/i),
    ).not.toBeInTheDocument();
  });

  it('allows Supervisor to approve a pending record and hides write controls from Read-only users', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Sign in as Supervisor
    await user.click(
      await screen.findByRole('button', { name: /Chioma Nwosu/i }),
    );

    // Click Pending Verification KPI card on Dashboard
    await user.click(await screen.findByText(/Pending Verification/i));
    await screen.findByRole('heading', {
      name: /Institutional Asset Register/i,
    });

    // Open submitted transformer record
    await user.click(
      await screen.findByText(/Demo Science Block 500kVA Transformer/i),
    );
    await screen.findByRole('heading', {
      name: /Demo Science Block 500kVA Transformer/i,
    });

    // Wait for lazy AssetDetailPage review panel and approve record
    const remarksField = await screen.findByLabelText(/Reviewer Remarks/i);
    await user.type(
      remarksField,
      'Verified transformer nameplate rating and GPS substation location.',
    );
    await user.click(
      screen.getByRole('button', { name: /Record Verification Decision/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Submitted → Verified/i)).toBeInTheDocument();
    });

    // Sign out and verify Read-only user sees verified record without review/archive buttons
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await user.click(
      await screen.findByRole('button', { name: /Read-only User/i }),
    );
    const assetLinks = await screen.findAllByRole('link', {
      name: /^Assets$/i,
    });
    await user.click(assetLinks[0]!);
    await user.click(
      await screen.findByText(/Demo Science Block 500kVA Transformer/i),
    );
    await screen.findByText(/Spatial & GNSS Positioning Metadata/i);

    expect(
      screen.queryByText(/Verification & Approval Decision/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Archive$/i }),
    ).not.toBeInTheDocument();
  });
});
