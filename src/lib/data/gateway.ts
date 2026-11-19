import { z } from 'zod';
import type {
  AddDepthObservationInput,
  CreateAssetInput,
  CreateLinearRouteInput,
  ReviewVerificationInput,
  UpdateRouteGeometryInput,
} from '@/lib/assets/validation';
import {
  institutionThresholdsSchema,
  legendEntrySchema,
} from '@/lib/config/legend';
import type { BadoGeoJsonFeatureCollection } from '@/lib/gis/geojsonIo';
import {
  APP_ROLES,
  type AppRole,
  type AssetCategory,
  type AssetDetailBundle,
  type AssetDocumentRecord,
  type AssetListFilters,
  type AssetListItem,
  type AssetPhotoRecord,
  type AssetRecord,
  type AssetTypeDefinition,
  type AuditLogEntry,
  type AuthSessionState,
  type Campus,
  type DashboardSummary,
  type Department,
  type DocumentKind,
  type InstitutionSettings,
  type LegendEntry,
  type PhotoKind,
  type UserInstitutionMembership,
  type UtilityDepthObservationRecord,
} from '@/types/domain';

export const signInSchema = z.object({
  email: z.email('Enter a valid institutional email address.').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(140),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid institutional email address.')),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(72, 'Password must be at most 72 characters.'),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'], message: 'Passwords do not match.',
});
export type SignUpInput = z.infer<typeof signUpSchema>;


export const createCampusSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Campus name must be at least 2 characters.')
    .max(140, 'Campus name must be 140 characters or fewer.'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9_-]{1,23}$/,
      'Use 2–24 uppercase letters, digits, hyphens, or underscores (e.g. NORTH_CAMPUS).',
    ),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1,000 characters or fewer.')
    .optional()
    .or(z.literal('')),
  centerLat: z
    .number()
    .min(-90, 'Latitude must be between -90 and 90.')
    .max(90, 'Latitude must be between -90 and 90.')
    .nullable()
    .optional(),
  centerLng: z
    .number()
    .min(-180, 'Longitude must be between -180 and 180.')
    .max(180, 'Longitude must be between -180 and 180.')
    .nullable()
    .optional(),
  defaultZoom: z.number().int().min(1).max(22).default(16),
});

export type CreateCampusInput = z.infer<typeof createCampusSchema>;

export const createDepartmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Department name must be at least 2 characters.')
    .max(140, 'Department name must be 140 characters or fewer.'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9_-]{1,23}$/,
      'Use 2–24 uppercase letters, digits, hyphens, or underscores (e.g. WATER_UNIT).',
    ),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer.')
    .optional()
    .or(z.literal('')),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateMembershipRoleSchema = z.object({
  membershipId: z.uuid(),
  role: z.enum(APP_ROLES),
  isActive: z.boolean(),
});

export type UpdateMembershipRoleInput = z.infer<typeof updateMembershipRoleSchema>;

