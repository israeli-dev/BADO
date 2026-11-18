import {
  AlertTriangle,
  BookOpen,
  Crosshair,
  Download,
  ExternalLink,
  Layers,
  LocateFixed,
  Maximize2,
  Pencil,
  Plus,
  Route,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Circle, Marker, Polygon, Polyline, Tooltip } from 'react-leaflet';
import { Link, useSearchParams } from 'react-router-dom';

import {
  BadoMapCanvas,
  createAssetDivIcon,
  createDepthBadgeDivIcon,
  createJunctionDivIcon,
  createRouteVertexDivIcon,
  DEFAULT_CAMPUS_CENTER,
  DEFAULT_CAMPUS_ZOOM,
} from '@/components/map/BadoMapCanvas';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LegendIcon } from '@/components/ui/LegendIcon';
import {
  useCampuses,
  useInstitutionSettings,
} from '@/features/admin/useInstitutionalData';
import {
  CriticalHazardBadge,
  DataQualityBadge,
  OperationalBadge,
  VerificationBadge,
} from '@/features/assets/AssetStatusBadges';
import { useAssetDetail, useAssets } from '@/features/assets/useAssets';
import { useAuth } from '@/features/auth/AuthContext';
import {
  triggerGeoJsonDownload,
  useExportAssetsGeoJson,
} from '@/features/routes/useLinearRoutes';
import {
  ASSET_CATEGORY_LABELS,
  DEPTH_METHOD_LABELS,
  GNSS_FIX_LABELS,
  formatRouteLength,
  JUNCTION_KIND_LABELS,
  OPERATIONAL_STATUS_LABELS,
  POSITION_SOURCE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/lib/assets/labels';
import { DEFAULT_LEGEND_CONFIG } from '@/lib/config/legend';
import { captureSingleGpsPosition } from '@/lib/geo/geolocation';
import {
  computeLeafletBounds,
  extractLineParts,
  isLinearGeometry,
  type LatLngBoundsTuple,
} from '@/lib/gis/geometry';
import { resolveAssetSymbology } from '@/lib/gis/symbology';
import type {
  AssetListFilters,
  AssetListItem,
  Campus,
  GeoCoordinates,
  OperationalStatus,
  VerificationStatus,
} from '@/types/domain';

type LayerGroupId =
  | 'water'
  | 'electricity'
  | 'telecom'
  | 'drainage_sewer'
  | 'critical_gas'
  | 'surface'
  | 'benchmarks'
  | 'other';

interface LayerToggleMeta {
  id: LayerGroupId;
  label: string;
  legendKey: string;
  fallbackColor: string;
}

const LAYER_GROUPS: readonly LayerToggleMeta[] = [
  {
    id: 'water',
    label: 'Water & Fire Lines',
    legendKey: 'water',
    fallbackColor: '#0284c7',
  },
  {
    id: 'electricity',
    label: 'Underground Electricity',
    legendKey: 'electricity',
    fallbackColor: '#ea580c',
  },
  {
    id: 'telecom',
    label: 'Fiber & Telecom Ducts',
    legendKey: 'telecom',
    fallbackColor: '#7c3aed',
  },
  {
    id: 'drainage_sewer',
    label: 'Drainage & Sewer',
    legendKey: 'drainage',
    fallbackColor: '#16a34a',
  },
  {
    id: 'critical_gas',
    label: 'Critical Hazards & Gas',
    legendKey: 'critical_hazard',
    fallbackColor: '#dc2626',
  },
  {
    id: 'surface',
    label: 'Surface Facilities',
    legendKey: 'surface_facility',
    fallbackColor: '#475569',
  },
  {
    id: 'benchmarks',
    label: 'Survey Benchmarks',
    legendKey: 'survey_benchmark',
    fallbackColor: '#0891b2',
  },
  {
    id: 'other',
    label: 'Other Utilities',
    legendKey: 'surface_facility',
    fallbackColor: '#64748b',
  },
];

const ALL_LAYER_IDS: LayerGroupId[] = LAYER_GROUPS.map((l) => l.id);
const EMPTY_ASSETS: AssetListItem[] = [];
const EMPTY_CAMPUSES: Campus[] = [];

function classifyAssetLayer(item: AssetListItem): LayerGroupId {
  const { asset } = item;
  if (asset.category === 'survey_reference') return 'benchmarks';
  if (
    asset.isCriticalHazard ||
    asset.utilityGroup === 'critical_hazard' ||
    asset.utilityGroup === 'gas'
  ) {
    return 'critical_gas';
  }
  if (asset.category === 'surface') return 'surface';
  switch (asset.utilityGroup) {
    case 'water':
      return 'water';
    case 'electrical':
      return 'electricity';
    case 'telecom':
      return 'telecom';
    case 'drainage_sewer':
      return 'drainage_sewer';
    default:
      return 'other';
  }
}

export function InfrastructureMapPage() {
  const { activeInstitution, activeCampusId, session, can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAssetId = searchParams.get('assetId');

  const [searchText, setSearchText] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<
    VerificationStatus | 'all' | 'pending_review'
  >('all');
  const [operationalFilter, setOperationalFilter] = useState<
    OperationalStatus | 'all'
  >('all');
  const [geometryScope, setGeometryScope] = useState<
    'all' | 'points' | 'linear'
  >('all');
  const [enabledLayers, setEnabledLayers] = useState<Set<LayerGroupId>>(
    () => new Set(ALL_LAYER_IDS),
  );
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [showLegendPanel, setShowLegendPanel] = useState(false);

  // User foreground one-shot location state (never background tracked)
  const [myLocation, setMyLocation] = useState<{
    coords: GeoCoordinates;
    accuracyM: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    message: string;
  } | null>(null);

  // Explicit viewport trigger counters
  const [manualBounds, setManualBounds] = useState<LatLngBoundsTuple | null>(
    null,
  );
  const [manualFitCount, setManualFitCount] = useState(0);
  const [focusPoint, setFocusPoint] = useState<GeoCoordinates | null>(null);
  const [focusZoom, setFocusZoom] = useState(17);
  const [focusCount, setFocusCount] = useState(0);

  const { data: settings } = useInstitutionSettings();
  const { data: campusesData } = useCampuses();
  const campuses = campusesData ?? EMPTY_CAMPUSES;

  const legendEntries = settings?.legendConfig?.length
    ? settings.legendConfig
    : DEFAULT_LEGEND_CONFIG;

  const queryFilters: Omit<AssetListFilters, 'campusId'> = useMemo(
    () => ({
      verificationStatus: verificationFilter,
      operationalStatus: operationalFilter,
      geometryScope,
    }),
    [verificationFilter, operationalFilter, geometryScope],
  );

  const {
    data: assetsData,
    isLoading,
    error,
  } = useAssets(queryFilters);
  const allAssets = assetsData ?? EMPTY_ASSETS;

  const exportMutation = useExportAssetsGeoJson();

  const activeCampus = useMemo(
    () => campuses.find((c) => c.id === activeCampusId) ?? campuses[0] ?? null,
    [campuses, activeCampusId],
  );

  const layerCounts = useMemo(() => {
    const counts = new Map<LayerGroupId, number>();
    for (const item of allAssets) {
      const id = classifyAssetLayer(item);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [allAssets]);

  const visibleAssets = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return allAssets.filter((item) => {
      const layer = classifyAssetLayer(item);
      if (!enabledLayers.has(layer)) return false;
      if (!needle) return true;
      const hay = [
        item.asset.assetCode,
        item.asset.name,
        item.assetType.name,
        item.asset.material ?? '',
        item.asset.locationReferenceText ?? '',
        item.benchmark?.referenceCode ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [allAssets, enabledLayers, searchText]);

  const selectedItem = useMemo(
    () =>
      selectedAssetId
        ? (allAssets.find((item) => item.asset.id === selectedAssetId) ?? null)
        : null,
    [allAssets, selectedAssetId],
  );

  // Fetch route depth observations & junctions when a linear asset is selected
  const { data: selectedDetail } = useAssetDetail(
    selectedItem && isLinearGeometry(selectedItem.asset.geometry)
      ? selectedItem.asset.id
      : undefined,
  );

  const autoBounds = useMemo(() => {
    if (selectedItem) {
      return computeLeafletBounds([selectedItem.asset.geometry]);
    }
    if (visibleAssets.length > 0) {
      return computeLeafletBounds(visibleAssets.map((i) => i.asset.geometry));
    }
    return null;
  }, [selectedItem, visibleAssets]);

  const effectiveBounds = manualFitCount > 0 ? manualBounds : autoBounds;
  const effectiveFitKey =
    manualFitCount > 0
      ? `manual-${manualFitCount}`
      : selectedItem
        ? `selected-${selectedItem.asset.id}`
        : visibleAssets.length > 0
          ? `campus-${activeCampusId ?? 'all'}`
          : undefined;

  const selectAsset = (assetId: string | null) => {
    setManualFitCount(0);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (assetId) {
          next.set('assetId', assetId);
        } else {
          next.delete('assetId');
        }
        return next;
      },
      { replace: true },
    );
  };

  const toggleLayer = (layerId: LayerGroupId) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const handleFitVisible = () => {
    const b = computeLeafletBounds(visibleAssets.map((i) => i.asset.geometry));
    if (b) {
      setManualBounds(b);
      setManualFitCount((c) => c + 1);
    } else if (activeCampus?.center) {
      setFocusPoint(activeCampus.center);
      setFocusZoom(activeCampus.defaultZoom || DEFAULT_CAMPUS_ZOOM);
      setFocusCount((c) => c + 1);
    }
  };

  const handleZoomToAsset = (item: AssetListItem) => {
    const b = computeLeafletBounds([item.asset.geometry]);
    if (b) {
      setManualBounds(b);
      setManualFitCount((c) => c + 1);
    }
  };

  const handleLocateMe = async () => {
    setIsLocating(true);
    setFeedbackBanner(null);
    try {
      const fix = await captureSingleGpsPosition();
      const coords = { lat: fix.latitude, lng: fix.longitude };
      setMyLocation({ coords, accuracyM: fix.horizontalAccuracyM });
      setFocusPoint(coords);
      setFocusZoom(18);
      setFocusCount((c) => c + 1);
      if (fix.horizontalAccuracyM > 15) {
        setFeedbackBanner({
          variant: 'warning',
          message: `Current GPS accuracy is ±${fix.horizontalAccuracyM.toFixed(1)} m (moderate/poor). Treat field alignment with caution.`,
        });
      }
    } catch (err) {
      setFeedbackBanner({
        variant: 'warning',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to determine current GPS location.',
      });
    } finally {
      setIsLocating(false);
    }
  };

  const handleExportGeoJson = async () => {
    setFeedbackBanner(null);
    try {
      const collection = await exportMutation.mutateAsync({
        ...queryFilters,
        search: searchText.trim() || undefined,
      });
      const filename = triggerGeoJsonDownload(
        collection,
        `${activeInstitution?.shortCode ?? 'bado'}-infrastructure`,
      );
      setFeedbackBanner({
        variant: 'success',
        message: `Exported ${collection.features.length} spatial feature(s) to ${filename} (EPSG:4326, QGIS-ready).`,
      });
    } catch (err) {
      setFeedbackBanner({
        variant: 'danger',
        message:
          err instanceof Error ? err.message : 'Failed to export GeoJSON.',
      });
    }
  };

  const linearCount = useMemo(
    () =>
      visibleAssets.filter((i) => isLinearGeometry(i.asset.geometry)).length,
    [visibleAssets],
  );
  const pointCount = visibleAssets.length - linearCount;
  const hazardCount = useMemo(
    () => visibleAssets.filter((i) => i.asset.isCriticalHazard).length,
    [visibleAssets],
  );

  const canEditSelectedRoute = useMemo(() => {
    if (!selectedItem || !isLinearGeometry(selectedItem.asset.geometry)) {
      return false;
    }
    if (can('routes:edit_geometry')) return true;
    return (
      can('assets:edit_own_draft') &&
      selectedItem.asset.createdBy === session?.user.id &&
      (selectedItem.asset.verificationStatus === 'draft' ||
        selectedItem.asset.verificationStatus === 'rejected' ||
        selectedItem.asset.verificationStatus === 'needs_resurvey')
    );
  }, [selectedItem, can, session?.user.id]);

  const junctionIcon = useMemo(() => createJunctionDivIcon(), []);

  return (
    <div className="space-y-4">
      {/* Header & primary GIS toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Campus GIS Infrastructure Map
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            {activeCampus ? activeCampus.name : 'All permitted campuses'} ·{' '}
            <span className="font-medium text-slate-800">
              {visibleAssets.length}
            </span>{' '}
            of {allAssets.length} features shown ({pointCount} point,{' '}
            {linearCount} linear routes
            {hazardCount > 0 ? `, ${hazardCount} critical hazard` : ''})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can('assets:create') && (
            <Link to="/assets/new">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Register Point
              </Button>
            </Link>
          )}
          {can('routes:record') && (
            <Link to="/routes/new">
              <Button
                type="button"
                variant="primary"
                size="sm"
                leftIcon={<Route className="h-4 w-4" />}
              >
                Record Route
              </Button>
            </Link>
          )}
          {can('gis:export') && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              isLoading={exportMutation.isPending}
              onClick={() => void handleExportGeoJson()}
            >
              Export GeoJSON
            </Button>
          )}
        </div>
      </div>

      {feedbackBanner && (
        <Alert tone={feedbackBanner.variant}>{feedbackBanner.message}</Alert>
      )}
      {error && (
        <Alert tone="danger" title="Failed to load spatial layers">
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      )}

      {/* Search, filter & map control bar */}
      <Card className="p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
          <div className="relative lg:col-span-4">
            <input
              aria-label="Search map assets and routes"
              placeholder="Search asset ID, name, material, benchmark…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 text-sm"
            />
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
          </div>

          <div className="lg:col-span-2">
            <select className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              aria-label="Filter by geometry type"
              value={geometryScope}
              onChange={(e) =>
                setGeometryScope(e.target.value as 'all' | 'points' | 'linear')
              }
            >
              <option value="all">All geometries</option>
              <option value="linear">Linear routes only</option>
              <option value="points">Point assets only</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              aria-label="Filter by verification status"
              value={verificationFilter}
              onChange={(e) =>
                setVerificationFilter(
                  e.target.value as
                    | VerificationStatus
                    | 'all'
                    | 'pending_review',
                )
              }
            >
              <option value="all">All verification states</option>
              <option value="verified">Verified only</option>
              <option value="pending_review">Pending review</option>
              {(
                Object.entries(VERIFICATION_STATUS_LABELS) as [
                  VerificationStatus,
                  string,
                ][]
              )
                .filter(([key]) => key !== 'verified')
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </div>

          <div className="lg:col-span-3">
            <select className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              aria-label="Filter by operational status"
              value={operationalFilter}
              onChange={(e) =>
                setOperationalFilter(
                  e.target.value as OperationalStatus | 'all',
                )
              }
            >
              <option value="all">All operational states</option>
              {(
                Object.entries(OPERATIONAL_STATUS_LABELS) as [
                  OperationalStatus,
                  string,
                ][]
              ).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={showLayerPanel ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={showLayerPanel}
              leftIcon={<Layers className="h-3.5 w-3.5" />}
              onClick={() => setShowLayerPanel((v) => !v)}
            >
              Layers ({enabledLayers.size}/{LAYER_GROUPS.length})
            </Button>
            <Button
              type="button"
              variant={showLegendPanel ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={showLegendPanel}
              leftIcon={<BookOpen className="h-3.5 w-3.5" />}
              onClick={() => setShowLegendPanel((v) => !v)}
            >
              Symbology & Legend
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Maximize2 className="h-3.5 w-3.5" />}
              onClick={handleFitVisible}
            >
              Fit Visible
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<LocateFixed className="h-3.5 w-3.5" />}
              isLoading={isLocating}
              onClick={() => void handleLocateMe()}
            >
              My GPS
            </Button>
          </div>
        </div>
      </Card>

      {/* Main GIS workspace: Layer rail + Interactive Leaflet canvas + Inspector */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {showLayerPanel && (
          <Card className="space-y-3 p-3.5 xl:col-span-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Utility & Survey Layers
              </h2>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setEnabledLayers(new Set(ALL_LAYER_IDS))}
                  className="font-medium text-sky-800 hover:underline"
                >
                  All
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setEnabledLayers(new Set())}
                  className="font-medium text-slate-600 hover:underline"
                >
                  None
                </button>
              </div>
            </div>

            <div className="space-y-1.5" role="group" aria-label="Map layer visibility toggles">
              {LAYER_GROUPS.map((group) => {
                const count = layerCounts.get(group.id) ?? 0;
                const checked = enabledLayers.has(group.id);
                const legendMatch = legendEntries.find(
                  (entry) => entry.key === group.legendKey,
                );
                const swatch = legendMatch?.colorHex ?? group.fallbackColor;
                return (
                  <label
                    key={group.id}
                    className={`flex min-h-[40px] cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm transition ${
                      checked
                        ? 'border-slate-300 bg-white text-slate-900'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLayer(group.id)}
                        className="h-4 w-4 rounded border-slate-300 text-[#0f2942] focus:ring-[#0f2942]"
                      />
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: swatch }}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-medium">{group.label}</span>
                    </span>
                    <Badge>
                      {count}
                    </Badge>
                  </label>
                );
              })}
            </div>

            {/* Quick feature jumper for accessibility & keyboard-only inspection */}
            <div className="border-t border-slate-100 pt-3">
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                Visible Features ({visibleAssets.length})
              </h3>
              {isLoading ? (
                <p className="text-xs text-slate-500">Loading spatial layers…</p>
              ) : visibleAssets.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No mapped features match the active layers and filters.
                </p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {visibleAssets.slice(0, 40).map((item) => {
                    const isSelected = selectedItem?.asset.id === item.asset.id;
                    const sym = resolveAssetSymbology(
                      item.asset,
                      item.assetType,
                      legendEntries,
                    );
                    const linear = isLinearGeometry(item.asset.geometry);
                    return (
                      <li key={item.asset.id}>
                        <button
                          type="button"
                          onClick={() => {
                            selectAsset(item.asset.id);
                            handleZoomToAsset(item);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                            isSelected
                              ? 'bg-[#0f2942] font-medium text-white'
                              : 'hover:bg-slate-100 text-slate-800'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: sym.colorHex }}
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              <span className="font-mono">
                                {item.asset.assetCode}
                              </span>{' '}
                              · {item.asset.name}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[10px] ${
                              isSelected ? 'text-slate-200' : 'text-slate-500'
                            }`}
                          >
                            {linear
                              ? formatRouteLength(item.asset.routeLengthM)
                              : 'PT'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        )}

        <div
          className={`space-y-4 ${
            showLayerPanel && selectedItem
              ? 'xl:col-span-6'
              : showLayerPanel || selectedItem
                ? 'xl:col-span-9'
                : 'xl:col-span-12'
          }`}
        >
          <BadoMapCanvas
            center={activeCampus?.center ?? DEFAULT_CAMPUS_CENTER}
            zoom={activeCampus?.defaultZoom ?? DEFAULT_CAMPUS_ZOOM}
            bounds={effectiveBounds}
            fitKey={effectiveFitKey}
            focusPoint={focusPoint}
            focusZoom={focusZoom}
            focusKey={focusCount || undefined}
            heightClassName="h-[500px] sm:h-[560px]"
            ariaLabel="Interactive university campus GIS map"
          >
            {/* Render linear utility corridors & polygon facilities first */}
            {visibleAssets.map((item) => {
              const { asset, assetType } = item;
              const isSelected = selectedItem?.asset.id === asset.id;
              const sym = resolveAssetSymbology(asset, assetType, legendEntries);

              if (
                asset.geometry.type === 'LineString' ||
                asset.geometry.type === 'MultiLineString'
              ) {
                const parts = extractLineParts(asset.geometry);
                return parts.map((part, pIdx) => {
                  const latLngs: [number, number][] = part.map((pt) => [
                    pt.lat,
                    pt.lng,
                  ]);
                  const first = part[0];
                  const last = part[part.length - 1];
                  return (
                    <Fragment key={`${asset.id}-p${pIdx}`}>
                      {/* Outdoor-readable halo + selection highlight */}
                      <Polyline
                        positions={latLngs}
                        pathOptions={{
                          color: isSelected ? '#0f172a' : '#ffffff',
                          weight: sym.strokeWeight + (isSelected ? 5 : 3),
                          opacity: isSelected ? 0.9 : 0.88,
                        }}
                      />
                      {/* Primary configurable utility stroke */}
                      <Polyline
                        positions={latLngs}
                        pathOptions={{
                          color: sym.colorHex,
                          weight: isSelected
                            ? sym.strokeWeight + 1.5
                            : sym.strokeWeight,
                          dashArray: sym.dashArray,
                          opacity: 0.96,
                        }}
                        eventHandlers={{
                          click: () => selectAsset(asset.id),
                        }}
                      >
                        <Tooltip sticky>
                          <span className="font-mono font-semibold">
                            {asset.assetCode}
                          </span>{' '}
                          · {asset.name} ({formatRouteLength(asset.routeLengthM)}
                          {asset.recordedDepthM !== null
                            ? ` · depth ${asset.recordedDepthM.toFixed(2)} m`
                            : ''}
                          )
                        </Tooltip>
                      </Polyline>
                      {/* Wide transparent hit line for finger taps on mobile field devices */}
                      <Polyline
                        positions={latLngs}
                        pathOptions={{
                          color: sym.colorHex,
                          weight: 18,
                          opacity: 0,
                        }}
                        eventHandlers={{
                          click: () => selectAsset(asset.id),
                        }}
                      />
                      {isSelected && first && (
                        <Marker
                          position={[first.lat, first.lng]}
                          icon={createRouteVertexDivIcon({
                            index: 0,
                            isStart: true,
                            isEnd: false,
                            colorHex: sym.colorHex,
                          })}
                        >
                          <Tooltip direction="top">
                            Start node ({asset.assetCode})
                          </Tooltip>
                        </Marker>
                      )}
                      {isSelected && last && part.length >= 2 && (
                        <Marker
                          position={[last.lat, last.lng]}
                          icon={createRouteVertexDivIcon({
                            index: part.length - 1,
                            isStart: false,
                            isEnd: true,
                            colorHex: sym.colorHex,
                          })}
                        >
                          <Tooltip direction="top">
                            End node ({asset.assetCode})
                          </Tooltip>
                        </Marker>
                      )}
                    </Fragment>
                  );
                });
              }

              if (asset.geometry.type === 'Polygon') {
                const rings = asset.geometry.coordinates.map((ring) =>
                  ring.map((pos): [number, number] => [
                    pos[1] ?? 0,
                    pos[0] ?? 0,
                  ]),
                );
                return (
                  <Polygon
                    key={asset.id}
                    positions={rings}
                    pathOptions={{
                      color: sym.colorHex,
                      weight: isSelected ? 4 : 2.5,
                      fillColor: sym.colorHex,
                      fillOpacity: isSelected ? 0.28 : 0.14,
                    }}
                    eventHandlers={{
                      click: () => selectAsset(asset.id),
                    }}
                  >
                    <Tooltip sticky>
                      {asset.assetCode} · {asset.name}
                    </Tooltip>
                  </Polygon>
                );
              }

              if (asset.geometry.type === 'Point') {
                const lat = asset.geometry.coordinates[1] ?? 0;
                const lng = asset.geometry.coordinates[0] ?? 0;
                return (
                  <Fragment key={asset.id}>
                    {isSelected &&
                      asset.horizontalAccuracyM !== null &&
                      asset.horizontalAccuracyM > 0 && (
                        <Circle
                          center={[lat, lng]}
                          radius={asset.horizontalAccuracyM}
                          pathOptions={{
                            color: sym.colorHex,
                            weight: 1.5,
                            dashArray: '4 4',
                            fillColor: sym.colorHex,
                            fillOpacity: 0.12,
                          }}
                        />
                      )}
                    <Marker
                      position={[lat, lng]}
                      icon={createAssetDivIcon(sym, asset.category, isSelected)}
                      eventHandlers={{
                        click: () => selectAsset(asset.id),
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -14]}>
                        <span className="font-mono font-semibold">
                          {asset.assetCode}
                        </span>{' '}
                        · {asset.name} ({assetType.name})
                      </Tooltip>
                    </Marker>
                  </Fragment>
                );
              }

              return null;
            })}

            {/* Depth & junction markers along the actively inspected linear route */}
            {selectedDetail?.depthObservations.map((obs) => (
              <Marker
                key={`depth-${obs.id}`}
                position={[obs.location.lat, obs.location.lng]}
                icon={createDepthBadgeDivIcon(obs.depthM)}
              >
                <Tooltip direction="top">
                  Observed depth {obs.depthM.toFixed(2)} m ·{' '}
                  {DEPTH_METHOD_LABELS[obs.measurementMethod]}
                  {obs.chainageM !== null
                    ? ` (ch. ${obs.chainageM.toFixed(1)} m)`
                    : ''}
                </Tooltip>
              </Marker>
            ))}

            {selectedDetail?.junctions.map((jn) => (
              <Marker
                key={`jn-${jn.id}`}
                position={[jn.location.lat, jn.location.lng]}
                icon={junctionIcon}
              >
                <Tooltip direction="top">
                  {JUNCTION_KIND_LABELS[jn.junctionKind]}
                  {jn.label ? `: ${jn.label}` : ''}
                </Tooltip>
              </Marker>
            ))}

            {/* One-shot foreground user GPS position + accuracy circle */}
            {myLocation && (
              <>
                <Circle
                  center={[myLocation.coords.lat, myLocation.coords.lng]}
                  radius={myLocation.accuracyM}
                  pathOptions={{
                    color: '#2563eb',
                    weight: 1.5,
                    fillColor: '#3b82f6',
                    fillOpacity: 0.16,
                  }}
                />
                <Circle
                  center={[myLocation.coords.lat, myLocation.coords.lng]}
                  radius={Math.max(1.5, Math.min(4, myLocation.accuracyM / 4))}
                  pathOptions={{
                    color: '#ffffff',
                    weight: 2.5,
                    fillColor: '#1d4ed8',
                    fillOpacity: 1,
                  }}
                >
                  <Tooltip direction="top">
                    Your foreground GPS position (±
                    {myLocation.accuracyM.toFixed(1)} m)
                  </Tooltip>
                </Circle>
              </>
            )}
          </BadoMapCanvas>

          {/* Expandable configurable institutional colour, icon & line-style legend */}
          {showLegendPanel && (
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Institutional Utility Symbology & Map Legend
                </h2>
                <button
                  type="button"
                  onClick={() => setShowLegendPanel(false)}
                  aria-label="Close legend"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {legendEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
                      style={{ backgroundColor: entry.colorHex }}
                      aria-hidden="true"
                    >
                      <LegendIcon iconKey={entry.iconKey} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {entry.label}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className="inline-block w-10 border-t-[3px]"
                          style={{
                            borderColor: entry.colorHex,
                            borderStyle: entry.lineStyle,
                          }}
                          aria-hidden="true"
                        />
                        <span className="text-[11px] text-slate-500 capitalize">
                          {entry.lineStyle}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                <span>
                  <strong>Solid marker ring / continuous line:</strong> Formally
                  verified record
                </span>
                <span>
                  <strong>Dashed marker ring / long-dash line:</strong>{' '}
                  Unverified, draft, or pending survey confirmation
                </span>
                <span>
                  <strong>Diamond marker:</strong> Survey benchmark / junction
                </span>
              </div>

              <p className="text-xs text-slate-500">
                Symbology is configurable per institution in{' '}
                <strong>Institution Admin → Legend</strong> and serves as an
                engineering visual convention—not a statutory local utility
                colour law. Always read asset status, accuracy, and depth before
                field work.
              </p>
            </Card>
          )}

          {/* Mandatory infrastructure safety disclaimer */}
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <p>
              <strong>Field Safety Notice:</strong> BADO displays documented
              infrastructure available in the institutional register. Unrecorded
              or inaccurately mapped utilities may exist. Confirm underground
              services using appropriate professional utility detection and
              verification before excavation.
            </p>
          </div>
        </div>

        {/* Selected Asset / Linear Route Inspector */}
        {selectedItem && (
          <Card
            className="space-y-3.5 p-4 xl:col-span-3"
            aria-label="Selected infrastructure inspector"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-slate-500">
                  {selectedItem.asset.assetCode}
                </p>
                <h2 className="mt-0.5 text-base font-bold text-slate-900">
                  {selectedItem.asset.name}
                </h2>
                <p className="text-xs text-slate-600">
                  {selectedItem.assetType.name} ·{' '}
                  {ASSET_CATEGORY_LABELS[selectedItem.asset.category]}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close asset inspector"
                onClick={() => selectAsset(null)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {selectedItem.asset.isCriticalHazard && <CriticalHazardBadge />}
              <VerificationBadge
                status={selectedItem.asset.verificationStatus}
              />
              <OperationalBadge
                status={selectedItem.asset.operationalStatus}
              />
              <DataQualityBadge quality={selectedItem.asset.dataQuality} />
            </div>

            {selectedItem.asset.verificationStatus !== 'verified' && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <span>
                  This alignment is{' '}
                  <strong>
                    {
                      VERIFICATION_STATUS_LABELS[
                        selectedItem.asset.verificationStatus
                      ]
                    }
                  </strong>{' '}
                  and has not completed formal supervisor verification.
                </span>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs">
              <div>
                <dt className="text-slate-500">Geometry</dt>
                <dd className="font-medium text-slate-900">
                  {selectedItem.asset.geometry.type}
                </dd>
              </div>

              {isLinearGeometry(selectedItem.asset.geometry) && (
                <div>
                  <dt className="text-slate-500">Route Length</dt>
                  <dd className="font-mono font-semibold text-slate-900">
                    {formatRouteLength(selectedItem.asset.routeLengthM)}
                  </dd>
                </div>
              )}

              <div>
                <dt className="text-slate-500">Recorded Depth</dt>
                <dd className="font-medium text-slate-900">
                  {selectedItem.asset.recordedDepthM !== null
                    ? `${selectedItem.asset.recordedDepthM.toFixed(2)} m${
                        selectedItem.asset.depthIsVariable ? ' (variable)' : ''
                      }`
                    : 'Not recorded'}
                </dd>
              </div>

              {(selectedItem.depthObservationCount ?? 0) > 0 && (
                <div>
                  <dt className="text-slate-500">Observed Range</dt>
                  <dd className="font-mono font-medium text-slate-900">
                    {selectedItem.minDepthM?.toFixed(2)}–
                    {selectedItem.maxDepthM?.toFixed(2)} m (
                    {selectedItem.depthObservationCount} pts)
                  </dd>
                </div>
              )}

              {selectedItem.asset.depthMeasurementMethod && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Depth Method</dt>
                  <dd className="font-medium text-slate-900">
                    {
                      DEPTH_METHOD_LABELS[
                        selectedItem.asset.depthMeasurementMethod
                      ]
                    }
                    {selectedItem.asset.documentedBeforeCovering
                      ? ' · Documented before covering'
                      : ''}
                  </dd>
                </div>
              )}

              {(selectedItem.asset.material ||
                selectedItem.asset.diameterMm !== null ||
                selectedItem.asset.cableSpecification) && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Specification</dt>
                  <dd className="font-medium text-slate-900">
                    {[
                      selectedItem.asset.material,
                      selectedItem.asset.diameterMm !== null
                        ? `Ø${selectedItem.asset.diameterMm} mm`
                        : null,
                      selectedItem.asset.cableSpecification,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </div>
              )}

              {selectedItem.benchmark && (
                <div className="col-span-2 rounded-md bg-cyan-50 p-2">
                  <dt className="font-semibold text-cyan-900">
                    Benchmark {selectedItem.benchmark.referenceCode}
                  </dt>
                  <dd className="mt-0.5 text-cyan-950">
                    {selectedItem.benchmark.monumentType}
                    {selectedItem.benchmark.elevationM !== null
                      ? ` · ${selectedItem.benchmark.elevationM.toFixed(3)} m (${selectedItem.benchmark.verticalDatum})`
                      : ''}
                  </dd>
                </div>
              )}

              <div>
                <dt className="text-slate-500">Horizontal Acc.</dt>
                <dd className="font-mono font-medium text-slate-900">
                  {selectedItem.asset.horizontalAccuracyM !== null
                    ? `±${selectedItem.asset.horizontalAccuracyM.toFixed(2)} m`
                    : 'Unstated'}
                </dd>
              </div>

              <div>
                <dt className="text-slate-500">GNSS Fix</dt>
                <dd className="font-medium text-slate-900">
                  {GNSS_FIX_LABELS[selectedItem.asset.fixQuality]}
                </dd>
              </div>

              <div className="col-span-2">
                <dt className="text-slate-500">Position Source</dt>
                <dd className="font-medium text-slate-900">
                  {POSITION_SOURCE_LABELS[selectedItem.asset.positionSource]}
                  {selectedItem.asset.isManuallyAdjusted
                    ? ' (manually adjusted)'
                    : ''}
                </dd>
              </div>

              {selectedItem.campus && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Campus & Unit</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.campus.name}
                    {selectedItem.department
                      ? ` · ${selectedItem.department.name}`
                      : ''}
                  </dd>
                </div>
              )}
            </dl>

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
              <Link to={`/assets/${selectedItem.asset.id}`}>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="w-full"
                  leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                >
                  Open Full Asset Record
                </Button>
              </Link>
              {canEditSelectedRoute && (
                <Link to={`/routes/${selectedItem.asset.id}/edit`}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                  >
                    Edit Route Geometry
                  </Button>
                </Link>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                leftIcon={<Crosshair className="h-3.5 w-3.5" />}
                onClick={() => handleZoomToAsset(selectedItem)}
              >
                Zoom to Feature
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
