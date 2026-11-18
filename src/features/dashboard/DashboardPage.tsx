import { useLiveQuery } from 'dexie-react-hooks';
import {
  Building2,
  ClipboardList,
  Crosshair,
  Database,
  Layers,
  PlusCircle,
  QrCode,
  Radio,
  RefreshCw,
  Route,
  Settings,
  Shovel,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LegendIcon } from '@/components/ui/LegendIcon';
import {
  useCampuses,
  useDashboardSummary,
  useInstitutionSettings,
} from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import { ROLE_METADATA, type Permission } from '@/lib/permissions/rbac';
import { getInstitutionSyncSummary } from '@/lib/sync/syncQueue';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';

interface PrimaryActionItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  permission: Permission;
}

const PRIMARY_ACTIONS: PrimaryActionItem[] = [
  {
    to: '/live',
    label: 'BADO LIVE',
    description: 'Monitor live foreground proximity to documented utilities.',
    icon: Radio,
    accent: 'bg-bado-navy-900 text-white hover:bg-bado-navy-800 border-bado-navy-900',
    permission: 'live_mode:use',
  },
  {
    to: '/assets/new',
    label: 'LOG NEW ASSET',
    description: 'Document surface, underground, or survey benchmark assets.',
    icon: PlusCircle,
    accent: 'bg-white text-slate-900 hover:bg-slate-50 border-slate-200',
    permission: 'assets:create',
  },
  {
    to: '/routes/new',
    label: 'TRACE INFRASTRUCTURE',
    description: 'Walk-and-record or draw pipeline and cable routes.',
    icon: Route,
    accent: 'bg-white text-slate-900 hover:bg-slate-50 border-slate-200',
    permission: 'routes:record',
  },
  {
    to: '/dig-check',
    label: 'CHECK BEFORE YOU DIG',
    description: 'Query recorded infrastructure around a planned excavation.',
    icon: Shovel,
    accent: 'bg-amber-50 text-amber-950 hover:bg-amber-100 border-amber-300',
    permission: 'dig_check:run',
  },
  {
    to: '/scan',
    label: 'SCAN QR CODE',
    description: 'Open a Borehole Passport or look up an asset QR ID.',
    icon: QrCode,
    accent: 'bg-white text-slate-900 hover:bg-slate-50 border-slate-200',
    permission: 'passports:view',
  },
];

