import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Position,
} from 'geojson';
import {
  computeGeometryLengthM,
  isValidWgs84Coordinate,
  looksLikeProjectedCoordinates,
} from '@/lib/gis/geometry';
import type { AssetListItem } from '@/types/domain';

export const MAX_GEOJSON_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB safety limit
export const MAX_ROUTE_VERTICES = 5_000;

export interface ParsedLinearGeoJson {
  geometry: LineString | MultiLineString;
  partCount: number;
  vertexCount: number;
  routeLengthM: number;
  suggestedName: string | null;
  sourceProperties: Record<string, string | number | boolean | null>;
  warnings: string[];
}

function validateAndCleanLinePart(
  rawCoords: unknown,
  partLabel: string,
): Position[] {
  if (!Array.isArray(rawCoords)) {
    throw new Error(`${partLabel} coordinates must be an array of [lng, lat] pairs.`);
  }

  const cleaned: Position[] = [];
  for (let i = 0; i < rawCoords.length; i += 1) {
    const coord = rawCoords[i];
    if (!Array.isArray(coord) || coord.length < 2) {
      throw new Error(
        `${partLabel} vertex #${i + 1} must be a [longitude, latitude] coordinate array.`,
      );
    }
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new Error(`${partLabel} vertex #${i + 1} contains non-numeric coordinates.`);
    }

    if (looksLikeProjectedCoordinates(lng, lat)) {
      throw new Error(
        `Coordinate [${lng}, ${lat}] is outside WGS84 degree bounds and appears to be in a projected CRS (such as UTM). Reproject the layer to EPSG:4326 (WGS 84) in QGIS before importing into BADO.`,
      );
    }

    if (!isValidWgs84Coordinate(lat, lng)) {
      throw new Error(
        `${partLabel} vertex #${i + 1} ([${lng}, ${lat}]) is outside valid WGS84 bounds (longitude -180..180, latitude -90..90).`,
      );
    }

    const roundedLng = Number(lng.toFixed(7));
    const roundedLat = Number(lat.toFixed(7));
    const prev = cleaned[cleaned.length - 1];
    // Drop exact consecutive duplicate points
    if (prev && prev[0] === roundedLng && prev[1] === roundedLat) {
      continue;
    }
    cleaned.push([roundedLng, roundedLat]);
  }

  if (cleaned.length < 2) {
    throw new Error(
      `${partLabel} must contain at least 2 distinct vertices after removing duplicate points.`,
    );
  }

  return cleaned;
}

function checkLegacyCrsDeclaration(root: Record<string, unknown>): void {
  const crs = root.crs;
  if (!crs || typeof crs !== 'object') return;
  const props = (crs as { properties?: { name?: unknown } }).properties;
  const name = typeof props?.name === 'string' ? props.name.toUpperCase() : '';
  if (!name) return;

  const isWgs84 =
    name.includes('CRS84') ||
    name.includes('EPSG::4326') ||
    name.includes('EPSG:4326');

  if (!isWgs84) {
    throw new Error(
      `Imported GeoJSON declares CRS "${name}". BADO stores geometries in EPSG:4326 (WGS 84) — please export/reproject as EPSG:4326 from QGIS first.`,
    );
  }
}

