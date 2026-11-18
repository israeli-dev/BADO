import type { Geometry } from 'geojson';

/**
 * BADO Core Domain Types (Phases 1–2: Institutional Foundation + Core Asset Registry)
 * Mirrors `supabase/migrations/20261118000100_*.sql` and `20261118000200_*.sql`.
 */

export const APP_ROLES = [
  'admin',
  'supervisor',
  'field_technician',
  'surveyor_gis',
  'read_only',
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const AUDIT_ACTIONS = [
  'insert',
  'update',
  'delete',
  'archive',
  'approve',
  'reject',
  'import',
  'export',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const LEGEND_UTILITY_KEYS = [
  'surface_facility',
  'water',
  'electrical',
  'telecom',
  'drainage_sewer',
  'other_utility',
  'critical_hazard',
  'survey_benchmark',
] as const;

export type LegendUtilityKey = (typeof LEGEND_UTILITY_KEYS)[number];

export type LegendLineStyle = 'solid' | 'dashed' | 'dotted';

export interface LegendEntry {
  key: LegendUtilityKey | string;
  label: string;
  colorHex: string;
  iconKey: string;
  lineStyle: LegendLineStyle;
  defaultVisible: boolean;
}

export interface GeoCoordinates {
  /** WGS84 Latitude (EPSG:4326), -90..90 */
  lat: number;
  /** WGS84 Longitude (EPSG:4326), -180..180 */
  lng: number;
}

// -----------------------------------------------------------------------------
// Phase 1 Institutional Types
// -----------------------------------------------------------------------------

export interface Institution {
  id: string;
  name: string;
  slug: string;
  shortCode: string;
  countryCode: string;
  isDemo: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InstitutionSettings {
  institutionId: string;
  /** Awareness search buffer in metres (NOT a certified safe digging clearance). */
  defaultDigBufferM: number;
  liveNearbyM: number;
  liveApproachingM: number;
  liveCloseM: number;
  requireVerificationApproval: boolean;
  allowPublicPassports: boolean;
  legendConfig: LegendEntry[];
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Campus {
  id: string;
  institutionId: string;
  name: string;
  code: string;
  description: string | null;
  isDemo: boolean;
  center: GeoCoordinates | null;
  defaultZoom: number;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  institutionId: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserInstitutionMembership {
  id: string;
  userId: string;
  institutionId: string;
  departmentId: string | null;
  role: AppRole;
  /** `null` grants access to all active campuses in the institution; non-null limits access. */
  allowedCampusIds: string[] | null;
  isActive: boolean;
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
  institution?: Institution;
  department?: Department | null;
  profile?: UserProfile;
}

export interface AuditLogEntry {
  id: string;
  institutionId: string;
  actorUserId: string | null;
  actorName?: string | null;
  actorRole: AppRole | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Phase 2 Core Asset Classification, GNSS, Verification & Media Types
// -----------------------------------------------------------------------------

export const ASSET_CATEGORIES = [
  'surface',
  'underground',
  'survey_reference',
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const UTILITY_GROUPS = [
  'surface_facility',
  'water',
  'electrical',
  'telecom',
  'drainage_sewer',
  'gas',
  'other_utility',
  'critical_hazard',
  'survey_benchmark',
] as const;

export type UtilityGroup = (typeof UTILITY_GROUPS)[number];

export const OPERATIONAL_STATUSES = [
  'operational',
  'maintenance',
  'faulty',
  'standby',
  'decommissioned',
  'unknown',
] as const;

export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

export const PHYSICAL_CONDITIONS = [
  'excellent',
  'good',
  'fair',
  'poor',
  'critical',
  'unknown',
] as const;

export type PhysicalCondition = (typeof PHYSICAL_CONDITIONS)[number];

export const VERIFICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'verified',
  'rejected',
  'needs_resurvey',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DATA_QUALITIES = [
  'verified',
  'unverified',
  'needs_resurvey',
  'incomplete',
  'outdated',
] as const;

export type DataQuality = (typeof DATA_QUALITIES)[number];

export const GNSS_FIX_QUALITIES = [
  'autonomous',
  'differential',
  'rtk_float',
  'rtk_fixed',
  'unknown',
] as const;

export type GnssFixQuality = (typeof GNSS_FIX_QUALITIES)[number];

export const POSITION_SOURCES = [
  'smartphone_gps',
  'external_gnss',
  'total_station',
  'manual_map',
  'gis_import',
  'as_built_drawing',
  'unknown',
] as const;

export type PositionSource = (typeof POSITION_SOURCES)[number];

export const CAPTURE_METHODS = [
  'gps_point',
  'gps_walk_route',
  'manual_pin',
  'manual_draw',
  'coordinate_entry',
  'geojson_import',
] as const;

export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const DEPTH_MEASUREMENT_METHODS = [
  'open_trench_tape',
  'survey_level',
  'em_locator',
  'gpr',
  'as_built_record',
  'estimated',
  'unknown',
] as const;

export type DepthMeasurementMethod = (typeof DEPTH_MEASUREMENT_METHODS)[number];

export const PHOTO_KINDS = [
  'overview',
  'exposed_trench',
  'installation',
  'equipment_label',
  'benchmark_monument',
  'maintenance',
  'other',
] as const;

export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const DOCUMENT_KINDS = [
  'technical_report',
  'borehole_log',
  'lab_report',
  'as_built_drawing',
  'geojson_dataset',
  'csv_register',
  'other',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const VERTEX_KINDS = [
  'start_point',
  'track_point',
  'bend',
  'junction',
  'valve',
  'manhole',
  'depth_point',
  'note_point',
  'end_point',
] as const;

export type VertexKind = (typeof VERTEX_KINDS)[number];

export const JUNCTION_KINDS = [
  'tee',
  'cross',
  'elbow',
  'reducer',
  'chamber',
  'splice_box',
  'manhole',
  'service_tap',
  'other',
] as const;

export type JunctionKind = (typeof JUNCTION_KINDS)[number];

export type AllowedGeometryType =
  | 'Point'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon';

export type DynamicFieldType = 'text' | 'number' | 'select' | 'boolean' | 'date';

export interface DynamicFieldDefinition {
  key: string;
  label: string;
  type: DynamicFieldType;
  required?: boolean;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface AssetTypeDefinition {
  id: string;
  institutionId: string;
  category: AssetCategory;
  utilityGroup: UtilityGroup;
  code: string;
  name: string;
  description: string | null;
  defaultCodePrefix: string;
  allowedGeomTypes: AllowedGeometryType[];
  colorHex: string;
  iconKey: string;
  lineStyle: LegendLineStyle;
  fieldSchema: DynamicFieldDefinition[];
  supportsPassport: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CustomAttributeValue = string | number | boolean | null;

export interface AssetRecord {
  id: string;
  institutionId: string;
  campusId: string;
  departmentId: string | null;
  assetTypeId: string;
  assetCode: string;
  name: string;
  category: AssetCategory;
  utilityGroup: UtilityGroup;
  description: string | null;
  geometry: Geometry;
  /** Geodesic route length in metres for LineString / MultiLineString assets. */
  routeLengthM?: number | null;
  installationDate: string | null;
  operationalStatus: OperationalStatus;
  physicalCondition: PhysicalCondition;
  verificationStatus: VerificationStatus;
  dataQuality: DataQuality;
  isCriticalHazard: boolean;

  // Underground specifications (depth never inferred from GPS altitude)
  material: string | null;
  diameterMm: number | null;
  cableSpecification: string | null;
  recordedDepthM: number | null;
  depthIsVariable: boolean;
  depthMeasurementMethod: DepthMeasurementMethod | null;
  documentedBeforeCovering: boolean;
  directionDescription: string | null;
  constructionRecordRef: string | null;

  // Dynamic type-specific fields
  customAttributes: Record<string, CustomAttributeValue>;

  // Benchmark & location references
  referenceBenchmarkId: string | null;
  locationReferenceText: string | null;
  notes: string | null;

  // GNSS & positioning readiness metadata
  positionSource: PositionSource;
  captureMethod: CaptureMethod;
  receiverModel: string | null;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  fixQuality: GnssFixQuality;
  correctionSource: string | null;
  sourceCrs: string;
  measuredAt: string;
  isManuallyAdjusted: boolean;

  // Offline capture timestamp, verification trace, version & archival
  capturedAt: string;
  lastVerifiedAt: string | null;
  lastVerifiedBy: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  createdAt: string;
  updatedAt: string;

  /** Present when a locally saved record is waiting to synchronise to the server. */
  localSyncStatus?: 'synced' | 'pending' | 'failed' | 'requires_review';
}

export interface SurveyBenchmarkRecord {
  assetId: string;
  institutionId: string;
  referenceCode: string;
  monumentType: string;
  elevationM: number | null;
  verticalDatum: string;
  horizontalCrs: string;
  surveyMethod: string;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  surveyDate: string | null;
  surveyorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetObservationRecord {
  id: string;
  institutionId: string;
  assetId: string;
  location: GeoCoordinates;
  depthM: number | null;
  depthMeasurementMethod: DepthMeasurementMethod | null;
  elevationM: number | null;
  positionSource: PositionSource;
  receiverModel: string | null;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  fixQuality: GnssFixQuality;
  correctionSource: string | null;
  sourceCrs: string;
  measuredAt: string;
  notes: string | null;
  observedBy: string | null;
  createdAt: string;
}

export interface AssetVerificationEvent {
  id: string;
  institutionId: string;
  assetId: string;
  fromStatus: VerificationStatus | null;
  toStatus: VerificationStatus;
  reviewerId: string | null;
  reviewerName?: string | null;
  reviewerRole: AppRole | null;
  remarks: string;
  createdAt: string;
}

export interface AssetPhotoRecord {
  id: string;
  institutionId: string;
  assetId: string;
  observationId: string | null;
  storagePath: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  photoKind: PhotoKind;
  caption: string | null;
  capturedAt: string;
  uploadedBy: string | null;
  uploadedByName?: string | null;
  createdAt: string;
  /** Signed storage URL or local object URL resolved at read time. */
  previewUrl?: string | null;
  localBlobId?: string | null;
}

export interface AssetDocumentRecord {
  id: string;
  institutionId: string;
  assetId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  documentKind: DocumentKind;
  title: string;
  description: string | null;
  uploadedBy: string | null;
  uploadedByName?: string | null;
  createdAt: string;
  downloadUrl?: string | null;
  localBlobId?: string | null;
}

export interface LocalMediaBlobRecord {
  id: string;
  institutionId: string;
  assetId: string;
  mediaKind: 'photo' | 'document';
  fileName: string;
  mimeType: string;
  blob: Blob;
  createdAt: string;
}

export interface UtilityRouteVertexRecord {
  id: string;
  institutionId: string;
  assetId: string;
  partIndex: number;
  sequenceIndex: number;
  vertexKind: VertexKind;
  location: GeoCoordinates;
  chainageM: number | null;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  fixQuality: GnssFixQuality;
  notes: string | null;
  recordedAt: string;
  createdBy: string | null;
  createdAt: string;
}

export interface UtilityDepthObservationRecord {
  id: string;
  institutionId: string;
  assetId: string;
  location: GeoCoordinates;
  depthM: number;
  measurementMethod: DepthMeasurementMethod;
  documentedBeforeCovering: boolean;
  chainageM: number | null;
  horizontalAccuracyM: number | null;
  notes: string | null;
  observedAt: string;
  observedBy: string | null;
  observedByName?: string | null;
  createdAt: string;
}

export interface UtilityJunctionRecord {
  id: string;
  institutionId: string;
  assetId: string;
  connectedAssetId: string | null;
  junctionKind: JunctionKind;
  label: string | null;
  location: GeoCoordinates;
  depthM: number | null;
  depthMeasurementMethod: DepthMeasurementMethod | null;
  notes: string | null;
  recordedAt: string;
  createdBy: string | null;
  createdAt: string;
}

export interface AssetListItem {
  asset: AssetRecord;
  assetType: AssetTypeDefinition;
  campus: Campus | null;
  department: Department | null;
  benchmark: SurveyBenchmarkRecord | null;
  photoCount: number;
  documentCount: number;
  depthObservationCount?: number;
  minDepthM?: number | null;
  maxDepthM?: number | null;
}

export interface AssetDetailBundle extends AssetListItem {
  registeredByName: string | null;
  lastVerifiedByName: string | null;
  referenceBenchmark: {
    assetId: string;
    name: string;
    referenceCode: string;
    elevationM: number | null;
    verticalDatum: string;
  } | null;
  photos: AssetPhotoRecord[];
  documents: AssetDocumentRecord[];
  observations: AssetObservationRecord[];
  routeVertices: UtilityRouteVertexRecord[];
  depthObservations: UtilityDepthObservationRecord[];
  junctions: UtilityJunctionRecord[];
  verificationHistory: AssetVerificationEvent[];
}

export interface AssetListFilters {
  campusId?: string | null;
  search?: string;
  category?: AssetCategory | 'all';
  assetTypeId?: string | 'all';
  utilityGroup?: UtilityGroup | 'all';
  operationalStatus?: OperationalStatus | 'all';
  verificationStatus?: VerificationStatus | 'pending_review' | 'all';
  geometryScope?: 'all' | 'points' | 'linear';
}

// -----------------------------------------------------------------------------
// Dashboard & Offline Sync Types
// -----------------------------------------------------------------------------

export interface DashboardSummary {
  institutionId: string;
  campusId: string | null;
  totalAssets: number;
  surfaceAssets: number;
  undergroundAssets: number;
  linearRoutes: number;
  surveyBenchmarks: number;
  pendingVerification: number;
  campusCount: number;
  departmentCount: number;
  recentMaintenanceCount: number;
}

export const SYNC_STATUSES = [
  'pending',
  'syncing',
  'synced',
  'failed',
  'requires_review',
] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export type SyncOperationType =
  | 'create'
  | 'update'
  | 'archive'
  | 'verify'
  | 'upload_photo'
  | 'upload_document';

export interface SyncQueueRecord {
  /** Client-generated UUIDv4 used as server-side idempotency key. */
  id: string;
  institutionId: string;
  campusId: string | null;
  recordType: string;
  recordId: string;
  operationType: SyncOperationType;
  payload: Record<string, unknown>;
  /** Expected server row version for conflict detection on updates. */
  baseVersion: number | null;
  /** Original field capture timestamp (preserved even if synced days later). */
  capturedAt: string;
  createdAt: string;
  lastAttemptAt: string | null;
  status: SyncStatus;
  retryCount: number;
  errorDetails: string | null;
  conflictSnapshot: Record<string, unknown> | null;
}

export interface CacheMetaRecord {
  /** Composite key `${institutionId}:${campusId ?? 'all'}:${scope}` */
  key: string;
  institutionId: string;
  campusId: string | null;
  scope: string;
  syncedAt: string;
  recordCount: number;
}

export interface AuthSessionState {
  user: UserProfile;
  memberships: UserInstitutionMembership[];
  mode: 'supabase' | 'demo';
}
