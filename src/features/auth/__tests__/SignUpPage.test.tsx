import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/App';
import { AuthProvider } from '@/features/auth/AuthContext';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { SupabaseDataGateway } from '@/lib/data/supabaseGateway';
import { BadoLocalDatabase } from '@/lib/db/badoDb';

function renderApp(gateway: SupabaseDataGateway | LocalDemoDataGateway, path = '/login') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AuthProvider gateway={gateway}><AppRoutes /></AuthProvider></MemoryRouter></QueryClientProvider>);
}
function setupSupabase() {
  const gateway = new SupabaseDataGateway();
  vi.spyOn(gateway, 'getSession').mockResolvedValue(null);
  vi.spyOn(gateway, 'onAuthStateChange').mockReturnValue(() => {});
  return gateway;
}
afterEach(() => vi.restoreAllMocks());
describe('account registration', () => {
  it('links from login and validates password confirmation', async () => {
    const gateway = setupSupabase(); const signUp = vi.spyOn(gateway, 'signUp');
    const user = userEvent.setup(); renderApp(gateway);
    await user.click(await screen.findByRole('link', { name: /create an account/i }));
    await user.type(screen.getByLabelText(/full name/i), 'Ada Student');
    await user.type(screen.getByLabelText(/institutional email/i), 'ada@example.edu');
    await user.type(screen.getByLabelText(/^password/i), 'long-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'different-password');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });
  it('shows confirmation guidance without granting institutional access', async () => {
    const gateway = setupSupabase(); const signUp = vi.spyOn(gateway, 'signUp').mockResolvedValue(null);
    const user = userEvent.setup(); renderApp(gateway, '/signup');
    await user.type(await screen.findByLabelText(/full name/i), 'Ada Student');
    await user.type(screen.getByLabelText(/institutional email/i), 'ADA@example.edu');
    await user.type(screen.getByLabelText(/^password/i), 'long-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'long-password');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/if this address can be registered/i)).toBeInTheDocument();
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.edu', fullName: 'Ada Student' }));
  });
  it('sends an immediately signed-in account with no membership to the assignment screen', async () => {
    const gateway = setupSupabase();
    vi.spyOn(gateway, 'signUp').mockResolvedValue({ user: { id: 'user', email: 'ada@example.edu', fullName: 'Ada Student', phone: null, jobTitle: null, createdAt: '', updatedAt: '' }, memberships: [], mode: 'supabase' });
    const user = userEvent.setup(); renderApp(gateway, '/signup');
    await user.type(await screen.findByLabelText(/full name/i), 'Ada Student');
    await user.type(screen.getByLabelText(/institutional email/i), 'ada@example.edu');
    await user.type(screen.getByLabelText(/^password/i), 'long-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'long-password');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('heading', { name: /no active institutional assignment/i })).toBeInTheDocument();
  });
  it('offers confirmation resend using the email field and shows delivery guidance', async () => {
    const gateway = setupSupabase(); const resend = vi.spyOn(gateway, 'resendConfirmation').mockResolvedValue();
    const user = userEvent.setup(); renderApp(gateway);
    await user.type(await screen.findByLabelText(/institutional email/i), 'ADA@example.edu');
    await user.click(screen.getByRole('button', { name: /resend confirmation email/i }));
    expect(await screen.findByText(/if this address is eligible/i)).toBeInTheDocument();
    expect(resend).toHaveBeenCalledWith('ada@example.edu');
  });
  it('shows a recoverable session loading error rather than silently redirecting', async () => {
    const gateway = setupSupabase();
    vi.mocked(gateway.getSession).mockRejectedValue(new Error('Profile missing'));
    renderApp(gateway, '/');
    expect(await screen.findByText('Profile missing')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /try again/i})).toBeInTheDocument();
  });
  it('explains that demo mode does not create real accounts', async () => {
    const db = new BadoLocalDatabase(`signup_demo_${crypto.randomUUID()}`);
    try {
      const gateway = new LocalDemoDataGateway(db);
      vi.spyOn(gateway, 'getSession').mockResolvedValue(null);
      const view = renderApp(gateway, '/signup');
      expect(await screen.findByText(/real accounts require a configured supabase project/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
      view.unmount();
    } finally { await db.delete(); }
  });
});
