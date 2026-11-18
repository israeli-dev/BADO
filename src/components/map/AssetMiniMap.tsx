import { Map as MapIcon, Pencil } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { Circle, Marker, Polygon, Polyline, Tooltip } from 'react-leaflet';
import { Link } from 'react-router-dom';

import {
  BadoMapCanvas,
  createAssetDivIcon,
  createDepthBadgeDivIcon,
  createJunctionDivIcon,
  createRouteVertexDivIcon,
} from '@/components/map/BadoMapCanvas';
import { Button } from '@/components/ui/Button';
import {
  DEPTH_METHOD_LABELS,
  formatRouteLength,
  JUNCTION_KIND_LABELS,
} from '@/lib/assets/labels';
import { DEFAULT_LEGEND_CONFIG } from '@/lib/config/legend';
import {
  computeLeafletBounds,
  extractLineParts,
  isLinearGeometry,
} from '@/lib/gis/geometry';
import { resolveAssetSymbology } from '@/lib/gis/symbology';
import type {
  AssetRecord,
  AssetTypeDefinition,
  LegendEntry,
  UtilityDepthObservationRecord,
  UtilityJunctionRecord,
} from '@/types/domain';

export interface AssetMiniMapProps {
  asset: AssetRecord;
  assetType: AssetTypeDefinition;
  depthObservations?: UtilityDepthObservationRecord[];
  junctions?: UtilityJunctionRecord[];
  legendConfig?: readonly LegendEntry[];
  canEditRouteGeometry?: boolean;
  heightClassName?: string;
}

