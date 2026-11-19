import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ signUp: vi.fn(), signInWithPassword: vi.fn(), resend: vi.fn(), onAuthStateChange: vi.fn() }));
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
    const getSession = vi.spyOn(gateway, 'getSession').mockResolvedValue({ user: { id: 'user', email: 'ada@example.edu', fullName: 'Ada', phone: null, jobTitle: null, createdAt: '', updatedAt: '' }, memberships: [], mode: 'supabase' });
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
  it('trims email before sign-in and accepts existing shorter passwords', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const gateway = new SupabaseDataGateway();
    vi.spyOn(gateway, 'getSession').mockResolvedValue({ user: { id: 'user', email: 'ada@example.edu', fullName: 'Ada', phone: null, jobTitle: null, createdAt: '', updatedAt: '' }, memberships: [], mode: 'supabase' });
    await gateway.signInWithPassword({email:' ADA@EXAMPLE.EDU ',password:'short'});
    expect(auth.signInWithPassword).toHaveBeenCalledWith({email:'ada@example.edu',password:'short'});
  });
  it('resends a signup email without implying the account exists', async () => {
    auth.resend.mockResolvedValue({error:null});
    const gateway = new SupabaseDataGateway();
    await gateway.resendConfirmation(' ADA@EXAMPLE.EDU ');
    expect(auth.resend).toHaveBeenCalledWith({type:'signup',email:'ada@example.edu',options:{emailRedirectTo:`${window.location.origin}/login`}});
    auth.resend.mockResolvedValue({error:{message:'Rate limit exceeded'}});
    await expect(gateway.resendConfirmation('ada@example.edu')).rejects.toThrow('Rate limit');
  });
  it('defers auth listeners until the callback has returned and cancels on unsubscribe', async () => {
    vi.useFakeTimers();
    try {
      let callback: (() => void) | undefined;
      const unsubscribe = vi.fn();
      auth.onAuthStateChange.mockImplementation((cb) => { callback = cb; return {data:{subscription:{unsubscribe}}}; });
      const listener = vi.fn(); const stop = new SupabaseDataGateway().onAuthStateChange(listener);
      callback!(); expect(listener).not.toHaveBeenCalled();
      await vi.runAllTimersAsync(); expect(listener).toHaveBeenCalledTimes(1);
      callback!(); stop(); await vi.runAllTimersAsync();
      expect(listener).toHaveBeenCalledTimes(1); expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

});
