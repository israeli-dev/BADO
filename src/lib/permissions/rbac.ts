import type { AppRole, UserInstitutionMembership } from '@/types/domain';

/**
 * Capability flags mirrored from database Row Level Security policies.
 * SECURITY NOTE: Frontend checks only control navigation and UI ergonomics.
 * Authoritative access control is always enforced by PostgreSQL RLS and server-side checks.
 */
export const PERMISSIONS = [
  'infrastructure:view',
  'assets:create',
  'assets:edit_own_draft',
  'assets:verify',
  'assets:archive',
  'routes:record',
  'routes:edit_geometry',
  'gis:import',
  'gis:export',
  'benchmarks:manage',
  'dig_check:run',
  'live_mode:use',
  'passports:view',
  'passports:manage',
  'operations:record',
  'operations:review',
  'reports:view',
  'reports:export',
  'admin:access',
  'admin:manage_campuses',
  'admin:manage_departments',
  'admin:manage_users',
  'admin:manage_settings',
  'admin:view_audit_logs',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleMetadata {
  role: AppRole;
  label: string;
  shortLabel: string;
  description: string;
}

export const ROLE_METADATA: Record<AppRole, RoleMetadata> = {
  admin: {
    role: 'admin',
    label: 'Administrator',
    shortLabel: 'Admin',
    description:
      'Manages institutional settings, campuses, departments, users, legend categories, and audit logs.',
  },
  supervisor: {
    role: 'supervisor',
    label: 'Supervisor',
    shortLabel: 'Supervisor',
    description:
      'Reviews and verifies submitted asset records, oversees inspections/maintenance, and exports institutional reports.',
  },
  field_technician: {
    role: 'field_technician',
    label: 'Field Technician / Artisan',
    shortLabel: 'Field Tech',
    description:
      'Registers assets, captures GPS points and utility routes, uploads photos, scans QR codes, and logs inspections.',
  },
  surveyor_gis: {
    role: 'surveyor_gis',
    label: 'Surveyor / GIS Officer',
    shortLabel: 'Surveyor / GIS',
    description:
      'Manages survey benchmarks, reviews spatial accuracy, edits spatial geometries, and imports/exports GIS data.',
  },
  read_only: {
    role: 'read_only',
    label: 'Read-only User',
    shortLabel: 'Read-only',
    description:
      'Views permitted campus maps, asset registers, proximity checks, and authorised digital passports.',
  },
};

const ROLE_PERMISSION_MAP: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set<Permission>(PERMISSIONS),
  supervisor: new Set<Permission>([
    'infrastructure:view',
    'assets:create',
    'assets:edit_own_draft',
    'assets:verify',
    'assets:archive',
    'routes:record',
    'gis:export',
    'dig_check:run',
    'live_mode:use',
    'passports:view',
    'passports:manage',
    'operations:record',
    'operations:review',
    'reports:view',
    'reports:export',
  ]),
  field_technician: new Set<Permission>([
    'infrastructure:view',
    'assets:create',
    'assets:edit_own_draft',
    'routes:record',
    'dig_check:run',
    'live_mode:use',
    'passports:view',
    'operations:record',
  ]),
  surveyor_gis: new Set<Permission>([
    'infrastructure:view',
    'assets:create',
    'assets:edit_own_draft',
    'routes:record',
    'routes:edit_geometry',
    'gis:import',
    'gis:export',
    'benchmarks:manage',
    'dig_check:run',
    'live_mode:use',
    'passports:view',
    'passports:manage',
    'operations:record',
    'reports:view',
    'reports:export',
  ]),
  read_only: new Set<Permission>([
    'infrastructure:view',
    'dig_check:run',
    'live_mode:use',
    'passports:view',
    'reports:view',
  ]),
};

export function roleHasPermission(
  role: AppRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSION_MAP[role].has(permission);
}

export function canAccessCampus(
  membership: Pick<UserInstitutionMembership, 'role' | 'allowedCampusIds' | 'isActive'> | null | undefined,
  campusId: string,
): boolean {
  if (!membership || !membership.isActive) return false;
  if (membership.role === 'admin') return true;
  if (membership.allowedCampusIds === null) return true;
  return membership.allowedCampusIds.includes(campusId);
}

export function assertPermission(
  membership: Pick<UserInstitutionMembership, 'role' | 'isActive' | 'institutionId'> | null | undefined,
  targetInstitutionId: string,
  permission: Permission,
): void {
  if (!membership || !membership.isActive) {
    throw new Error('ACCESS DENIED: Active institutional membership is required.');
  }
  if (membership.institutionId !== targetInstitutionId) {
    throw new Error(
      'ACCESS DENIED: Cross-institution data access is prohibited.',
    );
  }
  if (!roleHasPermission(membership.role, permission)) {
    throw new Error(
      `ACCESS DENIED: Role "${ROLE_METADATA[membership.role].label}" lacks permission "${permission}".`,
    );
  }
}
