import { z } from 'zod';
import { ASSET_CATEGORIES, UTILITY_GROUPS, OPERATIONAL_STATUSES, VERIFICATION_STATUSES, DATA_QUALITIES, DEPTH_MEASUREMENT_METHODS } from '@/types/domain';
import { booleanIntersects } from '@turf/boolean-intersects';
import { area } from '@turf/area';
import { distance } from '@turf/distance';
import { feature, lineString, point } from '@turf/helpers';
import { kinks } from '@turf/kinks';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';
import type { Geometry, Point, Polygon, Position } from 'geojson';
import type { AssetListItem, AssetCategory, DataQuality, DepthMeasurementMethod, OperationalStatus, UtilityGroup, VerificationStatus } from '@/types/domain';

export type DigGeometry = Point | Polygon;
export interface DigCheckInput { campusId: string; geometry: DigGeometry; bufferM: number }
export interface DigCheckResult {
  id: string; name: string; assetCode: string; category: AssetCategory; utilityGroup: UtilityGroup;
  geometry: Geometry; distanceM: number; verificationStatus: VerificationStatus; operationalStatus: OperationalStatus;
  dataQuality: DataQuality; isCriticalHazard: boolean; recordedDepthM: number | null;
  depthMeasurementMethod: DepthMeasurementMethod | null; depthIsVariable: boolean;
  minDepthM: number | null; maxDepthM: number | null; depthObservationCount: number;
  photoCount: number; updatedAt: string; lastVerifiedAt: string | null; horizontalAccuracyM: number | null;
}
export interface DigCheckReport { results: DigCheckResult[]; truncated: boolean; checkedAt: string; mode: 'supabase' | 'demo'; }
const geometrySchema = z.object({ type: z.enum(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']), coordinates: z.unknown() }).transform(v => v as Geometry);
export const digCheckReportSchema = z.object({
  checkedAt: z.string(), truncated: z.boolean(), results: z.array(z.object({
    id: z.string(), name: z.string(), assetCode: z.string(), category: z.enum(ASSET_CATEGORIES), utilityGroup: z.enum(UTILITY_GROUPS),
    geometry: geometrySchema, distanceM: z.number().finite().nonnegative(), verificationStatus: z.enum(VERIFICATION_STATUSES),
    operationalStatus: z.enum(OPERATIONAL_STATUSES), dataQuality: z.enum(DATA_QUALITIES), isCriticalHazard: z.boolean(),
    recordedDepthM: z.number().nullable(), depthMeasurementMethod: z.enum(DEPTH_MEASUREMENT_METHODS).nullable(), depthIsVariable: z.boolean(),
    minDepthM: z.number().nullable(), maxDepthM: z.number().nullable(), depthObservationCount: z.number().nonnegative(), photoCount: z.number().nonnegative(),
    updatedAt: z.string(), lastVerifiedAt: z.string().nullable(), horizontalAccuracyM: z.number().nullable(),
  })).max(200),
});
export const DIG_CHECK_LIMIT = 200;

export function validateDigCheck(input: DigCheckInput): void {
  if (!input.campusId) throw new Error('Select a campus before running a check.');
  if (!Number.isFinite(input.bufferM) || input.bufferM < 0 || input.bufferM > 500) throw new Error('Awareness buffer must be between 0 and 500 metres.');
  const geometry = input.geometry;
  const coordinates = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates.flat();
  if (!coordinates.length || coordinates.length > 101 || coordinates.some(p => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]!) > 180 || Math.abs(p[1]!) > 90)) throw new Error('Enter valid WGS84 coordinates, with no more than 100 polygon vertices.');
  const lngs = coordinates.map(p => p[0]!);
  if (Math.max(...lngs) - Math.min(...lngs) > 180) throw new Error('Areas crossing the antimeridian are not supported.');
  if (geometry.type === 'Polygon') {
    if (geometry.coordinates.length !== 1) throw new Error('Use a single polygon without holes.');
    const ring = geometry.coordinates[0]!;
    if (ring.length < 4 || ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) throw new Error('Draw at least three vertices to form a closed area.');
    const poly = feature(geometry);
    if (kinks(poly).features.length || area(poly) <= 0 || area(poly) > 25_000_000) throw new Error('Area must be valid, non-self-intersecting, and no larger than 25 square kilometres.');
  }
}

type Segments = { vertices: Position[]; segments: Position[][] };
function shape(geometry: Geometry): Segments {
  const vertices: Position[] = []; const segments: Position[][] = [];
  function addLine(line: Position[]) {
    if (line.length < 2) throw new Error('A simulated asset has invalid geometry; the check cannot be completed.');
    vertices.push(...line);
    for (let i = 1; i < line.length; i++) segments.push([line[i - 1]!, line[i]!]);
  }
  switch (geometry.type) {
    case 'Point': vertices.push(geometry.coordinates); break;
    case 'MultiPoint': vertices.push(...geometry.coordinates); break;
    case 'LineString': addLine(geometry.coordinates); break;
    case 'MultiLineString': geometry.coordinates.forEach(addLine); break;
    case 'Polygon': geometry.coordinates.forEach(addLine); break;
    case 'MultiPolygon': geometry.coordinates.forEach(p => p.forEach(addLine)); break;
    default: throw new Error('A simulated asset uses an unsupported geometry; the check cannot be completed.');
  }
  if (!vertices.length || vertices.some(p => p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]!) > 180 || Math.abs(p[1]!) > 90)) throw new Error('A simulated asset has invalid geometry; the check cannot be completed.');
  return { vertices, segments };
}

