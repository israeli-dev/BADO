import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/App';
import { AuthProvider } from '@/features/auth/AuthContext';
import { DEMO_IDS } from '@/lib/data/demoSeed';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { SupabaseDataGateway } from '@/lib/data/supabaseGateway';
import { BadoLocalDatabase } from '@/lib/db/badoDb';

describe('institution member assignment', () => {
  it('requires confirmation and assigns a selected campus via the active institution', async () => {
    const db = new BadoLocalDatabase(`member_ui_${crypto.randomUUID()}`);
    const demo = new LocalDemoDataGateway(db);
    const session = await demo.signInAsDemoUser(DEMO_IDS.userAdmin);
    const gateway = new SupabaseDataGateway();
    vi.spyOn(gateway, 'getSession').mockResolvedValue(session);
    vi.spyOn(gateway, 'onAuthStateChange').mockReturnValue(() => {});
    vi.spyOn(gateway, 'listCampuses').mockImplementation(id => demo.listCampuses(id));
    vi.spyOn(gateway, 'listInstitutionMembers').mockImplementation(id => demo.listInstitutionMembers(id));
    const assign = vi.spyOn(gateway, 'assignConfirmedMember').mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/admin']}><AuthProvider gateway={gateway}><AppRoutes /></AuthProvider></MemoryRouter></QueryClientProvider>);
    try {
      await user.click(await screen.findByRole('tab', { name: /users & roles/i }));
      await user.type(await screen.findByLabelText(/account email/i), 'person@example.edu');
      await user.selectOptions(screen.getByLabelText(/campus access/i), DEMO_IDS.mainCampus);
      expect(screen.getByRole('button', { name: /assign read-only access/i })).toBeDisabled();
      expect(screen.getByText(/other institution-wide records may be accessible/i)).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: /verified this person/i }));
      await user.click(screen.getByRole('button', { name: /assign read-only access/i }));
      expect(assign).toHaveBeenCalledWith(DEMO_IDS.primaryInstitution, DEMO_IDS.mainCampus, 'person@example.edu');
      expect(await screen.findByText(/confirmed account assigned/i)).toBeInTheDocument();
    } finally { view.unmount(); await db.delete(); }
  });
});
