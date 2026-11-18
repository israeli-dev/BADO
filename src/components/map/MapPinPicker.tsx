import type L from 'leaflet';
import { Compass, Crosshair } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Circle, Marker, Tooltip } from 'react-leaflet';

import {
  BadoMapCanvas,
  createPlacementPinIcon,
  DEFAULT_CAMPUS_CENTER,
} from '@/components/map/BadoMapCanvas';
import { Button } from '@/components/ui/Button';
import { isValidWgs84Coordinate } from '@/lib/gis/geometry';
import type { GeoCoordinates } from '@/types/domain';

export interface MapPinPickerProps {
  latitude: number | null;
  longitude: number | null;
  horizontalAccuracyM?: number | null;
  campusCenter?: GeoCoordinates | null;
  campusZoom?: number;
  onSelectPosition: (coords: GeoCoordinates, source: 'click' | 'drag') => void;
  heightClassName?: string;
}

export function MapPinPicker({
  latitude,
  longitude,
  horizontalAccuracyM = null,
  campusCenter = null,
  campusZoom = 16,
  onSelectPosition,
  heightClassName = 'h-64 sm:h-72',
}: MapPinPickerProps) {
  const hasValidPin =
    latitude !== null &&
    longitude !== null &&
    isValidWgs84Coordinate(latitude, longitude);

  const pinPosition: GeoCoordinates | null = hasValidPin
    ? { lat: latitude, lng: longitude }
    : null;

  const initialCenter = pinPosition ?? campusCenter ?? DEFAULT_CAMPUS_CENTER;

  const [focusTarget, setFocusTarget] = useState<GeoCoordinates | null>(null);
  const [focusZoom, setFocusZoom] = useState<number>(17);
  const [focusCounter, setFocusCounter] = useState<number>(0);

  const pinIcon = useMemo(() => createPlacementPinIcon(), []);

  const recenter = (target: GeoCoordinates, nextZoom: number) => {
    setFocusTarget(target);
    setFocusZoom(nextZoom);
    setFocusCounter((n) => n + 1);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          Tap anywhere on the campus map to place the pin, or drag the marker to
          adjust (the change is flagged as a manual adjustment).
        </span>
        <div className="flex items-center gap-1.5">
          {pinPosition && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Crosshair className="h-3.5 w-3.5" />}
              onClick={() => recenter(pinPosition, 18)}
            >
              Centre on pin
            </Button>
          )}
          {campusCenter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Compass className="h-3.5 w-3.5" />}
              onClick={() => recenter(campusCenter, campusZoom)}
            >
              Campus view
            </Button>
          )}
        </div>
      </div>

      <BadoMapCanvas
        center={initialCenter}
        zoom={pinPosition ? 17 : campusZoom}
        focusPoint={focusTarget}
        focusZoom={focusZoom}
        focusKey={focusCounter || undefined}
        onMapClick={(coords) => onSelectPosition(coords, 'click')}
        heightClassName={heightClassName}
        crosshairCursor
        ariaLabel="Interactive map pin picker for WGS84 asset placement"
      >
        {pinPosition &&
          horizontalAccuracyM !== null &&
          horizontalAccuracyM > 0 && (
            <Circle
              center={[pinPosition.lat, pinPosition.lng]}
              radius={horizontalAccuracyM}
              pathOptions={{
                color: '#0284c7',
                weight: 1.5,
                dashArray: '4 4',
                fillColor: '#38bdf8',
                fillOpacity: 0.14,
              }}
            />
          )}

        {pinPosition && (
          <Marker
            position={[pinPosition.lat, pinPosition.lng]}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend(event) {
                const marker = event.target as L.Marker;
                const pos = marker.getLatLng();
                onSelectPosition(
                  {
                    lat: Number(pos.lat.toFixed(7)),
                    lng: Number(pos.lng.toFixed(7)),
                  },
                  'drag',
                );
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {pinPosition.lat.toFixed(6)}, {pinPosition.lng.toFixed(6)}
            </Tooltip>
          </Marker>
        )}
      </BadoMapCanvas>
    </div>
  );
}