/** Spherical approximation for demo only; authoritative online results use PostGIS geography. */
export function demoDistanceM(query: DigGeometry, geometry: Geometry): number {
  const a = shape(query); const b = shape(geometry);
  if (booleanIntersects(feature(query), feature(geometry))) return 0;
  let best = Infinity;
  for (const x of a.vertices) {
    for (const y of b.vertices) best = Math.min(best, distance(point(x), point(y), { units: 'meters' }));
    for (const segment of b.segments) best = Math.min(best, nearestPointOnLine(lineString(segment), point(x), { units: 'meters' }).properties.dist ?? Infinity);
  }
  for (const y of b.vertices) for (const segment of a.segments) best = Math.min(best, nearestPointOnLine(lineString(segment), point(y), { units: 'meters' }).properties.dist ?? Infinity);
  if (!Number.isFinite(best)) throw new Error('Could not calculate distance to a simulated asset.');
  return best;
}

export function buildDemoDigReport(input: DigCheckInput, assets: AssetListItem[]): DigCheckReport {
  validateDigCheck(input);
  const results = assets.map(item => ({
    id: item.asset.id, name: item.asset.name, assetCode: item.asset.assetCode, category: item.asset.category,
    utilityGroup: item.asset.utilityGroup, geometry: item.asset.geometry, distanceM: demoDistanceM(input.geometry, item.asset.geometry),
    verificationStatus: item.asset.verificationStatus, operationalStatus: item.asset.operationalStatus, dataQuality: item.asset.dataQuality,
    isCriticalHazard: item.asset.isCriticalHazard, recordedDepthM: item.asset.recordedDepthM,
    depthMeasurementMethod: item.asset.depthMeasurementMethod, depthIsVariable: item.asset.depthIsVariable,
    minDepthM: item.minDepthM ?? null, maxDepthM: item.maxDepthM ?? null, depthObservationCount: item.depthObservationCount ?? 0,
    photoCount: item.photoCount, updatedAt: item.asset.updatedAt, lastVerifiedAt: item.asset.lastVerifiedAt,
    horizontalAccuracyM: item.asset.horizontalAccuracyM,
  })).filter(item => item.distanceM <= input.bufferM).sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
  return { results: results.slice(0, DIG_CHECK_LIMIT), truncated: results.length > DIG_CHECK_LIMIT, checkedAt: new Date().toISOString(), mode: 'demo' };
}
