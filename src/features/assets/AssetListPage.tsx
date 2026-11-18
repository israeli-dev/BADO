import {
  Camera,
  ChevronRight,
  Database,
  FileText,
  PlusCircle,
  RotateCcw,
  Route,
  Search,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LegendIcon } from '@/components/ui/LegendIcon';
import { Select } from '@/components/ui/Select';
import {
  AccuracyBadge,
  CriticalHazardBadge,
  PendingSyncBadge,
  VerificationBadge,
} from '@/features/assets/AssetStatusBadges';
import { useAssets, useAssetTypes } from '@/features/assets/useAssets';
import { useAuth } from '@/features/auth/AuthContext';
import {
  ASSET_CATEGORY_LABELS,
  UTILITY_GROUP_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/lib/assets/labels';
import {
  ASSET_CATEGORIES,
  UTILITY_GROUPS,
  VERIFICATION_STATUSES,
  type AssetCategory,
  type UtilityGroup,
  type VerificationStatus,
} from '@/types/domain';

type CategoryFilter = AssetCategory | 'all';
type VerificationFilter = VerificationStatus | 'pending_review' | 'all';
type UtilityFilter = UtilityGroup | 'all';

function parseCategoryParam(raw: string | null): CategoryFilter {
  if (raw && (ASSET_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as AssetCategory;
  }
  return 'all';
}

function parseVerificationParam(raw: string | null): VerificationFilter {
  if (raw === 'pending_review') return 'pending_review';
  if (raw && (VERIFICATION_STATUSES as readonly string[]).includes(raw)) {
    return raw as VerificationStatus;
  }
  return 'all';
}

function parseUtilityParam(raw: string | null): UtilityFilter {
  if (raw && (UTILITY_GROUPS as readonly string[]).includes(raw)) {
    return raw as UtilityGroup;
  }
  return 'all';
}

export function AssetListPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') ?? '';
  const category = parseCategoryParam(searchParams.get('category'));
  const verificationStatus = parseVerificationParam(
    searchParams.get('verification'),
  );
  const utilityGroup = parseUtilityParam(searchParams.get('utility'));
  const assetTypeId = searchParams.get('type') ?? 'all';

  const { data: assetTypes = [] } = useAssetTypes(
    category === 'all' ? undefined : category,
  );
  const {
    data: items = [],
    isLoading,
    error,
  } = useAssets({
    search,
    category,
    verificationStatus,
    utilityGroup,
    assetTypeId,
  });

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key === 'category') {
      next.delete('type');
    }
    setSearchParams(next, { replace: true });
  };

  const hasActiveFilters =
    Boolean(search) ||
    category !== 'all' ||
    verificationStatus !== 'all' ||
    utilityGroup !== 'all' ||
    assetTypeId !== 'all';

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const categoryTabs: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All Assets' },
    { value: 'surface', label: 'Surface' },
    { value: 'underground', label: 'Underground' },
    { value: 'survey_reference', label: 'Survey Benchmarks' },
  ];

  const typeOptions = [
    { value: 'all', label: 'All asset types' },
    ...assetTypes.map((t) => ({ value: t.id, label: t.name })),
  ];

  const utilityOptions = [
    { value: 'all', label: 'All utility groups' },
    ...UTILITY_GROUPS.map((u) => ({
      value: u,
      label: UTILITY_GROUP_LABELS[u],
    })),
  ];

  const verificationOptions = [
    { value: 'all', label: 'All verification statuses' },
    { value: 'pending_review', label: 'Awaiting Review / Re-survey' },
    ...VERIFICATION_STATUSES.map((s) => ({
      value: s,
      label: VERIFICATION_STATUS_LABELS[s],
    })),
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Institutional Asset Register
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Search and inspect documented surface infrastructure, buried utilities,
            and survey control benchmarks.
          </p>
        </div>

        {can('assets:create') && (
          <Link to="/assets/new">
            <Button leftIcon={<PlusCircle className="h-4 w-4" />}>
              Log New Asset
            </Button>
          </Link>
        )}
      </div>

      {/* Search & Filter Bar */}
      <Card bodyClassName="space-y-3.5">
        {/* Category Quick Pills */}
        <div
          role="group"
          aria-label="Filter by asset category"
          className="flex flex-wrap gap-1.5"
        >
          {categoryTabs.map((tab) => {
            const active = category === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={active}
                onClick={() => updateFilter('category', tab.value)}
                className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'bg-bado-navy-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search + Structured Filters */}
        <div className="grid gap-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <label htmlFor="asset-registry-search" className="sr-only">
              Search assets and benchmarks
            </label>
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="asset-registry-search"
              type="search"
              value={search}
              onChange={(e) => updateFilter('q', e.target.value)}
              placeholder="Search by Asset ID, name, material, or Benchmark ID…"
              className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-3.5 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-bado-navy-700"
            />
          </div>

          <div className="md:col-span-2">
            <Select
              hideLabel
              label="Filter by asset type"
              options={typeOptions}
              value={assetTypeId}
              onChange={(e) => updateFilter('type', e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <Select
              hideLabel
              label="Filter by utility group"
              options={utilityOptions}
              value={utilityGroup}
              onChange={(e) => updateFilter('utility', e.target.value)}
            />
          </div>

          <div className="md:col-span-3">
            <Select
              hideLabel
              label="Filter by verification status"
              options={verificationOptions}
              value={verificationStatus}
              onChange={(e) => updateFilter('verification', e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <p>
            Showing{' '}
            <strong className="font-semibold text-slate-900">
              {isLoading ? '…' : items.length}
            </strong>{' '}
            {items.length === 1 ? 'record' : 'records'}
          </p>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={resetFilters}
            >
              Reset filters
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <Alert tone="danger" title="Failed to load asset register">
          {error instanceof Error ? error.message : 'Unexpected query error.'}
        </Alert>
      )}

      {/* Results List */}
      {isLoading ? (
        <Card>
          <p role="status" className="py-8 text-center text-sm text-slate-600">
            Loading institutional asset register…
          </p>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Database className="h-5 w-5" />}
          title={
            hasActiveFilters
              ? 'No matching assets found'
              : 'No assets registered yet'
          }
          description={
            hasActiveFilters
              ? 'Adjust your search keywords or clear active category, type, and verification filters.'
              : 'Begin building your campus infrastructure register by logging surface assets, buried utilities, or survey benchmarks.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Clear all filters
              </Button>
            ) : can('assets:create') ? (
              <Link to="/assets/new">
                <Button size="sm" leftIcon={<PlusCircle className="h-4 w-4" />}>
                  Log First Asset
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const { asset, assetType, campus, department, benchmark } = item;
            const isLinear =
              asset.geometry.type === 'LineString' ||
              asset.geometry.type === 'MultiLineString';

            return (
              <Link
                key={asset.id}
                to={`/assets/${asset.id}`}
                className="group block rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition-colors hover:border-bado-navy-600 hover:bg-slate-50/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-2xs"
                      style={{
                        backgroundColor: asset.isCriticalHazard
                          ? '#dc2626'
                          : assetType.colorHex,
                      }}
                    >
                      <LegendIcon iconKey={assetType.iconKey} className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-bado-navy-800">
                          {asset.assetCode}
                        </span>
                        {benchmark &&
                          benchmark.referenceCode !== asset.assetCode && (
                            <Badge tone="info">
                              Ref: {benchmark.referenceCode}
                            </Badge>
                          )}
                        <VerificationBadge status={asset.verificationStatus} />
                        {asset.isCriticalHazard && <CriticalHazardBadge />}
                        {asset.localSyncStatus === 'pending' && (
                          <PendingSyncBadge />
                        )}
                      </div>

                      <h2 className="mt-1 truncate text-sm font-semibold text-slate-900 sm:text-base">
                        {asset.name}
                      </h2>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span>{assetType.name}</span>
                        <span aria-hidden="true">·</span>
                        <span>{ASSET_CATEGORY_LABELS[asset.category]}</span>
                        {campus && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{campus.name}</span>
                          </>
                        )}
                        {department && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{department.code}</span>
                          </>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <AccuracyBadge
                          accuracyM={asset.horizontalAccuracyM}
                          fixQuality={asset.fixQuality}
                        />
                        {isLinear && (
                          <Badge tone="neutral">
                            <Route className="h-3 w-3" aria-hidden="true" />
                            Linear Route
                          </Badge>
                        )}
                        {asset.category === 'underground' &&
                          asset.recordedDepthM !== null && (
                            <Badge tone="neutral">
                              Depth: {asset.recordedDepthM.toFixed(2)} m
                              {asset.depthIsVariable ? ' (variable)' : ''}
                            </Badge>
                          )}
                        {benchmark && benchmark.elevationM !== null && (
                          <Badge tone="info">
                            Elev: {benchmark.elevationM.toFixed(3)} m (
                            {benchmark.verticalDatum})
                          </Badge>
                        )}
                        {item.photoCount > 0 && (
                          <Badge tone="neutral">
                            <Camera className="h-3 w-3" aria-hidden="true" />
                            {item.photoCount}
                          </Badge>
                        )}
                        {item.documentCount > 0 && (
                          <Badge tone="neutral">
                            <FileText className="h-3 w-3" aria-hidden="true" />
                            {item.documentCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <ChevronRight
                    className="mt-2 h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-bado-navy-800"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