export function AssetMiniMap({
  asset,
  assetType,
  depthObservations = [],
  junctions = [],
  legendConfig = DEFAULT_LEGEND_CONFIG,
  canEditRouteGeometry = false,
  heightClassName = 'h-64',
}: AssetMiniMapProps) {
  const symbology = useMemo(
    () => resolveAssetSymbology(asset, assetType, legendConfig),
    [asset, assetType, legendConfig],
  );

  const bounds = useMemo(
    () => computeLeafletBounds([asset.geometry]),
    [asset.geometry],
  );

  const linear = isLinearGeometry(asset.geometry);

  const lineParts = useMemo(() => {
    if (
      asset.geometry.type === 'LineString' ||
      asset.geometry.type === 'MultiLineString'
    ) {
      return extractLineParts(asset.geometry);
    }
    return [];
  }, [asset.geometry]);

  const pointCoords =
    asset.geometry.type === 'Point'
      ? {
          lat: asset.geometry.coordinates[1] ?? 0,
          lng: asset.geometry.coordinates[0] ?? 0,
        }
      : null;

  const polygonRings =
    asset.geometry.type === 'Polygon'
      ? asset.geometry.coordinates.map((ring) =>
          ring.map((pos): [number, number] => [pos[1] ?? 0, pos[0] ?? 0]),
        )
      : null;

  const initialCenter = pointCoords ??
    lineParts[0]?.[0] ?? { lat: 7.4443, lng: 3.8995 };

  const pointIcon = useMemo(
    () => createAssetDivIcon(symbology, asset.category, true),
    [symbology, asset.category],
  );
  const startIcon = useMemo(
    () =>
      createRouteVertexDivIcon({
        index: 0,
        isStart: true,
        isEnd: false,
        colorHex: symbology.colorHex,
      }),
    [symbology.colorHex],
  );
  const endIcon = useMemo(
    () =>
      createRouteVertexDivIcon({
        index: 1,
        isStart: false,
        isEnd: true,
        colorHex: symbology.colorHex,
      }),
    [symbology.colorHex],
  );
  const junctionIcon = useMemo(() => createJunctionDivIcon(), []);

  return (
    <div className="space-y-2.5">
      <BadoMapCanvas
        center={initialCenter}
        zoom={17}
        bounds={bounds}
        fitKey={`${asset.id}:${asset.version}`}
        scrollWheelZoom={false}
        heightClassName={heightClassName}
        ariaLabel={`Spatial location preview for ${asset.assetCode} ${asset.name}`}
      >
        {pointCoords &&
          asset.horizontalAccuracyM !== null &&
          asset.horizontalAccuracyM > 0 && (
            <Circle
              center={[pointCoords.lat, pointCoords.lng]}
              radius={asset.horizontalAccuracyM}
              pathOptions={{
                color: symbology.colorHex,
                weight: 1.5,
                dashArray: '4 4',
                fillColor: symbology.colorHex,
                fillOpacity: 0.12,
              }}
            />
          )}

        {pointCoords && (
          <Marker position={[pointCoords.lat, pointCoords.lng]} icon={pointIcon}>
            <Tooltip direction="top" offset={[0, -14]}>
              {asset.assetCode} · {asset.name}
            </Tooltip>
          </Marker>
        )}

        {lineParts.map((part, partIdx) => {
          const latLngs: [number, number][] = part.map((pt) => [pt.lat, pt.lng]);
          const first = part[0];
          const last = part[part.length - 1];
          return (
            <Fragment key={`part-${partIdx}`}>
              {/* High-contrast white halo casing for outdoor legibility */}
              <Polyline
                positions={latLngs}
                pathOptions={{
                  color: '#ffffff',
                  weight: symbology.strokeWeight + 3,
                  opacity: 0.9,
                }}
              />
              <Polyline
                positions={latLngs}
                pathOptions={{
                  color: symbology.colorHex,
                  weight: symbology.strokeWeight,
                  dashArray: symbology.dashArray,
                  opacity: 0.96,
                }}
              >
                <Tooltip sticky>
                  {asset.assetCode} · {formatRouteLength(asset.routeLengthM)}
                </Tooltip>
              </Polyline>
              {first && (
                <Marker position={[first.lat, first.lng]} icon={startIcon}>
                  <Tooltip direction="top">
                    Route start ({first.lat.toFixed(6)}, {first.lng.toFixed(6)})
                  </Tooltip>
                </Marker>
              )}
              {last && part.length >= 2 && (
                <Marker position={[last.lat, last.lng]} icon={endIcon}>
                  <Tooltip direction="top">
                    Route end ({last.lat.toFixed(6)}, {last.lng.toFixed(6)})
                  </Tooltip>
                </Marker>
              )}
            </Fragment>
          );
        })}

        {polygonRings && (
          <Polygon
            positions={polygonRings}
            pathOptions={{
              color: symbology.colorHex,
              weight: 3,
              fillColor: symbology.colorHex,
              fillOpacity: 0.18,
            }}
          />
        )}

        {depthObservations.map((obs) => (
          <Marker
            key={obs.id}
            position={[obs.location.lat, obs.location.lng]}
            icon={createDepthBadgeDivIcon(obs.depthM)}
          >
            <Tooltip direction="top">
              Depth {obs.depthM.toFixed(2)} m (
              {DEPTH_METHOD_LABELS[obs.measurementMethod]})
              {obs.chainageM !== null
                ? ` · ch. ${obs.chainageM.toFixed(1)} m`
                : ''}
            </Tooltip>
          </Marker>
        ))}

        {junctions.map((jn) => (
          <Marker
            key={jn.id}
            position={[jn.location.lat, jn.location.lng]}
            icon={junctionIcon}
          >
            <Tooltip direction="top">
              {JUNCTION_KIND_LABELS[jn.junctionKind]}
              {jn.label ? `: ${jn.label}` : ''}
            </Tooltip>
          </Marker>
        ))}
      </BadoMapCanvas>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-600">
          CRS: <span className="font-mono">EPSG:4326</span> ·{' '}
          {asset.geometry.type}
          {linear && asset.routeLengthM !== null
            ? ` · ${formatRouteLength(asset.routeLengthM)}`
            : ''}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {linear && canEditRouteGeometry && (
            <Link to={`/routes/${asset.id}/edit`}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Pencil className="h-3.5 w-3.5" />}
              >
                Edit Route Geometry
              </Button>
            </Link>
          )}
          <Link to={`/map?assetId=${encodeURIComponent(asset.id)}`}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<MapIcon className="h-3.5 w-3.5" />}
            >
              View on GIS Map
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
