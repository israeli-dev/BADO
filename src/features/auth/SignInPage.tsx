import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Building2,
  FlaskConical,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/AuthContext';
import { emailSchema, signInSchema, type SignInInput } from '@/lib/data';
import { DEMO_PERSONAS } from '@/lib/data/demoSeed';
import { ROLE_METADATA } from '@/lib/permissions/rbac';

export function SignInPage() {
  const {
    gateway,
    session,
    isLoading,
    sessionError,
    refreshSession,
    signOut,
    signInWithPassword,
    signInAsDemoUser,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [authError, setAuthError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [pendingDemoUserId, setPendingDemoUserId] = useState<string | null>(null);

  const destination =
    (location.state as { from?: string } | null)?.from ?? '/';

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  if (!isLoading && session) {
    return <Navigate to={destination} replace />;
  }

  const onPasswordSubmit = async (values: SignInInput) => {
    setAuthError(null);
    try {
      await signInWithPassword(values);
      navigate(destination, { replace: true });
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Unable to sign in.',
      );
    }
  };

  const resendConfirmation = async () => {
    setAuthError(null); setResendMessage(null);
    const email = emailSchema.safeParse(getValues('email'));
    if (!email.success) { setAuthError('Enter a valid email address above first.'); return; }
    setResending(true);
    try {
      await gateway.resendConfirmation(email.data);
      setResendMessage('If this address is eligible, a confirmation email will be sent. Check your inbox and spam folder.');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not request a confirmation email.');
    } finally { setResending(false); }
  };

  const handleDemoSignIn = async (userId: string) => {
    setAuthError(null);
    setPendingDemoUserId(userId);
    try {
      await signInAsDemoUser(userId);
      navigate(destination, { replace: true });
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Unable to start demo session.',
      );
    } finally {
      setPendingDemoUserId(null);
    }
  };

  const isDemoMode = gateway.mode === 'demo';
  const primaryDemoUsers = DEMO_PERSONAS.slice(0, 5);
  const secondaryDemoUser = DEMO_PERSONAS[5];

  return (
    <div className="min-h-dvh bg-slate-100 flex flex-col">
      {/* Top Institutional Header */}
      <header className="bg-bado-navy-900 text-white border-b border-bado-navy-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/bado-mark.svg"
              alt=""
              className="h-10 w-10 rounded-lg ring-1 ring-white/15"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight">BADO</span>
                <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-sky-100">
                  University Edition
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Buried Asset Documentation &amp; Operations
              </p>
            </div>
          </div>
          <p className="text-xs font-medium text-sky-200">
            Document Before Covering. Check Before Digging.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {authError && (
          <Alert tone="danger" title="Sign-in failed" className="mb-5">
            {authError}
          </Alert>
        )}

        {sessionError && <Alert tone="danger" title="Could not load your account" className="mb-5">
          <p>{sessionError}</p>
          <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void refreshSession()}>Try again</Button><Button size="sm" variant="outline" onClick={() => void signOut().catch(e => setAuthError(e instanceof Error ? e.message : 'Unable to sign out.'))}>Sign out</Button></div>
        </Alert>}
        {resendMessage && <Alert tone="info" title="Confirmation request" className="mb-5">{resendMessage}</Alert>}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Institutional Sign-In Card */}
          <div className={isDemoMode ? 'lg:col-span-5' : 'lg:col-span-6 lg:col-start-4'}>
            <Card
              title="Institutional Sign In"
              description="Access your university's authorised infrastructure registry and GIS workspace."
            >
              <form
                onSubmit={handleSubmit(onPasswordSubmit)}
                noValidate
                className="space-y-4"
              >
                <Input
                  label="Institutional Email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@university.edu.ng"
                  required
                  error={errors.email?.message}
                  {...register('email')}
                />
                <Input
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  error={errors.password?.message}
                  {...register('password')}
                />

                <Button
                  type="submit"
                  fullWidth
                  isLoading={isSubmitting}
                  leftIcon={<KeyRound className="h-4 w-4" />}
                >
                  Sign In with Supabase Auth
                </Button>
              </form>

              {!isDemoMode && <button type="button" disabled={resending} onClick={() => void resendConfirmation()} className="mt-3 text-sm font-semibold text-bado-navy-800 underline disabled:opacity-50">{resending ? 'Requesting…' : 'Resend confirmation email'}</button>}
              <p className="mt-4 text-center text-sm text-slate-600">
                Need an account?{' '}
                <Link to="/signup" state={location.state} className="font-semibold text-bado-navy-800 underline underline-offset-2">Create an account</Link>
              </p>
              <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-600 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-bado-navy-700"
                    aria-hidden="true"
                  />
                  <p>
                    Your university administrator assigns institutional access after account creation. Access is governed by your institution’s database policies.
                  </p>
                </div>
                {isDemoMode && (
                  <p className="rounded-lg bg-slate-50 p-2.5 text-slate-600 border border-slate-200">
                    <strong>Developer note:</strong> Copy{' '}
                    <code className="font-mono text-[11px]">.env.example</code> to{' '}
                    <code className="font-mono text-[11px]">.env</code> with{' '}
                    <code className="font-mono text-[11px]">VITE_SUPABASE_URL</code>{' '}
                    and{' '}
                    <code className="font-mono text-[11px]">VITE_SUPABASE_ANON_KEY</code>{' '}
                    to connect to your live Supabase PostGIS instance.
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Clearly Labelled Demonstration Sandbox (when in Demo mode) */}
          {isDemoMode && (
            <div className="lg:col-span-7 space-y-4">
              <Card
                title="Demonstration Campus Accounts (Simulated)"
                description="Explore role-based permissions, offline queue persistence, and multi-institution data isolation using clearly labelled simulated data."
                actions={
                  <Badge tone="demo">
                    <FlaskConical className="h-3 w-3" />
                    Simulated Sandbox
                  </Badge>
                }
              >
                <div className="space-y-2.5">
                  {primaryDemoUsers.map((persona) => {
                    const roleMeta = ROLE_METADATA[persona.role];
                    const isBusy = pendingDemoUserId === persona.userId;
                    return (
                      <button
                        key={persona.userId}
                        type="button"
                        disabled={pendingDemoUserId !== null}
                        onClick={() => void handleDemoSignIn(persona.userId)}
                        className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-bado-navy-600 hover:bg-bado-navy-50/40 cursor-pointer disabled:opacity-60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {persona.fullName}
                            </span>
                            <Badge tone="info">{roleMeta.label}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-600">
                            {persona.summary}
                          </p>
                        </div>
                        <ArrowRight
                          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-bado-navy-800 ${
                            isBusy ? 'animate-pulse' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>

                {secondaryDemoUser && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Multi-Institution Isolation Verification
                    </p>
                    <button
                      type="button"
                      disabled={pendingDemoUserId !== null}
                      onClick={() => void handleDemoSignIn(secondaryDemoUser.userId)}
                      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-left transition-colors hover:border-bado-navy-600 hover:bg-white cursor-pointer disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {secondaryDemoUser.fullName}
                          </span>
                          <Badge tone="neutral">
                            {secondaryDemoUser.institutionName}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {secondaryDemoUser.summary}
                        </p>
                      </div>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-bado-navy-800"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                )}

                <Alert tone="warning" className="mt-4">
                  Demonstration accounts contain fictional records only and do not
                  represent verified infrastructure of the Federal University of
                  Technology, Akure (FUTA) or any other institution.
                </Alert>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
