import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { WifiOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MapContainer,
  ScaleControl,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';

import { runtimeConfig } from '@/lib/config/env';
import type { LatLngBoundsTuple } from '@/lib/gis/geometry';
import {
  buildMarkerHtml,
  type ResolvedAssetSymbology,
} from '@/lib/gis/symbology';
import type { AssetCategory, GeoCoordinates } from '@/types/domain';

export const DEFAULT_CAMPUS_CENTER: GeoCoordinates = {
  lat: 7.4443,
  lng: 3.8995,
};
export const DEFAULT_CAMPUS_ZOOM = 16;

export interface BadoMapCanvasProps {
  center?: GeoCoordinates;
  zoom?: number;
  bounds?: LatLngBoundsTuple | null;
  /** Increment or change to trigger a programmatic fitBounds. */
  fitKey?: string | number;
  focusPoint?: GeoCoordinates | null;
  focusZoom?: number;
  /** Increment or change to trigger a programmatic setView to focusPoint. */
  focusKey?: string | number;
  onMapClick?: (coords: GeoCoordinates) => void;
  interactive?: boolean;
  scrollWheelZoom?: boolean;
  heightClassName?: string;
  className?: string;
  ariaLabel?: string;
  /** Shows a crosshair cursor when placing pins or drawing route vertices. */
  crosshairCursor?: boolean;
  children?: ReactNode;
}

function MapViewportController({
  bounds,
  fitKey,
  focusPoint,
  focusZoom,
  focusKey,
}: {
  bounds?: LatLngBoundsTuple | null;
  fitKey?: string | number;
  focusPoint?: GeoCoordinates | null;
  focusZoom?: number;
  focusKey?: string | number;
}) {
  const map = useMap();
  const lastFitKeyRef = useRef<string | number | undefined>(undefined);
  const lastFocusKeyRef = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!bounds || fitKey === undefined) return;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    try {
      map.fitBounds(bounds, {
        padding: [36, 36],
        maxZoom: 18,
        animate: false,
      });
    } catch {
      // Ignore transient zero-size container errors in headless tests
    }
  }, [map, bounds, fitKey]);

  useEffect(() => {
    if (!focusPoint || focusKey === undefined) return;
    if (lastFocusKeyRef.current === focusKey) return;
    lastFocusKeyRef.current = focusKey;
    try {
      map.setView(
        [focusPoint.lat, focusPoint.lng],
        focusZoom ?? Math.max(map.getZoom(), 17),
        { animate: false },
      );
    } catch {
      // Ignore transient container errors
    }
  }, [map, focusPoint, focusZoom, focusKey]);

  return null;
}

function MapInteractionBridge({
  onMapClick,
  onTileError,
  onTileLoad,
}: {
  onMapClick?: (coords: GeoCoordinates) => void;
  onTileError: () => void;
  onTileLoad: () => void;
}) {
  useMapEvents({
    click(event) {
      if (!onMapClick) return;
      onMapClick({
        lat: Number(event.latlng.lat.toFixed(7)),
        lng: Number(event.latlng.lng.toFixed(7)),
      });
    },
    tileerror() {
      onTileError();
    },
    tileload() {
      onTileLoad();
    },
  });
  return null;
}

/** Creates an accessible, configurable category DivIcon for Leaflet point markers. */
export function createAssetDivIcon(
  symbology: ResolvedAssetSymbology,
  category: AssetCategory,
  isSelected = false,
): L.DivIcon {
  const size = isSelected ? 34 : 28;
  const anchor = Math.round(size / 2);
  return L.divIcon({
    className: 'bado-marker-icon',
    html: buildMarkerHtml(symbology, category, isSelected),
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
    popupAnchor: [0, -anchor],
  });
}

/** Creates a numbered or role-coded handle DivIcon for editable route vertices. */
export function createRouteVertexDivIcon(options: {
  index: number;
  isStart: boolean;
  isEnd: boolean;
  isSelected?: boolean;
  colorHex?: string;
}): L.DivIcon {
  const safeColor =
    options.colorHex && /^#[0-9a-fA-F]{6}$/.test(options.colorHex)
      ? options.colorHex
      : '#0f2942';
  const bg = options.isStart
    ? '#15803d'
    : options.isEnd
      ? '#b91c1c'
      : safeColor;
  const size = options.isSelected ? 26 : 22;
  const anchor = Math.round(size / 2);
  const label = options.isStart
    ? 'S'
    : options.isEnd
      ? 'E'
      : String(options.index + 1);
  const ring = options.isSelected
    ? 'box-shadow:0 0 0 3px rgba(245,158,11,0.7),0 2px 5px rgba(15,23,42,0.4);'
    : 'box-shadow:0 1px 4px rgba(15,23,42,0.35);';

  return L.divIcon({
    className: 'bado-marker-icon',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:#ffffff;border:2px solid #ffffff;font-size:10px;font-weight:700;font-family:ui-monospace,monospace;${ring}">${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor],
  });
}