export const updateSettingsSchema = institutionThresholdsSchema.extend({
  legendConfig: z.array(legendEntrySchema).min(1).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface UploadAssetPhotoInput {
  assetId: string;
  file: File;
  photoKind: PhotoKind;
  caption?: string;
  capturedAt?: string;
  saveOffline?: boolean;
}

export interface UploadAssetDocumentInput {
  assetId: string;
  file: File;
  documentKind: DocumentKind;
  title: string;
  description?: string;
  saveOffline?: boolean;
}

export interface BenchmarkReferenceOption {
  assetId: string;
  campusId: string;
  name: string;
  referenceCode: string;
  elevationM: number | null;
  verticalDatum: string;
}

/**
 * Unified Data Gateway for BADO (Phases 1–2: Institutional Foundation + Core Asset Management).
 * Implemented by both `SupabaseDataGateway` (production PostgreSQL + PostGIS + Storage + RLS)
 * and `LocalDemoDataGateway` (clearly labelled IndexedDB simulation sandbox).
 */
export interface BadoDataGateway {
  readonly mode: 'supabase' | 'demo';

  // Authentication & session
  getSession(): Promise<AuthSessionState | null>;
  signInWithPassword(input: SignInInput): Promise<AuthSessionState>;
  signUp(input: SignUpInput): Promise<AuthSessionState | null>;
  signInAsDemoUser(userId: string): Promise<AuthSessionState>;
  signOut(): Promise<void>;
  onAuthStateChange(listener: () => void): () => void;

  // Institutional reads
  listCampuses(institutionId: string): Promise<Campus[]>;
  listDepartments(institutionId: string): Promise<Department[]>;
  getInstitutionSettings(institutionId: string): Promise<InstitutionSettings>;
  listInstitutionMembers(institutionId: string): Promise<UserInstitutionMembership[]>;
  listAuditLogs(institutionId: string, limit?: number): Promise<AuditLogEntry[]>;
  getDashboardSummary(
    institutionId: string,
    campusId: string | null,
  ): Promise<DashboardSummary>;

  // Institutional administration mutations (admin-only, audited)
  assignConfirmedMember(institutionId: string, campusId: string, email: string): Promise<void>;
  createCampus(institutionId: string, input: CreateCampusInput): Promise<Campus>;
  createDepartment(
    institutionId: string,
    input: CreateDepartmentInput,
  ): Promise<Department>;
  updateInstitutionThresholds(
    institutionId: string,
    input: Omit<UpdateSettingsInput, 'legendConfig'>,
  ): Promise<InstitutionSettings>;
  updateLegendConfig(
    institutionId: string,
    legend: LegendEntry[],
  ): Promise<InstitutionSettings>;
  updateMemberRole(
    institutionId: string,
    membershipId: string,
    role: AppRole,
    isActive: boolean,
  ): Promise<UserInstitutionMembership>;

  // Phase 2 — Core Asset Registry, Verification & Media
  listAssetTypes(
    institutionId: string,
    category?: AssetCategory,
  ): Promise<AssetTypeDefinition[]>;
  listBenchmarkReferences(
    institutionId: string,
    campusId?: string | null,
  ): Promise<BenchmarkReferenceOption[]>;
  listAssets(
    institutionId: string,
    filters?: AssetListFilters,
  ): Promise<AssetListItem[]>;
  getAssetDetail(
    institutionId: string,
    assetId: string,
  ): Promise<AssetDetailBundle>;
  createAsset(
    institutionId: string,
    input: CreateAssetInput,
  ): Promise<AssetRecord>;
  submitDraftAsset(
    institutionId: string,
    assetId: string,
  ): Promise<AssetRecord>;
  reviewAssetVerification(
    institutionId: string,
    input: ReviewVerificationInput,
  ): Promise<AssetRecord>;
  archiveAsset(
    institutionId: string,
    assetId: string,
    reason: string,
  ): Promise<void>;
  uploadAssetPhoto(
    institutionId: string,
    input: UploadAssetPhotoInput,
  ): Promise<AssetPhotoRecord>;
  uploadAssetDocument(
    institutionId: string,
    input: UploadAssetDocumentInput,
  ): Promise<AssetDocumentRecord>;

  // Phase 3 — Linear Infrastructure Mapping, Depth Observations & GeoJSON Export
  createLinearRoute(
    institutionId: string,
    input: CreateLinearRouteInput,
  ): Promise<AssetRecord>;
  updateRouteGeometry(
    institutionId: string,
    input: UpdateRouteGeometryInput,
  ): Promise<AssetRecord>;
  addDepthObservation(
    institutionId: string,
    input: AddDepthObservationInput,
  ): Promise<UtilityDepthObservationRecord>;
  exportAssetsGeoJson(
    institutionId: string,
    filters?: AssetListFilters,
  ): Promise<BadoGeoJsonFeatureCollection>;
}

/** Backwards-compatible alias for Phase 1 consumers. */
export type FoundationDataGateway = BadoDataGateway;
