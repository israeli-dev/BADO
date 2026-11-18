import { bbox } from '@turf/bbox';
import { feature, featureCollection, lineString, multiLineString, point } from '@turf/helpers';
import { length } from '@turf/length';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';
import type { Geometry, LineString, MultiLineString, Position } from 'geojson';
import type { GeoCoordinates } from '@/types/domain';

export type LatLngBoundsTuple = [[number, number], [number, number]];

export function isLinearGeometry(
  geometry: Geometry,
): geometry is LineString | MultiLineString {
  return geometry.type === 'LineString' || geometry.type === 'MultiLineString';
}

export function isValidWgs84Coordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Detects coordinates that appear to be projected Easting/Northing metres
 * (e.g. UTM Zone 31N/32N exported from QGIS without reprojecting to EPSG:4326).
 */
export function looksLikeProjectedCoordinates(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    (Math.abs(lng) > 180 || Math.abs(lat) > 90) &&
    Math.abs(lng) <= 20_050_000 &&
    Math.abs(lat) <= 20_050_000
  );
}

/** Geodesic distance between two WGS84 points in metres. */
export function computeDistanceBetweenM(
  a: GeoCoordinates,
  b: GeoCoordinates,
): number {
  if (a.lat === b.lat && a.lng === b.lng) return 0;
  const seg = lineString([
    [a.lng, a.lat],
    [b.lng, b.lat],
  ]);
  return Math.round(length(seg, { units: 'meters' }) * 100) / 100;
}

/**
 * Computes geodesic length in metres for LineString or MultiLineString geometries.
 * Returns `null` for non-linear geometries (Point / Polygon).
 */
export function computeGeometryLengthM(geometry: Geometry): number | null {
  if (geometry.type === 'LineString') {
    if (geometry.coordinates.length < 2) return 0;
    const line = lineString(geometry.coordinates);
    return Math.round(length(line, { units: 'meters' }) * 100) / 100;
  }
  if (geometry.type === 'MultiLineString') {
    const validParts = geometry.coordinates.filter((part) => part.length >= 2);
    if (validParts.length === 0) return 0;
    const multi = multiLineString(validParts);
    return Math.round(length(multi, { units: 'meters' }) * 100) / 100;
  }
  return null;
}

/**
 * Returns running geodesic chainage in metres (`0` at start vertex) for each vertex.
 */
export function computeVertexChainagesM(vertices: GeoCoordinates[]): number[] {
  const result: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    if (i > 0) {
      cumulative += computeDistanceBetweenM(vertices[i - 1]!, vertices[i]!);
    }
    result.push(Math.round(cumulative * 100) / 100);
  }
  return result;
}

/**
 * Snaps an observation point to the nearest point along a linear route and returns
 * the snapped coordinate, geodesic chainage from route start (m), and lateral offset (m).
 */
export function snapPointToLinearRoute(
  geometry: LineString | MultiLineString,
  target: GeoCoordinates,
): {
  snapped: GeoCoordinates;
  chainageM: number;
  offsetM: number;
} {
  const targetPt = point([target.lng, target.lat]);
  const parts =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.coordinates;

  let bestSnapped: GeoCoordinates = { lat: target.lat, lng: target.lng };
  let bestChainageM = 0;
  let bestOffsetM = Number.POSITIVE_INFINITY;
  let cumulativeBeforeM = 0;

  for (const part of parts) {
    if (part.length < 2) continue;
    const partFeat = lineString(part);
    const snappedFeature = nearestPointOnLine(partFeat, targetPt, {
      units: 'meters',
    });
    const distM = snappedFeature.properties.dist ?? Number.POSITIVE_INFINITY;
    const locM = snappedFeature.properties.location ?? 0;
    if (distM < bestOffsetM) {
      const [lng, lat] = snappedFeature.geometry.coordinates;
      bestOffsetM = distM;
      bestChainageM = cumulativeBeforeM + locM;
      bestSnapped = {
        lat: Number((lat ?? target.lat).toFixed(7)),
        lng: Number((lng ?? target.lng).toFixed(7)),
      };
    }
    cumulativeBeforeM += length(partFeat, { units: 'meters' });
  }

  return {
    snapped: bestSnapped,
    chainageM: Math.round(bestChainageM * 100) / 100,
    offsetM: Number.isFinite(bestOffsetM)
      ? Math.round(bestOffsetM * 100) / 100
      : 0,
  };
}

