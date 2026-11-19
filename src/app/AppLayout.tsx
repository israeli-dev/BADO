import { clsx } from 'clsx';
import { LogOut, MapPin, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { MAIN_NAVIGATION } from '@/app/navigation';
import { DemoEnvironmentBanner } from '@/components/feedback/DemoEnvironmentBanner';
import { SyncStatusBadge } from '@/components/feedback/SyncStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCampuses } from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import { ROLE_METADATA } from '@/lib/permissions/rbac';
import { useRouteSync } from '@/lib/sync/useRouteSync';

export function AppLayout() {
  useRouteSync();
  const {
    gateway,
    session,
    activeInstitution,
    activeRole,
    activeCampusId,
    selectInstitution,
    selectCampus,
    can,
    signOut,
  } = useAuth();
  const { data: campuses = [] } = useCampuses();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  const visibleNav = MAIN_NAVIGATION.filter(
    (item) => !item.permission || can(item.permission),
  );
  const mobileBottomItems = visibleNav.filter((item) => item.mobileBottomBar);
  const roleLabel = activeRole ? ROLE_METADATA[activeRole].label : '';
  const showDemoBanner =
    gateway.mode === 'demo' || Boolean(activeInstitution?.isDemo);

  return (
    <div className="min-h-dvh flex bg-slate-50 text-slate-900">
      {/* Skip link for keyboard accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-bado-navy-900 focus:px-3.5 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside
        aria-label="Primary navigation"
        className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col bg-bado-navy-900 text-slate-100 border-r border-bado-navy-800"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <img
            src="/bado-mark.svg"
            alt=""
            className="h-9 w-9 rounded-lg ring-1 ring-white/15"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">
                BADO
              </span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-200">
                University
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-300">
              Infrastructure &amp; GIS Register
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white/14 text-white'
                      : 'text-slate-300 hover:bg-white/8 hover:text-white',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {session && (
          <div className="border-t border-white/10 p-4 space-y-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {session.user.fullName || session.user.email}
              </p>
              <p className="truncate text-xs text-sky-200">{roleLabel}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              onClick={() => void signOut()}
              leftIcon={<LogOut className="h-4 w-4" />}
              className="justify-start text-slate-200 hover:bg-white/10 hover:text-white"
            >
              Sign out
            </Button>
          </div>
        )}
      </aside>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation menu"
        >
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-bado-navy-900 text-white shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <img src="/bado-mark.svg" alt="" className="h-8 w-8 rounded-lg" />
                <span className="text-base font-bold">BADO</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      clsx(
                        'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-white/14 text-white'
                          : 'text-slate-300 hover:bg-white/8 hover:text-white',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {session && (
              <div className="border-t border-white/10 p-4 space-y-3">
                <div>
                  <p className="truncate text-sm font-semibold">
                    {session.user.fullName || session.user.email}
                  </p>
                  <p className="text-xs text-sky-200">{roleLabel}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  onClick={() => void signOut()}
                  leftIcon={<LogOut className="h-4 w-4" />}
                  className="justify-start text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {showDemoBanner && activeInstitution && (
          <DemoEnvironmentBanner
            institutionName={activeInstitution.name}
            isLocalSandbox={gateway.mode === 'demo'}
          />
        )}

        {/* Top Header */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>

              {session && session.memberships.length > 1 ? (
                <div>
                  <label htmlFor="institution-selector" className="sr-only">
                    Select active institution
                  </label>
                  <select
                    id="institution-selector"
                    value={activeInstitution?.id ?? ''}
                    onChange={(e) => selectInstitution(e.target.value)}
                    className="min-h-9 max-w-[220px] sm:max-w-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm font-semibold text-slate-900"
                  >
                    {session.memberships.map((m) => (
                      <option key={m.institutionId} value={m.institutionId}>
                        {m.institution?.name ?? m.institutionId}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {activeInstitution?.name ?? 'BADO'}
                  </p>
                  <p className="hidden sm:block text-xs text-slate-500">
                    {activeInstitution?.shortCode} · {roleLabel}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Campus Selector */}
              <div className="flex items-center gap-1.5">
                <MapPin
                  className="hidden sm:block h-4 w-4 text-slate-400 shrink-0"
                  aria-hidden="true"
                />
                <label htmlFor="campus-selector" className="sr-only">
                  Filter by campus
                </label>
                <select
                  id="campus-selector"
                  value={activeCampusId ?? ''}
                  onChange={(e) =>
                    selectCampus(e.target.value ? e.target.value : null)
                  }
                  className="min-h-9 max-w-[180px] sm:max-w-[230px] rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  <option value="">
                    All Permitted Campuses ({campuses.length})
                  </option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              </div>

              {activeInstitution && (
                <SyncStatusBadge institutionId={activeInstitution.id} />
              )}

              {activeRole && (
                <Badge tone="neutral" className="hidden xl:inline-flex">
                  {ROLE_METADATA[activeRole].shortLabel}
                </Badge>
              )}
            </div>
          </div>
        </header>

        {/* Page Body */}
        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8"
        >
          <Outlet />
        </main>

        {/* Mobile Bottom Tab Bar (thumb-friendly field access) */}
        <nav
          aria-label="Quick mobile navigation"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur-xs lg:hidden"
        >
          <div className="grid grid-cols-5">
            {mobileBottomItems.slice(0, 5).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors',
                      isActive
                        ? 'text-bado-navy-900 bg-bado-navy-50/70'
                        : 'text-slate-500 hover:text-slate-800',
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-full">{item.shortLabel}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