function pickPrimitiveProperties(
  raw: unknown,
): Record<string, string | number | boolean | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      v === null
    ) {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Strictly parses and validates a GeoJSON string containing a linear utility route
 * (`LineString`, `MultiLineString`, `Feature`, or `FeatureCollection` of lines).
 */
export function parseAndValidateLinearGeoJson(
  rawText: string,
): ParsedLinearGeoJson {
  if (!rawText || !rawText.trim()) {
    throw new Error('GeoJSON input is empty.');
  }
  if (rawText.length > MAX_GEOJSON_IMPORT_BYTES) {
    throw new Error('GeoJSON exceeds the 5 MB maximum route import size.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      'File is not valid JSON. Export a valid RFC 7946 GeoJSON file.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GeoJSON root must be a JSON object.');
  }

  const root = parsed as Record<string, unknown>;
  checkLegacyCrsDeclaration(root);

  const parts: Position[][] = [];
  const warnings: string[] = [];
  let sourceProperties: Record<string, string | number | boolean | null> = {};
  let skippedNonLinear = 0;

  const collectGeometry = (geomObj: unknown, label: string) => {
    if (!geomObj || typeof geomObj !== 'object') {
      throw new Error(`${label} is missing a valid geometry object.`);
    }
    const g = geomObj as { type?: unknown; coordinates?: unknown };
    if (g.type === 'LineString') {
      parts.push(validateAndCleanLinePart(g.coordinates, label));
    } else if (g.type === 'MultiLineString') {
      if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) {
        throw new Error(`${label} MultiLineString has no line parts.`);
      }
      g.coordinates.forEach((sub, idx) => {
        parts.push(validateAndCleanLinePart(sub, `${label} part ${idx + 1}`));
      });
    } else {
      skippedNonLinear += 1;
    }
  };

  switch (root.type) {
    case 'LineString':
    case 'MultiLineString':
      collectGeometry(root, 'Route geometry');
      break;
    case 'Feature':
      sourceProperties = pickPrimitiveProperties(root.properties);
      collectGeometry(root.geometry, 'Feature');
      if (skippedNonLinear > 0) {
        const gType = String(
          (root.geometry as { type?: unknown } | undefined)?.type ?? 'unknown',
        );
        throw new Error(
          `Expected a LineString or MultiLineString feature, but received "${gType}".`,
        );
      }
      break;
    case 'FeatureCollection': {
      if (!Array.isArray(root.features) || root.features.length === 0) {
        throw new Error('GeoJSON FeatureCollection contains no features.');
      }
      root.features.forEach((feat, idx) => {
        if (
          !feat ||
          typeof feat !== 'object' ||
          (feat as { type?: unknown }).type !== 'Feature'
        ) {
          throw new Error(`Item #${idx + 1} in FeatureCollection is not a valid Feature.`);
        }
        const f = feat as { geometry?: unknown; properties?: unknown };
        if (Object.keys(sourceProperties).length === 0) {
          sourceProperties = pickPrimitiveProperties(f.properties);
        }
        collectGeometry(f.geometry, `Feature #${idx + 1}`);
      });
      if (skippedNonLinear > 0 && parts.length > 0) {
        warnings.push(
          `Ignored ${skippedNonLinear} non-linear feature(s) (Point/Polygon) in collection.`,
        );
      }
      break;
    }
    default:
      throw new Error(
        `Unsupported GeoJSON type "${String(root.type ?? 'missing')}". Provide a LineString, MultiLineString, Feature, or FeatureCollection.`,
      );
  }

  if (parts.length === 0) {
    throw new Error(
      'No LineString or MultiLineString utility routes were found in the GeoJSON file.',
    );
  }

  const vertexCount = parts.reduce((sum, p) => sum + p.length, 0);
  if (vertexCount > MAX_ROUTE_VERTICES) {
    throw new Error(
      `Imported route contains ${vertexCount} vertices (maximum allowed is ${MAX_ROUTE_VERTICES}). Simplify the geometry in QGIS before importing.`,
    );
  }

  if (parts.length > 1) {
    warnings.push(
      `Combined ${parts.length} line segments into a MultiLineString utility route.`,
    );
  }

  const geometry: LineString | MultiLineString =
    parts.length === 1
      ? { type: 'LineString', coordinates: parts[0]! }
      : { type: 'MultiLineString', coordinates: parts };

  const routeLengthM = computeGeometryLengthM(geometry) ?? 0;
  if (routeLengthM <= 0) {
    throw new Error('Imported route has zero length.');
  }

  const nameCandidate =
    sourceProperties.name ??
    sourceProperties.NAME ??
    sourceProperties.label ??
    sourceProperties.asset_name ??
    null;

  return {
    geometry,
    partCount: parts.length,
    vertexCount,
    routeLengthM,
    suggestedName:
      typeof nameCandidate === 'string' && nameCandidate.trim().length >= 2
        ? nameCandidate.trim().slice(0, 160)
        : null,
    sourceProperties,
    warnings,
  };
}

export interface GeoJsonExportContext {
  institutionName: string;
  isDemoInstitution: boolean;
  campusName: string | null;
  exportedAt?: string;
}

export interface BadoGeoJsonFeatureCollection
  extends FeatureCollection<Geometry, Record<string, unknown>> {
  metadata: {
    generator: string;
    crs: 'EPSG:4326';
    institution_name: string;
    campus_scope: string;
    is_simulated_demo_data: boolean;
    feature_count: number;
    exported_at: string;
    disclaimer: string;
  };
}

/**
 * Serialises permitted institutional assets, linear utility routes, and survey
 * benchmarks into a QGIS-compatible RFC 7946 GeoJSON FeatureCollection (EPSG:4326).
 */
export function buildInstitutionalGeoJsonExport(
  items: readonly AssetListItem[],
  context: GeoJsonExportContext,
): BadoGeoJsonFeatureCollection {
  const exportedAt = context.exportedAt ?? new Date().toISOString();

  const features: Feature<Geometry, Record<string, unknown>>[] = items.map(
    (item) => {
      const { asset, assetType, campus, department, benchmark } = item;
      const routeLengthM =
        asset.routeLengthM ?? computeGeometryLengthM(asset.geometry);

      return {
        type: 'Feature',
        id: asset.id,
        geometry: asset.geometry,
        properties: {
          bado_id: asset.id,
          asset_code: asset.assetCode,
          name: asset.name,
          category: asset.category,
          utility_group: asset.utilityGroup,
          asset_type_code: assetType.code,
          asset_type_name: assetType.name,
          campus_code: campus?.code ?? null,
          campus_name: campus?.name ?? null,
          department_code: department?.code ?? null,
          operational_status: asset.operationalStatus,
          physical_condition: asset.physicalCondition,
          verification_status: asset.verificationStatus,
          data_quality: asset.dataQuality,
          is_critical_hazard: asset.isCriticalHazard,
          route_length_m: routeLengthM,
          material: asset.material,
          diameter_mm: asset.diameterMm,
          cable_specification: asset.cableSpecification,
          recorded_depth_m: asset.recordedDepthM,
          min_observed_depth_m: item.minDepthM ?? null,
          max_observed_depth_m: item.maxDepthM ?? null,
          depth_observation_count: item.depthObservationCount ?? 0,
          depth_is_variable: asset.depthIsVariable,
          depth_measurement_method: asset.depthMeasurementMethod,
          documented_before_covering: asset.documentedBeforeCovering,
          benchmark_reference_code: benchmark?.referenceCode ?? null,
          benchmark_elevation_m: benchmark?.elevationM ?? null,
          benchmark_vertical_datum: benchmark?.verticalDatum ?? null,
          position_source: asset.positionSource,
          capture_method: asset.captureMethod,
          horizontal_accuracy_m: asset.horizontalAccuracyM,
          vertical_accuracy_m: asset.verticalAccuracyM,
          fix_quality: asset.fixQuality,
          source_crs: asset.sourceCrs,
          is_manually_adjusted: asset.isManuallyAdjusted,
          installation_date: asset.installationDate,
          last_verified_at: asset.lastVerifiedAt,
          updated_at: asset.updatedAt,
          is_simulated_demo_data: context.isDemoInstitution,
        },
      };
    },
  );

  return {
    type: 'FeatureCollection',
    metadata: {
      generator: 'BADO University Edition',
      crs: 'EPSG:4326',
      institution_name: context.institutionName,
      campus_scope: context.campusName ?? 'All permitted campuses',
      is_simulated_demo_data: context.isDemoInstitution,
      feature_count: features.length,
      exported_at: exportedAt,
      disclaimer: context.isDemoInstitution
        ? 'SIMULATED DEMONSTRATION DATASET — does not represent verified real-world university infrastructure.'
        : 'BADO displays documented infrastructure available in the institutional register. Unrecorded or inaccurately mapped utilities may exist. Confirm underground services using appropriate professional utility detection and verification before excavation.',
    },
    features,
  };
}