/** Builds a valid GeoJSON LineString from ordered WGS84 vertices. */
export function coordinatesToLineString(vertices: GeoCoordinates[]): LineString {
  if (vertices.length < 2) {
    throw new Error('A linear utility route requires at least 2 vertices.');
  }
  return {
    type: 'LineString',
    coordinates: vertices.map((v) => [
      Number(v.lng.toFixed(7)),
      Number(v.lat.toFixed(7)),
    ]),
  };
}

/** Extracts editable vertex parts from a LineString or MultiLineString. */
export function extractLineParts(
  geometry: LineString | MultiLineString,
): GeoCoordinates[][] {
  const rawParts: Position[][] =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.coordinates;

  return rawParts.map((part) =>
    part.map((pos) => ({
      lng: pos[0] ?? 0,
      lat: pos[1] ?? 0,
    })),
  );
}

/** Inserts a midpoint vertex halfway between `segmentIndex` and `segmentIndex + 1`. */
export function insertMidpointVertex<T extends { location: GeoCoordinates }>(
  vertices: readonly T[],
  segmentIndex: number,
  buildVertex: (midpoint: GeoCoordinates) => T,
): T[] {
  const a = vertices[segmentIndex];
  const b = vertices[segmentIndex + 1];
  if (!a || !b) return [...vertices];

  const midpoint: GeoCoordinates = {
    lat: Number(((a.location.lat + b.location.lat) / 2).toFixed(7)),
    lng: Number(((a.location.lng + b.location.lng) / 2).toFixed(7)),
  };

  return [
    ...vertices.slice(0, segmentIndex + 1),
    buildVertex(midpoint),
    ...vertices.slice(segmentIndex + 1),
  ];
}

/** Computes Leaflet `[[south, west], [north, east]]` bounds across geometries. */
export function computeLeafletBounds(
  geometries: Geometry[],
): LatLngBoundsTuple | null {
  if (geometries.length === 0) return null;
  const fc = featureCollection(geometries.map((g) => feature(g)));
  const [minLng, minLat, maxLng, maxLat] = bbox(fc);
  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }
  // Slightly pad single-point bounds so fitBounds stays readable
  const latPad = minLat === maxLat ? 0.0012 : 0;
  const lngPad = minLng === maxLng ? 0.0012 : 0;
  return [
    [minLat - latPad, minLng - lngPad],
    [maxLat + latPad, maxLng + lngPad],
  ];
}

function formatPositionWkt(pos: Position): string {
  const lng = pos[0];
  const lat = pos[1];
  if (
    lng === undefined ||
    lat === undefined ||
    !isValidWgs84Coordinate(lat, lng)
  ) {
    throw new Error('Geometry contains an invalid WGS84 coordinate.');
  }
  return `${lng} ${lat}`;
}

function formatRingWkt(ring: Position[]): string {
  return `(${ring.map(formatPositionWkt).join(', ')})`;
}

/**
 * Serialises supported WGS84 GeoJSON geometries to PostGIS EWKT (`SRID=4326;...`).
 */
export function geometryToEwkt(geometry: Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return `SRID=4326;POINT(${formatPositionWkt(geometry.coordinates)})`;
    case 'LineString':
      if (geometry.coordinates.length < 2) {
        throw new Error('LineString requires at least 2 vertices.');
      }
      return `SRID=4326;LINESTRING(${geometry.coordinates
        .map(formatPositionWkt)
        .join(', ')})`;
    case 'MultiLineString':
      if (
        geometry.coordinates.length === 0 ||
        geometry.coordinates.some((part) => part.length < 2)
      ) {
        throw new Error(
          'MultiLineString requires at least one part and 2 vertices per part.',
        );
      }
      return `SRID=4326;MULTILINESTRING(${geometry.coordinates
        .map(formatRingWkt)
        .join(', ')})`;
    case 'Polygon':
      return `SRID=4326;POLYGON(${geometry.coordinates
        .map(formatRingWkt)
        .join(', ')})`;
    case 'MultiPolygon':
      return `SRID=4326;MULTIPOLYGON(${geometry.coordinates
        .map((poly) => `(${poly.map(formatRingWkt).join(', ')})`)
        .join(', ')})`;
    default:
      throw new Error(`Unsupported geometry type "${geometry.type}".`);
  }
}