/** Creates a compact depth observation pill DivIcon (safe numeric formatting only). */
export function createDepthBadgeDivIcon(depthM: number): L.DivIcon {
  const formatted = Number.isFinite(depthM) ? `${depthM.toFixed(2)}m` : '?m';
  return L.divIcon({
    className: 'bado-marker-icon',
    html: `<span style="display:inline-flex;align-items:center;justify-content:center;padding:1px 5px;border-radius:9999px;background:#0f172a;color:#f8fafc;border:1.5px solid #ffffff;font-size:10px;font-weight:700;font-family:ui-monospace,monospace;white-space:nowrap;box-shadow:0 1px 4px rgba(15,23,42,0.35);">↓${formatted}</span>`,
    iconSize: [52, 20],
    iconAnchor: [26, 10],
  });
}

/** Creates a compact junction diamond DivIcon. */
export function createJunctionDivIcon(): L.DivIcon {
  return L.divIcon({
    className: 'bado-marker-icon',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;transform:rotate(45deg);background:#f59e0b;color:#0f172a;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(15,23,42,0.38);"><span style="transform:rotate(-45deg);font-size:9px;font-weight:800;line-height:1;">J</span></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Creates a distinct draggable placement pin icon for MapPinPicker. */
export function createPlacementPinIcon(): L.DivIcon {
  return L.divIcon({
    className: 'bado-marker-icon',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:#0f2942;color:#ffffff;border:3px solid #ffffff;box-shadow:0 0 0 2px #0f2942,0 3px 8px rgba(15,23,42,0.45);"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function BadoMapCanvas({
  center = DEFAULT_CAMPUS_CENTER,
  zoom = DEFAULT_CAMPUS_ZOOM,
  bounds = null,
  fitKey,
  focusPoint = null,
  focusZoom,
  focusKey,
  onMapClick,
  interactive = true,
  scrollWheelZoom = true,
  heightClassName = 'h-[420px]',
  className = '',
  ariaLabel = 'Institutional GIS infrastructure map',
  crosshairCursor = false,
  children,
}: BadoMapCanvasProps) {
  const [tileErrors, setTileErrors] = useState(0);
  const [hasLoadedTile, setHasLoadedTile] = useState(false);

  const showTileFallbackNotice = tileErrors >= 2 && !hasLoadedTile;

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={`relative w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 ${heightClassName} ${className}`}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        scrollWheelZoom={interactive && scrollWheelZoom}
        dragging={interactive}
        doubleClickZoom={interactive && !onMapClick}
        touchZoom={interactive}
        zoomControl={interactive}
        className={`bado-leaflet-container h-full w-full ${
          crosshairCursor ? '!cursor-crosshair' : ''
        }`}
      >
        {/* Standard viewport-only tile loading (no bulk pre-fetching; complies with OSM tile policy) */}
        <TileLayer
          url={runtimeConfig.mapTileUrl}
          attribution={runtimeConfig.mapTileAttribution}
          maxZoom={20}
          maxNativeZoom={19}
          updateWhenIdle
          keepBuffer={2}
        />
        <ScaleControl position="bottomleft" imperial={false} />
        <MapViewportController
          bounds={bounds}
          fitKey={fitKey}
          focusPoint={focusPoint}
          focusZoom={focusZoom}
          focusKey={focusKey}
        />
        <MapInteractionBridge
          onMapClick={onMapClick}
          onTileError={() => setTileErrors((c) => Math.min(c + 1, 10))}
          onTileLoad={() => {
            setHasLoadedTile(true);
            setTileErrors(0);
          }}
        />
        {children}
      </MapContainer>

      {showTileFallbackNotice && (
        <div
          role="status"
          className="pointer-events-none absolute top-2.5 left-12 right-2.5 z-[500] flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-xs text-amber-950 shadow-sm sm:right-auto sm:max-w-md"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            Basemap tiles unavailable (offline or restricted network). Cached
            campus vector assets, routes, and GPS coordinates remain active.
          </span>
        </div>
      )}
    </div>
  );
}
