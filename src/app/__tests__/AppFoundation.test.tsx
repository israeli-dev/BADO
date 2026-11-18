import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '@/app/App';
import { AuthProvider } from '@/features/auth/AuthContext';
import { DEMO_IDS } from '@/lib/data/demoSeed';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { BadoLocalDatabase } from '@/lib/db/badoDb';

describe('Phase 1 UI foundation — auth, navigation, RBAC & campus administration', () => {
  let db: BadoLocalDatabase;
  let gateway: LocalDemoDataGateway;

  function renderApp(initialPath = '/') {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AuthProvider gateway={gateway}>
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    db = new BadoLocalDatabase(`bado_test_ui_${crypto.randomUUID()}`);
    gateway = new LocalDemoDataGateway(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('redirects unauthenticated users to sign-in, signs in as Admin, and signs out cleanly', async () => {
    const user = userEvent.setup();
    renderApp('/admin');

    expect(
      await screen.findByRole('heading', { name: /Institutional Sign In/i }),
    ).toBeInTheDocument();

    // Sign in as Demo Administrator — should resume intended /admin route
    await user.click(
      screen.getByRole('button', { name: /Engr\. Adebayo Ogunleye/i }),
    );

    expect(
      await screen.findByRole('heading', {
        name: /Institutional Administration/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Demonstration Environment:/i)).toBeInTheDocument();

    // Validate & create a new campus, then verify it enters both the list and audit log
    await user.click(screen.getByRole('button', { name: /Create Campus/i }));
    expect(
      await screen.findByText(/Campus name must be at least 2 characters/i),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/Campus Name/i),
      'Agricultural Research Farm (Simulated)',
    );
    await user.type(screen.getByLabelText(/Campus Code/i), 'AGRI_DEMO');
    await user.type(screen.getByLabelText(/Centre Latitude/i), '7.3125');
    await user.type(screen.getByLabelText(/Centre Longitude/i), '5.1290');
    await user.click(screen.getByRole('button', { name: /Create Campus/i }));

    expect(
      await screen.findByText(/Registered Campuses \(3\)/i),
    ).toBeInTheDocument();

    // Check Audit Logs tab captured the campus creation
    await user.click(screen.getByRole('tab', { name: /Audit Logs/i }));
    expect(
      await screen.findByText(/Created campus "Agricultural Research Farm/i),
    ).toBeInTheDocument();

    // Sign out returns to sign-in page
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Institutional Sign In/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders all 5 primary actions on Dashboard and enforces role restrictions for Field Tech', async () => {
    const user = userEvent.setup();
    await gateway.signInAsDemoUser(DEMO_IDS.userTechnician);

    renderApp('/admin');

    // Field Technician is blocked from /admin and navigation hides Administration link
    expect(
      await screen.findByRole('heading', { name: /Access Restricted/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Administration/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Return to Dashboard/i }),
    );

    expect(
      await screen.findByRole('heading', { name: /Operations Dashboard/i }),
    ).toBeInTheDocument();

    const actionsRegion = screen.getByRole('region', {
      name: /Primary Field & Operations Actions/i,
    });

    for (const label of [
      'BADO LIVE',
      'LOG NEW ASSET',
      'TRACE INFRASTRUCTURE',
      'CHECK BEFORE YOU DIG',
      'SCAN QR CODE',
    ]) {
      expect(within(actionsRegion).getByText(label)).toBeInTheDocument();
    }

    // Check Before You Dig displays the mandatory verification disclaimer
    await user.click(
      within(actionsRegion).getByRole('link', { name: /CHECK BEFORE YOU DIG/i }),
    );
    expect(
      await screen.findByText(
        /Unrecorded or inaccurately mapped utilities may exist/i,
      ),
    ).toBeInTheDocument();
  });

  it('blocks Read-only users from asset registration routes and scopes campus selector', async () => {
    await gateway.signInAsDemoUser(DEMO_IDS.userReadOnly);
    renderApp('/assets/new');

    expect(
      await screen.findByRole('heading', { name: /Access Restricted/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/assets:create/i)).toBeInTheDocument();

    // Campus selector reflects the 1 permitted campus (not all 2)
    expect(
      await screen.findByRole('option', {
        name: /All Permitted Campuses \(1\)/i,
      }),
    ).toBeInTheDocument();
  });
});
