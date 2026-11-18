import { computeDistanceBetweenM } from '@/lib/gis/geometry';
import type { GeoCoordinates, GnssFixQuality, VertexKind } from '@/types/domain';

export type RouteTrackingStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'stopped'
  | 'error';

export type AccuracyTier = 'excellent' | 'good' | 'moderate' | 'poor';

export interface TrackedRouteFix {
  location: GeoCoordinates;
  horizontalAccuracyM: number;
  verticalAccuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  fixQuality: GnssFixQuality;
  recordedAt: string;
}

export interface DraftRouteVertex {
  id: string;
  location: GeoCoordinates;
  vertexKind: VertexKind;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  fixQuality: GnssFixQuality;
  notes: string;
  recordedAt: string;
}

export interface RouteTrackerOptions {
  /** Reject automatic track append when horizontal accuracy exceeds this threshold (m). */
  maxAutoAccuracyM?: number;
  /** Minimum movement (m) from the last recorded point before auto-appending a track vertex. */
  minVertexSpacingM?: number;
  onStatusChange: (status: RouteTrackingStatus) => void;
  onLiveFix: (fix: TrackedRouteFix, accepted: boolean, reason?: string) => void;
  onAppendVertex: (vertex: DraftRouteVertex) => void;
  onError: (message: string) => void;
}

export interface ForegroundRouteTracker {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  getStatus: () => RouteTrackingStatus;
  getLatestFix: () => TrackedRouteFix | null;
  /** Explicitly drops a tagged vertex (e.g. bend, junction, valve, note) at the latest fix. */
  markSpecialVertex: (kind: VertexKind, notes?: string) => DraftRouteVertex | null;
}

export function classifyGpsAccuracy(accuracyM: number | null): AccuracyTier {
  if (accuracyM === null || !Number.isFinite(accuracyM)) return 'poor';
  if (accuracyM <= 1) return 'excellent';
  if (accuracyM <= 6) return 'good';
  if (accuracyM <= 15) return 'moderate';
  return 'poor';
}

function formatGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case 1:
      return 'Location permission was denied. Enable browser location permission to record a GPS walk route, or switch to Manual Draw mode.';
    case 2:
      return 'GPS position is currently unavailable. Step into clear sky view or place vertices manually.';
    case 3:
      return 'GPS fix timed out while awaiting satellites. Waiting for stronger signal…';
    default:
      return err.message || 'Unable to read foreground GPS position.';
  }
}

/**
 * Foreground-only GPS walk-and-record controller (Master Specification Sections 11 & 16).
 * - Requires explicit user `start()`
 * - Supports `pause()` / `resume()` without dropping the session
 * - Filters stationary GPS jitter and warns on poor horizontal accuracy
 * - Guarantees `navigator.geolocation.clearWatch()` on `stop()` and component unmount
 * - Never performs hidden or background tracking
 */
