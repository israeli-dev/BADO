import { Loader2, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/AuthContext';
import { ROLE_METADATA, type Permission } from '@/lib/permissions/rbac';

export function ProtectedRoute({
  children,
  requiredPermission,
}: {
  children: ReactNode;
  requiredPermission?: Permission;
}) {
  const { session, isLoading, sessionError, activeMembership, activeRole, can, signOut, refreshSession } =
    useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center bg-slate-50 px-4"
      >
        <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
          <Loader2 className="h-5 w-5 animate-spin text-bado-navy-800" />
          <span>Verifying institutional session…</span>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4"><Card className="max-w-md" title="Could not load your account"><p className="text-sm">{sessionError}</p><div className="mt-4 flex gap-3"><Button onClick={() => void refreshSession()}>Try again</Button><Link to="/login"><Button variant="outline">Sign-in options</Button></Link></div></Card></div>;
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (!activeMembership) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
        <Card
          className="max-w-md"
          title="No Active Institutional Assignment"
          description="Your account is authenticated but has not been assigned to an active institution yet."
        >
          <p className="text-sm text-slate-600">
            Contact your university BADO Administrator to link your account to an
            institution, campus, and role.
          </p>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => void refreshSession()}>Check assignment</Button>
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (requiredPermission && !can(requiredPermission)) {
    const roleLabel = activeRole ? ROLE_METADATA[activeRole].label : 'Current role';
    return (
      <div className="mx-auto max-w-xl py-8">
        <Card>
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold text-slate-900">
                Access Restricted
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Your assigned role (<strong>{roleLabel}</strong>) does not have
                permission to access this module (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {requiredPermission}
                </code>
                ). Database Row Level Security enforces the same restriction on all
                underlying records.
              </p>
              <div className="mt-4">
                <Link to="/">
                  <Button variant="secondary" size="sm">
                    Return to Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
