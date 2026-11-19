import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ auth }) }));
import { SupabaseDataGateway } from '@/lib/data/supabaseGateway';
const input = { fullName: '  Ada Student  ', email: ' ADA@EXAMPLE.EDU ', password: 'long-password', confirmPassword: 'long-password' };
describe('Supabase sign-up', () => {
  beforeEach(() => vi.resetAllMocks());
  it('requests email confirmation with name only and no self-assigned privileges', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const gateway = new SupabaseDataGateway();
    expect(await gateway.signUp(input)).toBeNull();
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'ada@example.edu', password: 'long-password', options: { data: { full_name: 'Ada Student' }, emailRedirectTo: `${window.location.origin}/login` } });
  });
  it('hydrates an immediate session when confirmation is disabled', async () => {
    auth.signUp.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
    const gateway = new SupabaseDataGateway();
    const getSession = vi.spyOn(gateway, 'getSession').mockResolvedValue(null);
    await gateway.signUp(input);
    expect(getSession).toHaveBeenCalledOnce();
  });
  it('reports backend sign-up errors and refuses invalid input before calling Supabase', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: { message: 'Signups not allowed for this instance' } });
    const gateway = new SupabaseDataGateway();
    await expect(gateway.signUp(input)).rejects.toThrow('Signups not allowed');
    auth.signUp.mockClear();
    await expect(gateway.signUp({ ...input, confirmPassword: 'wrong' })).rejects.toThrow();
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});