export function createForegroundRouteTracker(
  options: RouteTrackerOptions,
): ForegroundRouteTracker {
  const maxAutoAccuracyM = options.maxAutoAccuracyM ?? 35;
  const minVertexSpacingM = options.minVertexSpacingM ?? 2.5;

  let status: RouteTrackingStatus = 'idle';
  let watchId: number | null = null;
  let latestFix: TrackedRouteFix | null = null;
  let lastRecordedLocation: GeoCoordinates | null = null;
  let recordedCount = 0;

  const setStatus = (next: RouteTrackingStatus) => {
    status = next;
    options.onStatusChange(next);
  };

  const clearActiveWatch = () => {
    if (
      watchId !== null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation &&
      typeof navigator.geolocation.clearWatch === 'function'
    ) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  };

  const handlePosition = (pos: GeolocationPosition) => {
    const lat = Number(pos.coords.latitude.toFixed(7));
    const lng = Number(pos.coords.longitude.toFixed(7));
    const horizontalAccuracyM =
      Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy >= 0
        ? Number(pos.coords.accuracy.toFixed(2))
        : 999;
    const verticalAccuracyM =
      pos.coords.altitudeAccuracy !== null &&
      Number.isFinite(pos.coords.altitudeAccuracy) &&
      pos.coords.altitudeAccuracy >= 0
        ? Number(pos.coords.altitudeAccuracy.toFixed(2))
        : null;
    const speedMps =
      pos.coords.speed !== null && Number.isFinite(pos.coords.speed)
        ? Number(pos.coords.speed.toFixed(2))
        : null;
    const headingDeg =
      pos.coords.heading !== null &&
      Number.isFinite(pos.coords.heading) &&
      (speedMps === null || speedMps >= 0.5)
        ? Number(pos.coords.heading.toFixed(1))
        : null;

    const fix: TrackedRouteFix = {
      location: { lat, lng },
      horizontalAccuracyM,
      verticalAccuracyM,
      headingDeg,
      speedMps,
      fixQuality: 'autonomous',
      recordedAt: new Date(pos.timestamp || Date.now()).toISOString(),
    };
    latestFix = fix;

    if (status !== 'recording') {
      options.onLiveFix(fix, false, 'Tracking paused');
      return;
    }

    if (horizontalAccuracyM > maxAutoAccuracyM) {
      options.onLiveFix(
        fix,
        false,
        `GPS accuracy ±${horizontalAccuracyM.toFixed(1)} m exceeds auto-capture threshold (±${maxAutoAccuracyM} m). Wait for better satellite lock or mark point manually.`,
      );
      return;
    }

    if (lastRecordedLocation) {
      const movedM = computeDistanceBetweenM(lastRecordedLocation, fix.location);
      if (movedM < minVertexSpacingM) {
        options.onLiveFix(
          fix,
          false,
          `Moved ${movedM.toFixed(1)} m (waiting for ≥${minVertexSpacingM} m step to avoid GPS jitter).`,
        );
        return;
      }
    }

    const vertex: DraftRouteVertex = {
      id: crypto.randomUUID(),
      location: fix.location,
      vertexKind: recordedCount === 0 ? 'start_point' : 'track_point',
      horizontalAccuracyM: fix.horizontalAccuracyM,
      verticalAccuracyM: fix.verticalAccuracyM,
      fixQuality: fix.fixQuality,
      notes: '',
      recordedAt: fix.recordedAt,
    };

    recordedCount += 1;
    lastRecordedLocation = fix.location;
    options.onLiveFix(fix, true);
    options.onAppendVertex(vertex);
  };

  const handleError = (err: GeolocationPositionError) => {
    const message = formatGeolocationError(err);
    options.onError(message);
    if (err.code === 1) {
      clearActiveWatch();
      setStatus('error');
    }
  };

  const attachWatch = () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      typeof navigator.geolocation.watchPosition !== 'function'
    ) {
      options.onError(
        'Browser geolocation is not supported on this device. Use Manual Draw or GeoJSON Import instead.',
      );
      setStatus('error');
      return false;
    }

    clearActiveWatch();
    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
    return true;
  };

  return {
    start() {
      recordedCount = 0;
      lastRecordedLocation = null;
      latestFix = null;
      if (attachWatch()) {
        setStatus('recording');
      }
    },
    pause() {
      if (status !== 'recording') return;
      clearActiveWatch();
      setStatus('paused');
    },
    resume() {
      if (status !== 'paused') return;
      if (attachWatch()) {
        setStatus('recording');
      }
    },
    stop() {
      clearActiveWatch();
      if (status !== 'idle') {
        setStatus('stopped');
      }
    },
    getStatus: () => status,
    getLatestFix: () => latestFix,
    markSpecialVertex(kind: VertexKind, notes = '') {
      if (!latestFix) return null;
      const vertex: DraftRouteVertex = {
        id: crypto.randomUUID(),
        location: latestFix.location,
        vertexKind: kind,
        horizontalAccuracyM: latestFix.horizontalAccuracyM,
        verticalAccuracyM: latestFix.verticalAccuracyM,
        fixQuality: latestFix.fixQuality,
        notes: notes.trim(),
        recordedAt: new Date().toISOString(),
      };
      recordedCount += 1;
      lastRecordedLocation = latestFix.location;
      options.onAppendVertex(vertex);
      return vertex;
    },
  };
}
