import { describe, expect, it } from 'vitest';
import {
  assertPermission,
  canAccessCampus,
  PERMISSIONS,
  roleHasPermission,
} from '@/lib/permissions/rbac';

describe('role-based access control (RBAC) matrix', () => {
  it('grants administrators every institutional capability', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('admin', permission)).toBe(true);
    }
  });

  it('allows supervisors to verify assets and export reports, but blocks admin settings', () => {
    expect(roleHasPermission('supervisor', 'assets:verify')).toBe(true);
    expect(roleHasPermission('supervisor', 'reports:export')).toBe(true);
    expect(roleHasPermission('supervisor', 'admin:access')).toBe(false);
    expect(roleHasPermission('supervisor', 'admin:manage_users')).toBe(false);
    expect(roleHasPermission('supervisor', 'gis:import')).toBe(false);
  });

  it('allows field technicians to log assets, routes, and inspections, but not verify or archive', () => {
    expect(roleHasPermission('field_technician', 'assets:create')).toBe(true);
    expect(roleHasPermission('field_technician', 'routes:record')).toBe(true);
    expect(roleHasPermission('field_technician', 'operations:record')).toBe(true);
    expect(roleHasPermission('field_technician', 'dig_check:run')).toBe(true);
    expect(roleHasPermission('field_technician', 'live_mode:use')).toBe(true);
    expect(roleHasPermission('field_technician', 'assets:verify')).toBe(false);
    expect(roleHasPermission('field_technician', 'assets:archive')).toBe(false);
    expect(roleHasPermission('field_technician', 'admin:access')).toBe(false);
  });

  it('allows surveyors/GIS officers to manage benchmarks, edit geometries, and import/export GIS', () => {
    expect(roleHasPermission('surveyor_gis', 'benchmarks:manage')).toBe(true);
    expect(roleHasPermission('surveyor_gis', 'routes:edit_geometry')).toBe(true);
    expect(roleHasPermission('surveyor_gis', 'gis:import')).toBe(true);
    expect(roleHasPermission('surveyor_gis', 'gis:export')).toBe(true);
    expect(roleHasPermission('surveyor_gis', 'admin:manage_campuses')).toBe(false);
  });

  it('restricts read-only users from every write, verification, export, and admin capability', () => {
    expect(roleHasPermission('read_only', 'infrastructure:view')).toBe(true);
    expect(roleHasPermission('read_only', 'dig_check:run')).toBe(true);
    expect(roleHasPermission('read_only', 'passports:view')).toBe(true);
    expect(roleHasPermission('read_only', 'assets:create')).toBe(false);
    expect(roleHasPermission('read_only', 'routes:record')).toBe(false);
    expect(roleHasPermission('read_only', 'operations:record')).toBe(false);
    expect(roleHasPermission('read_only', 'reports:export')).toBe(false);
    expect(roleHasPermission('read_only', 'admin:access')).toBe(false);
  });

  it('enforces campus scoping and blocks cross-institution assertions', () => {
    expect(
      canAccessCampus(
        {
          role: 'read_only',
          allowedCampusIds: ['campus-1'],
          isActive: true,
        },
        'campus-1',
      ),
    ).toBe(true);

    expect(
      canAccessCampus(
        {
          role: 'read_only',
          allowedCampusIds: ['campus-1'],
          isActive: true,
        },
        'campus-2',
      ),
    ).toBe(false);

    expect(() =>
      assertPermission(
        {
          role: 'admin',
          institutionId: 'inst-a',
          isActive: true,
        },
        'inst-b',
        'infrastructure:view',
      ),
    ).toThrow(/Cross-institution/);
  });
});
