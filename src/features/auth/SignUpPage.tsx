import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/AuthContext';
import { signUpSchema, type SignUpInput } from '@/lib/data';

export function SignUpPage() {
  const { gateway, session, isLoading, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const destination = (location.state as { from?: string } | null)?.from ?? '/';
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });

  if (!isLoading && session) return <Navigate to={destination} replace />;
  const submit = async (values: SignUpInput) => {
    setError(null);
    try {
      if (await signUp(values)) navigate(destination, { replace: true });
      else setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
    }
  };

  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="border-b border-bado-navy-800 bg-bado-navy-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <img src="/bado-mark.svg" alt="" className="h-10 w-10 rounded-lg ring-1 ring-white/15" />
          <div><span className="text-lg font-bold">BADO</span><p className="text-xs text-slate-300">Buried Asset Documentation &amp; Operations</p></div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <Card title="Create an account" description="Register with your institutional email to get started.">
          {gateway.mode === 'demo' ? (
            <Alert tone="info" title="Demonstration mode">
              Real accounts require a configured Supabase project with email sign-up enabled. You can explore the simulated campus accounts from the sign-in page instead.
            </Alert>
          ) : submitted ? (
            <Alert tone="success" title="Check your email">
              If this address can be registered, follow the confirmation email to finish creating your account. Then sign in and ask your institution administrator for access. If you already have an account, sign in instead.
            </Alert>
          ) : (
            <>
              <Alert tone="info" className="mb-4">Creating an account does not grant access to institutional records. An administrator must assign your institution and role.</Alert>
              {error && <Alert tone="danger" title="Unable to register" className="mb-4">{error}</Alert>}
              <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
                <Input label="Full name" autoComplete="name" required error={errors.fullName?.message} {...register('fullName')} />
                <Input label="Institutional email" type="email" autoComplete="email" required error={errors.email?.message} {...register('email')} />
                <Input label="Password" type="password" autoComplete="new-password" required hint="At least 10 characters." error={errors.password?.message} {...register('password')} />
                <Input label="Confirm password" type="password" autoComplete="new-password" required error={errors.confirmPassword?.message} {...register('confirmPassword')} />
                <Button type="submit" fullWidth isLoading={isSubmitting}>Create account</Button>
              </form>
            </>
          )}
          <p className="mt-5 text-center text-sm text-slate-600">Already have an account?{' '}<Link to="/login" state={location.state} className="font-semibold text-bado-navy-800 underline underline-offset-2">Sign in</Link></p>
        </Card>
      </main>
    </div>
  );
}
