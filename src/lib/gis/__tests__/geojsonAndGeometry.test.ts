import { describe, expect, it } from 'vitest';
import { parseAndValidateLinearGeoJson } from '@/lib/gis/geojsonIo';
import { computeGeometryLengthM, snapPointToLinearRoute } from '@/lib/gis/geometry';

describe('linear GeoJSON and geodesic geometry', () => {
  it('imports WGS84 lines and calculates a non-zero geodesic length', () => {
    const result = parseAndValidateLinearGeoJson(JSON.stringify({ type: 'LineString', coordinates: [[3.9, 7.4], [3.901, 7.4]] }));
    expect(result.vertexCount).toBe(2);
    expect(result.routeLengthM).toBeGreaterThan(100);
    expect(computeGeometryLengthM(result.geometry)).toBe(result.routeLengthM);
  });
  it('rejects projected coordinates and non-linear geometry', () => {
    expect(() => parseAndValidateLinearGeoJson(JSON.stringify({ type: 'LineString', coordinates: [[500000, 800000], [500001, 800001]] }))).toThrow(/WGS84|projected/i);
    expect(() => parseAndValidateLinearGeoJson(JSON.stringify({ type: 'Point', coordinates: [3, 7] }))).toThrow();
  });
  it('snaps to the second segment with cumulative chainage', () => {
    const geometry = { type: 'MultiLineString' as const, coordinates: [[[3, 7], [3.001, 7]], [[3.001, 7], [3.002, 7]]] };
    const snapped = snapPointToLinearRoute(geometry, { lng: 3.0015, lat: 7.0001 });
    expect(snapped.chainageM).toBeGreaterThan(150);
    expect(snapped.offsetM).toBeGreaterThan(0);
  });
});
