/**
 * BADO Core Domain Types (Phase 1 — Institutional, RBAC, Legend, Audit & Offline Sync Foundation)
 * Mirrors `supabase/migrations/20261118000100_phase1_institutional_foundation.sql`.
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

export type SyncOperationType = 'create' | 'update' | 'archive' | 'verify' | 'upload_photo';

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
