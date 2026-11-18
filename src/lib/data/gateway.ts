import { z } from 'zod';
import {
  institutionThresholdsSchema,
  legendEntrySchema,
} from '@/lib/config/legend';
import {
  APP_ROLES,
  type AppRole,
  type AuditLogEntry,
  type AuthSessionState,
  type Campus,
  type DashboardSummary,
  type Department,
  type InstitutionSettings,
  type LegendEntry,
  type UserInstitutionMembership,
} from '@/types/domain';

export const signInSchema = z.object({
  email: z.email('Enter a valid institutional email address.').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export type SignInInput = z.infer<typeof signInSchema>;

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

/**
 * Unified Data Gateway for BADO Phase 1 Foundation.
 * Implemented by both `SupabaseDataGateway` (production PostgreSQL + PostGIS + RLS)
 * and `LocalDemoDataGateway` (clearly labelled IndexedDB simulation sandbox).
 */
export interface FoundationDataGateway {
  readonly mode: 'supabase' | 'demo';

  // Authentication & session
  getSession(): Promise<AuthSessionState | null>;
  signInWithPassword(input: SignInInput): Promise<AuthSessionState>;
  signInAsDemoUser(userId: string): Promise<AuthSessionState>;
  signOut(): Promise<void>;
  onAuthStateChange(listener: () => void): () => void;

  // Institutional reads (isolated by institutionId + active membership)
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
}