export function DashboardPage() {
  const { activeInstitution, activeRole, activeCampusId, can } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: campuses = [] } = useCampuses();
  const { data: settings } = useInstitutionSettings();
  const isOnline = useOnlineStatus();

  const syncSummary = useLiveQuery(
    () =>
      activeInstitution
        ? getInstitutionSyncSummary(activeInstitution.id)
        : Promise.resolve(undefined),
    [activeInstitution?.id],
  );

  const selectedCampus = activeCampusId
    ? campuses.find((c) => c.id === activeCampusId)
    : null;

  const stats = [
    {
      label: 'Total Registered Assets',
      value: summary?.totalAssets ?? 0,
      icon: Database,
      tone: 'text-bado-navy-800 bg-bado-navy-50',
    },
    {
      label: 'Surface Assets',
      value: summary?.surfaceAssets ?? 0,
      icon: Building2,
      tone: 'text-emerald-700 bg-emerald-50',
    },
    {
      label: 'Underground Assets',
      value: summary?.undergroundAssets ?? 0,
      icon: Layers,
      tone: 'text-blue-700 bg-blue-50',
    },
    {
      label: 'Linear Routes',
      value: summary?.linearRoutes ?? 0,
      icon: Route,
      tone: 'text-purple-700 bg-purple-50',
    },
    {
      label: 'Survey Benchmarks',
      value: summary?.surveyBenchmarks ?? 0,
      icon: Crosshair,
      tone: 'text-cyan-700 bg-cyan-50',
    },
    {
      label: 'Pending Verification',
      value: summary?.pendingVerification ?? 0,
      icon: ClipboardList,
      tone: 'text-amber-800 bg-amber-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Heading */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Operations Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Scope:{' '}
            <strong className="font-medium text-slate-800">
              {selectedCampus
                ? `${selectedCampus.name} (${selectedCampus.code})`
                : `All Permitted Campuses (${campuses.length})`}
            </strong>
            {activeRole && (
              <>
                {' '}
                · Signed in as{' '}
                <span className="font-medium text-slate-800">
                  {ROLE_METADATA[activeRole].label}
                </span>
              </>
            )}
          </p>
        </div>

        {can('admin:access') && (
          <Link to="/admin">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Settings className="h-4 w-4" />}
            >
              Manage Campuses &amp; Roles
            </Button>
          </Link>
        )}
      </div>

      {/* Prominent Field Actions (Section 21) */}
      <section aria-labelledby="primary-actions-heading">
        <h2
          id="primary-actions-heading"
          className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          Primary Field &amp; Operations Actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PRIMARY_ACTIONS.map((action) => {
            const Icon = action.icon;
            const permitted = can(action.permission);

            if (!permitted) {
              return (
                <div
                  key={action.label}
                  aria-disabled="true"
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-100/80 p-4 opacity-65"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    <Badge tone="neutral">Role restricted</Badge>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-bold tracking-wide text-slate-600">
                      {action.label}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {action.description}
                    </p>
                  </div>
                </div>
              );
            }

            const isHero = action.to === '/live';

            return (
              <Link
                key={action.label}
                to={action.to}
                className={`group flex min-h-28 flex-col justify-between rounded-xl border p-4 shadow-2xs transition-all ${action.accent}`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    isHero ? 'text-sky-300' : 'text-bado-navy-800'
                  }`}
                  aria-hidden="true"
                />
                <div className="mt-3">
                  <p className="text-xs font-bold tracking-wide">{action.label}</p>
                  <p
                    className={`mt-1 text-xs leading-snug ${
                      isHero ? 'text-slate-200' : 'text-slate-600'
                    }`}
                  >
                    {action.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Infrastructure Register Summary */}
      <section aria-labelledby="register-metrics-heading">
        <h2
          id="register-metrics-heading"
          className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          Infrastructure Register Summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
              >
                <div
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${stat.tone}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums text-slate-900">
                  {summaryLoading ? '—' : stat.value}
                </p>
                <p className="mt-0.5 text-xs font-medium text-slate-600">
                  {stat.label}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Lower Grid: Maintenance, Sync Status & Institutional Map Legend */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Card
          className="lg:col-span-7"
          title="Recent Maintenance & Inspection Activity"
          description="Chronological works across surface facilities, boreholes, and underground utilities."
        >
          <EmptyState
            icon={<Wrench className="h-5 w-5" />}
            title="No maintenance activities recorded yet"
            description={`Your institution is configured with ${summary?.campusCount ?? 0} permitted campus${(summary?.campusCount ?? 0) === 1 ? '' : 'es'} and ${summary?.departmentCount ?? 0} active department${(summary?.departmentCount ?? 0) === 1 ? '' : 's'}. Asset records arrive in Phase 2, and chronological inspection/maintenance logs link directly to registered assets.`}
          />
        </Card>

        <Card
          className="lg:col-span-5"
          title="Offline & Synchronisation Status"
          description="Local IndexedDB outbox for unreliable field connectivity."
          actions={
            <Link to="/sync">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Inspect Queue
              </Button>
            </Link>
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Connectivity</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {isOnline ? 'Online' : 'Offline'}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Pending Upload</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                {syncSummary?.pending ?? 0}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Failed</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                {syncSummary?.failed ?? 0}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Requires Review</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                {syncSummary?.requiresReview ?? 0}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Every queued field operation receives a client-generated UUID and
            preserves its original capture timestamp to prevent duplicate records on
            retry.
          </p>
        </Card>
      </div>

      {/* Institutional Map Legend Convention */}
      {settings && (
        <Card
          title="Institutional Map Legend Convention"
          description="Active visual classification for this institution. Colours and visibility are configurable by Administrators without editing source code."
        >
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {settings.legendConfig.map((entry) => (
              <div
                key={entry.key}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white shadow-2xs"
                  style={{ backgroundColor: entry.colorHex }}
                >
                  <LegendIcon iconKey={entry.iconKey} className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900">
                    {entry.label}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500">
                    {entry.colorHex.toUpperCase()} · {entry.lineStyle}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            <strong>Notice:</strong> Map legend colours and icons are BADO interface
            conventions and do not represent statutory or certified excavation
            utility-marking standards.
          </p>
        </Card>
      )}
    </div>
  );
}
