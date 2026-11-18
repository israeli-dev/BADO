import type { GnssFixQuality, PositionSource } from '@/types/domain';

export interface CapturedGpsFix {
  latitude: number;
  longitude: number;
  horizontalAccuracyM: number;
  verticalAccuracyM: number | null;
  /** Informational GPS altitude only — NEVER used to infer underground burial depth. */
  altitudeM: number | null;
  measuredAt: string;
  positionSource: PositionSource;
  fixQuality: GnssFixQuality;
  sourceCrs: 'EPSG:4326';
}

/**
 * Captures a single high-accuracy foreground GPS position from the browser
 * Geolocation API with explicit error reporting. Never runs in the background
 * or stores personal movement history.
 */
export function captureSingleGpsPosition(
  timeoutMs = 15_000,
): Promise<CapturedGpsFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(
        new Error(
          'Geolocation is not available on this device or browser. Enter coordinates manually.',
        ),
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { coords, timestamp } = position;
        resolve({
          latitude: Number(coords.latitude.toFixed(7)),
          longitude: Number(coords.longitude.toFixed(7)),
          horizontalAccuracyM: Number(coords.accuracy.toFixed(2)),
          verticalAccuracyM:
            coords.altitudeAccuracy !== null &&
            !Number.isNaN(coords.altitudeAccuracy)
              ? Number(coords.altitudeAccuracy.toFixed(2))
              : null,
          altitudeM:
            coords.altitude !== null && !Number.isNaN(coords.altitude)
              ? Number(coords.altitude.toFixed(2))
              : null,
          measuredAt: new Date(timestamp || Date.now()).toISOString(),
          positionSource: 'smartphone_gps',
          fixQuality: 'autonomous',
          sourceCrs: 'EPSG:4326',
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(
              new Error(
                'Location permission was denied. Allow location access in your browser settings or enter coordinates manually.',
              ),
            );
            break;
          case error.POSITION_UNAVAILABLE:
            reject(
              new Error(
                'Current GPS position is unavailable (weak satellite signal). Move to open sky or enter coordinates manually.',
              ),
            );
            break;
          case error.TIMEOUT:
            reject(
              new Error(
                'GPS position fix timed out. Try again outdoors or enter coordinates manually.',
              ),
            );
            break;
          default:
            reject(
              new Error(
                error.message || 'Unable to capture current GPS coordinates.',
              ),
            );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      },
    );
  });
}

export function extractPrimaryCoordinates(geometry: {
  type: string;
  coordinates?: unknown;
}): { lat: number; lng: number } | null {
  if (!geometry || !('coordinates' in geometry)) return null;
  const coords = geometry.coordinates;

  if (
    geometry.type === 'Point' &&
    Array.isArray(coords) &&
    typeof coords[0] === 'number' &&
    typeof coords[1] === 'number'
  ) {
    return { lng: coords[0], lat: coords[1] };
  }

  if (
    geometry.type === 'LineString' &&
    Array.isArray(coords) &&
    Array.isArray(coords[0]) &&
    typeof coords[0][0] === 'number' &&
    typeof coords[0][1] === 'number'
  ) {
    return { lng: coords[0][0], lat: coords[0][1] };
  }

  if (
    (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') &&
    Array.isArray(coords) &&
    Array.isArray(coords[0]) &&
    Array.isArray(coords[0][0]) &&
    typeof coords[0][0][0] === 'number' &&
    typeof coords[0][0][1] === 'number'
  ) {
    return { lng: coords[0][0][0], lat: coords[0][0][1] };
  }

  return null;
}
