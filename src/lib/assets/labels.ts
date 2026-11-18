import type {
  AssetCategory,
  CaptureMethod,
  DataQuality,
  DepthMeasurementMethod,
  DocumentKind,
  GnssFixQuality,
  JunctionKind,
  OperationalStatus,
  PhotoKind,
  PhysicalCondition,
  PositionSource,
  UtilityGroup,
  VerificationStatus,
  VertexKind,
} from '@/types/domain';

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  surface: 'Surface Asset',
  underground: 'Underground Asset',
  survey_reference: 'Survey & Reference Feature',
};

export const UTILITY_GROUP_LABELS: Record<UtilityGroup, string> = {
  surface_facility: 'Surface Facility',
  water: 'Water Infrastructure',
  electrical: 'Electrical Infrastructure',
  telecom: 'Telecommunications & Fibre',
  drainage_sewer: 'Drainage & Sewer',
  gas: 'Gas Infrastructure',
  other_utility: 'Other Utility',
  critical_hazard: 'Critical Hazard',
  survey_benchmark: 'Survey Benchmark',
};

export const OPERATIONAL_STATUS_LABELS: Record<OperationalStatus, string> = {
  operational: 'Operational',
  maintenance: 'Under Maintenance',
  faulty: 'Faulty / Out of Service',
  standby: 'Standby',
  decommissioned: 'Decommissioned',
  unknown: 'Unknown',
};

export const PHYSICAL_CONDITION_LABELS: Record<PhysicalCondition, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
  unknown: 'Unknown',
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  verified: 'Verified',
  rejected: 'Rejected',
  needs_resurvey: 'Needs Re-survey',
};

export const DATA_QUALITY_LABELS: Record<DataQuality, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  needs_resurvey: 'Needs Re-survey',
  incomplete: 'Incomplete',
  outdated: 'Outdated',
};

export const GNSS_FIX_LABELS: Record<GnssFixQuality, string> = {
  autonomous: 'Autonomous (Standard GPS)',
  differential: 'Differential (DGPS / SBAS)',
  rtk_float: 'RTK Float',
  rtk_fixed: 'RTK Fixed (Survey Grade)',
  unknown: 'Unknown',
};

export const POSITION_SOURCE_LABELS: Record<PositionSource, string> = {
  smartphone_gps: 'Smartphone GPS',
  external_gnss: 'External GNSS Receiver',
  total_station: 'Total Station / Optical Survey',
  manual_map: 'Manual Coordinate / Map Placement',
  gis_import: 'GIS File Import',
  as_built_drawing: 'As-Built Engineering Drawing',
  unknown: 'Unknown',
};

export const CAPTURE_METHOD_LABELS: Record<CaptureMethod, string> = {
  gps_point: 'GPS Single-Point Capture',
  gps_walk_route: 'GPS Walk-and-Record Route',
  manual_pin: 'Manual Map Pin Placement',
  manual_draw: 'Manual Route Drawing',
  coordinate_entry: 'Direct Coordinate Entry',
  geojson_import: 'GeoJSON Dataset Import',
};

export const DEPTH_METHOD_LABELS: Record<DepthMeasurementMethod, string> = {
  open_trench_tape: 'Measured in Open Trench (Tape/Staff)',
  survey_level: 'Survey Level / Total Station',
  em_locator: 'Electromagnetic Cable/Pipe Locator',
  gpr: 'Ground Penetrating Radar (GPR)',
  as_built_record: 'Documented As-Built Record',
  estimated: 'Field Estimate (Unconfirmed)',
  unknown: 'Unknown',
};

export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = {
  overview: 'Asset Overview',
  exposed_trench: 'Exposed Trench (Before Covering)',
  installation: 'Installation Process',
  equipment_label: 'Equipment Nameplate / Label',
  benchmark_monument: 'Survey Benchmark Monument',
  maintenance: 'Inspection / Maintenance',
  other: 'Other Field Photo',
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  technical_report: 'Technical Report',
  borehole_log: 'Borehole Lithological / Drilling Log',
  lab_report: 'Water Quality Laboratory Report',
  as_built_drawing: 'As-Built Drawing / Layout',
  geojson_dataset: 'GeoJSON Spatial Dataset',
  csv_register: 'CSV Tabular Data',
  other: 'Supporting Document',
};

export const MONUMENT_TYPE_OPTIONS = [
  'Concrete Pillar with Brass Cap',
  'Concrete Pillar with Iron Pin',
  'Stainless Steel Survey Disc',
  'Bedrock Engraved Marker',
  'Roof/Pillar Forced-Centering GNSS Mount',
  'Temporary Benchmark (TBM)',
] as const;

export const VERTICAL_DATUM_OPTIONS = [
  'EGM2008 Orthometric',
  'Mean Sea Level (Lagos Datum)',
  'EGM96 Orthometric',
  'WGS84 Ellipsoidal',
  'Local Campus Arbitrary Datum',
] as const;

export const HORIZONTAL_CRS_OPTIONS = [
  { value: 'EPSG:4326', label: 'EPSG:4326 — WGS 84 (Geographic Lat/Lon)' },
  { value: 'EPSG:32631', label: 'EPSG:32631 — WGS 84 / UTM Zone 31N (Nigeria West/SW)' },
  { value: 'EPSG:32632', label: 'EPSG:32632 — WGS 84 / UTM Zone 32N (Nigeria Central/East)' },
  { value: 'EPSG:26331', label: 'EPSG:26331 — Minna / UTM Zone 31N' },
  { value: 'EPSG:26332', label: 'EPSG:26332 — Minna / UTM Zone 32N' },
] as const;

export const SURVEY_METHOD_OPTIONS = [
  'Dual-Frequency RTK GNSS',
  'Static Post-Processed GNSS (PPK/Static)',
  'Differential Levelling (Digital/Optical Level)',
  'Total Station Traverse',
  'Differential GNSS (DGPS/SBAS)',
  'Handheld / Smartphone Reconnaissance GPS',
] as const;

export const VERTEX_KIND_LABELS: Record<VertexKind, string> = {
  start_point: 'Route Start',
  track_point: 'Track Vertex',
  bend: 'Bend / Change of Direction',
  junction: 'Junction / Tee',
  valve: 'Inline Valve',
  manhole: 'Manhole / Chamber',
  depth_point: 'Depth Check Point',
  note_point: 'Field Note Point',
  end_point: 'Route End',
};

export const JUNCTION_KIND_LABELS: Record<JunctionKind, string> = {
  tee: 'Tee Connection',
  cross: '4-Way Cross',
  elbow: '90° / Angled Elbow',
  reducer: 'Diameter Reducer',
  chamber: 'Draw Pit / Chamber',
  splice_box: 'Fibre / Cable Splice Box',
  manhole: 'Inspection Manhole',
  service_tap: 'Building Service Tap',
  other: 'Other Connection',
};

export function isPendingVerification(status: VerificationStatus): boolean {
  return status === 'submitted' || status === 'under_review' || status === 'needs_resurvey';
}

export function formatRouteLength(lengthM: number | null | undefined): string {
  if (lengthM === null || lengthM === undefined || !Number.isFinite(lengthM)) {
    return '—';
  }
  if (lengthM >= 1000) {
    return `${(lengthM / 1000).toFixed(2)} km`;
  }
  return `${lengthM.toFixed(1)} m`;
}

