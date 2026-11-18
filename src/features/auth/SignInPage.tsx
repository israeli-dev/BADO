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
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/AuthContext';
import { signInSchema, type SignInInput } from '@/lib/data';
import { DEMO_PERSONAS } from '@/lib/data/demoSeed';
import { ROLE_METADATA } from '@/lib/permissions/rbac';

export function SignInPage() {
  const {
    gateway,
    session,
    isLoading,
    signInWithPassword,
    signInAsDemoUser,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingDemoUserId, setPendingDemoUserId] = useState<string | null>(null);

  const destination =
    (location.state as { from?: string } | null)?.from ?? '/';

  const {
    register,
    handleSubmit,
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

              <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-600 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-bado-navy-700"
                    aria-hidden="true"
                  />
                  <p>
                    Accounts are provisioned by your university&apos;s Works &amp;
                    Maintenance Administrator. Data is isolated per institution
                    through PostgreSQL Row Level Security.
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
