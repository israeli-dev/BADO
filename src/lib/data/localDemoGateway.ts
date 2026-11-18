import { legendEntrySchema, institutionThresholdsSchema } from '@/lib/config/legend';
import { ensureDemoSeedData } from '@/lib/data/demoSeed';
import {
  createCampusSchema,
  createDepartmentSchema,
  type CreateCampusInput,
  type CreateDepartmentInput,
  type FoundationDataGateway,
  type SignInInput,
  type UpdateSettingsInput,
} from '@/lib/data/gateway';
import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import { assertPermission, canAccessCampus } from '@/lib/permissions/rbac';
import { recordCacheSync } from '@/lib/sync/syncQueue';
import type {
  AppRole,
  AuditAction,
  AuditLogEntry,
  AuthSessionState,
  Campus,
  DashboardSummary,
  Department,
  InstitutionSettings,
  LegendEntry,
  UserInstitutionMembership,
} from '@/types/domain';
import { z } from 'zod';

const DEMO_SESSION_STORAGE_KEY = 'bado.demo.activeUserId';

/**
 * Local Demonstration Data Gateway (IndexedDB via Dexie.js).
 *
 * Enforces the same multi-institution data isolation, role-based access control,
 * campus scoping, last-administrator protection, and append-only audit logging
 * defined in `supabase/migrations/20261118000100_phase1_institutional_foundation.sql`.
 */
export class LocalDemoDataGateway implements FoundationDataGateway {
  readonly mode = 'demo' as const;
  private readonly db: BadoLocalDatabase;
  private readonly listeners = new Set<() => void>();
  private activeUserIdMemory: string | null = null;

  constructor(db: BadoLocalDatabase = badoDb) {
    this.db = db;
  }

  private getStoredUserId(): string | null {
    try {
      return window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY);
    } catch {
      return this.activeUserIdMemory;
    }
  }

  private setStoredUserId(userId: string | null): void {
    this.activeUserIdMemory = userId;
    try {
      if (userId) {
        window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, userId);
      } else {
        window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable (e.g. restricted browsing mode); rely on in-memory fallback.
    }
  }

  private notifyAuthChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async hydrateSessionForUser(userId: string): Promise<AuthSessionState | null> {
    await ensureDemoSeedData(this.db);
    const user = await this.db.profiles.get(userId);
    if (!user) return null;

    const rawMemberships = await this.db.userInstitutions
      .where('userId')
      .equals(userId)
      .filter((m) => m.isActive)
      .toArray();

    const memberships: UserInstitutionMembership[] = [];
    for (const membership of rawMemberships) {
      const institution = await this.db.institutions.get(membership.institutionId);
      if (!institution || !institution.isActive) continue;
      const department = membership.departmentId
        ? ((await this.db.departments.get(membership.departmentId)) ?? null)
        : null;
      memberships.push({
        ...membership,
        institution,
        department,
        profile: user,
      });
    }

    return {
      user,
      memberships,
      mode: 'demo',
    };
  }

  private async requireMembership(
    institutionId: string,
  ): Promise<{ session: AuthSessionState; membership: UserInstitutionMembership }> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('UNAUTHENTICATED: Please sign in to access BADO.');
    }
    const membership = session.memberships.find(
      (m) => m.institutionId === institutionId && m.isActive,
    );
    if (!membership) {
      throw new Error(
        'ACCESS DENIED: Cross-institution data access is prohibited.',
      );
    }
    return { session, membership };
  }

  private async writeAuditLog(params: {
    institutionId: string;
    actorUserId: string;
    actorName: string;
    actorRole: AppRole;
    action: AuditAction;
    entityType: string;
    entityId: string;
    summary: string;
    oldData: Record<string, unknown> | null;
    newData: Record<string, unknown> | null;
  }): Promise<void> {
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      institutionId: params.institutionId,
      actorUserId: params.actorUserId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
      oldData: params.oldData,
      newData: params.newData,
      createdAt: new Date().toISOString(),
    };
    await this.db.auditLogs.add(entry);
  }

  async getSession(): Promise<AuthSessionState | null> {
    await ensureDemoSeedData(this.db);
    const userId = this.getStoredUserId();
    if (!userId) return null;
    return this.hydrateSessionForUser(userId);
  }

  async signInWithPassword(_input: SignInInput): Promise<AuthSessionState> {
    throw new Error(
      'Supabase environment variables are not configured. Select a Demo University account below or configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.',
    );
  }

  async signInAsDemoUser(userId: string): Promise<AuthSessionState> {
    const session = await this.hydrateSessionForUser(userId);
    if (!session || session.memberships.length === 0) {
      throw new Error('Selected demonstration account was not found or is inactive.');
    }
    this.setStoredUserId(userId);
    this.notifyAuthChange();
    return session;
  }

  async signOut(): Promise<void> {
    this.setStoredUserId(null);
    this.notifyAuthChange();
  }

  onAuthStateChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async listCampuses(institutionId: string): Promise<Campus[]> {
    const { membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    const rows = await this.db.campuses
      .where('institutionId')
      .equals(institutionId)
      .filter((campus) => campus.isActive && canAccessCampus(membership, campus.id))
      .toArray();

    const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
    await recordCacheSync(institutionId, null, 'campuses', sorted.length, this.db);
    return sorted;
  }

  async listDepartments(institutionId: string): Promise<Department[]> {
    const { membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    const rows = await this.db.departments
      .where('institutionId')
      .equals(institutionId)
      .filter((dept) => dept.isActive)
      .toArray();

    const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
    await recordCacheSync(institutionId, null, 'departments', sorted.length, this.db);
    return sorted;
  }

  async getInstitutionSettings(institutionId: string): Promise<InstitutionSettings> {
    const { membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    const settings = await this.db.institutionSettings.get(institutionId);
    if (!settings) {
      throw new Error('Institution settings not found.');
    }
    return settings;
  }

  async listInstitutionMembers(
    institutionId: string,
  ): Promise<UserInstitutionMembership[]> {
    const { membership } = await this.requireMembership(institutionId);
    if (membership.role !== 'admin' && membership.role !== 'supervisor') {
      throw new Error(
        'ACCESS DENIED: Only administrators and supervisors can view the institutional user directory.',
      );
    }

    const rows = await this.db.userInstitutions
      .where('institutionId')
      .equals(institutionId)
      .toArray();

    const enriched: UserInstitutionMembership[] = [];
    for (const row of rows) {
      const profile = await this.db.profiles.get(row.userId);
      const department = row.departmentId
        ? ((await this.db.departments.get(row.departmentId)) ?? null)
        : null;
      enriched.push({ ...row, profile, department });
    }

    return enriched.sort((a, b) =>
      (a.profile?.fullName ?? '').localeCompare(b.profile?.fullName ?? ''),
    );
  }

  async listAuditLogs(institutionId: string, limit = 50): Promise<AuditLogEntry[]> {
    const { membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'admin:view_audit_logs');

    const rows = await this.db.auditLogs
      .where('institutionId')
      .equals(institutionId)
      .toArray();

    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getDashboardSummary(
    institutionId: string,
    campusId: string | null,
  ): Promise<DashboardSummary> {
    const campuses = await this.listCampuses(institutionId);
    if (campusId && !campuses.some((c) => c.id === campusId)) {
      throw new Error(
        'ACCESS DENIED: Requested campus does not belong to your permitted campuses.',
      );
    }
    const departments = await this.listDepartments(institutionId);

    // Phase 1 counts reflect real stored records (0 assets until Phase 2 asset registry is added).
    return {
      institutionId,
      campusId,
      totalAssets: 0,
      surfaceAssets: 0,
      undergroundAssets: 0,
      linearRoutes: 0,
      surveyBenchmarks: 0,
      pendingVerification: 0,
      campusCount: campuses.length,
      departmentCount: departments.length,
      recentMaintenanceCount: 0,
    };
  }

  async createCampus(
    institutionId: string,
    rawInput: CreateCampusInput,
  ): Promise<Campus> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'admin:manage_campuses');

    const input = createCampusSchema.parse(rawInput);

    const hasLat = typeof input.centerLat === 'number' && !Number.isNaN(input.centerLat);
    const hasLng = typeof input.centerLng === 'number' && !Number.isNaN(input.centerLng);
    if (hasLat !== hasLng) {
      throw new Error(
        'Provide both latitude and longitude for campus centre coordinates, or leave both blank.',
      );
    }

    const duplicate = await this.db.campuses
      .where('[institutionId+code]')
      .equals([institutionId, input.code])
      .first();
    if (duplicate) {
      throw new Error(
        `A campus with code "${input.code}" already exists in this institution.`,
      );
    }

    const institution = await this.db.institutions.get(institutionId);
    const now = new Date().toISOString();

    const campus: Campus = {
      id: crypto.randomUUID(),
      institutionId,
      name: input.name,
      code: input.code,
      description: input.description ? input.description : null,
      isDemo: institution?.isDemo ?? true,
      center:
        hasLat && hasLng
          ? { lat: input.centerLat as number, lng: input.centerLng as number }
          : null,
      defaultZoom: input.defaultZoom,
      isActive: true,
      createdBy: session.user.id,
      updatedBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.campuses.add(campus);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'insert',
      entityType: 'campuses',
      entityId: campus.id,
      summary: `Created campus "${campus.name}" (${campus.code}).`,
      oldData: null,
      newData: { name: campus.name, code: campus.code, center: campus.center },
    });

    return campus;
  }

  async createDepartment(
    institutionId: string,
    rawInput: CreateDepartmentInput,
  ): Promise<Department> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'admin:manage_departments');

    const input = createDepartmentSchema.parse(rawInput);
    const duplicate = await this.db.departments
      .where('[institutionId+code]')
      .equals([institutionId, input.code])
      .first();
    if (duplicate) {
      throw new Error(
        `A department with code "${input.code}" already exists in this institution.`,
      );
    }

    const now = new Date().toISOString();
    const department: Department = {
      id: crypto.randomUUID(),
      institutionId,
      name: input.name,
      code: input.code,
      description: input.description ? input.description : null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.departments.add(department);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'insert',
      entityType: 'departments',
      entityId: department.id,
      summary: `Created department "${department.name}" (${department.code}).`,
      oldData: null,
      newData: { name: department.name, code: department.code },
    });

    return department;
  }

  async updateInstitutionThresholds(
    institutionId: string,
    rawInput: Omit<UpdateSettingsInput, 'legendConfig'>,
  ): Promise<InstitutionSettings> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'admin:manage_settings');

    const validated = institutionThresholdsSchema.parse(rawInput);
    const current = await this.db.institutionSettings.get(institutionId);
    if (!current) {
      throw new Error('Institution settings not found.');
    }

    const updated: InstitutionSettings = {
      ...current,
      ...validated,
      updatedBy: session.user.id,
      updatedAt: new Date().toISOString(),
    };

    await this.db.institutionSettings.put(updated);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'update',
      entityType: 'institution_settings',
      entityId: institutionId,
      summary: 'Updated awareness thresholds and verification settings.',
      oldData: {
        defaultDigBufferM: current.defaultDigBufferM,
        liveNearbyM: current.liveNearbyM,
        liveApproachingM: current.liveApproachingM,
        liveCloseM: current.liveCloseM,
        requireVerificationApproval: current.requireVerificationApproval,
        allowPublicPassports: current.allowPublicPassports,
      },
      newData: validated,
    });

    return updated;
  }

  async updateLegendConfig(
    institutionId: string,
    rawLegend: LegendEntry[],
  ): Promise<InstitutionSettings> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'admin:manage_settings');

    const legend = z.array(legendEntrySchema).min(1).parse(rawLegend);
    const current = await this.db.institutionSettings.get(institutionId);
    if (!current) {
      throw new Error('Institution settings not found.');
    }

    const updated: InstitutionSettings = {
      ...current,
      legendConfig: legend,
      updatedBy: session.user.id,
      updatedAt: new Date().toISOString(),
    };

    await this.db.institutionSettings.put(updated);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'update',
      entityType: 'institution_settings',
      entityId: institutionId,
      summary: `Updated configurable map legend (${legend.length} categories).`,
      oldData: { legendCount: current.legendConfig.length },
      newData: { legendCount: legend.length },
    });

    return updated;
  }

  async updateMemberRole(
    institutionId: string,
    membershipId: string,
    role: AppRole,
    isActive: boolean,
  ): Promise<UserInstitutionMembership> {
    const { session, membership: actorMembership } =
      await this.requireMembership(institutionId);
    assertPermission(actorMembership, institutionId, 'admin:manage_users');

    const target = await this.db.userInstitutions.get(membershipId);
    if (!target || target.institutionId !== institutionId) {
      throw new Error(
        'Target membership not found in the active institution.',
      );
    }

    // Mirror PostgreSQL trigger `protect_last_institution_admin()`
    if (
      target.role === 'admin' &&
      target.isActive &&
      (role !== 'admin' || !isActive)
    ) {
      const otherAdmins = await this.db.userInstitutions
        .where('[institutionId+role]')
        .equals([institutionId, 'admin'])
        .filter((m) => m.isActive && m.id !== target.id)
        .count();

      if (otherAdmins === 0) {
        throw new Error(
          'Cannot remove or deactivate the last active administrator of an institution.',
        );
      }
    }

    const updated: UserInstitutionMembership = {
      ...target,
      role,
      isActive,
      updatedAt: new Date().toISOString(),
    };

    await this.db.userInstitutions.put(updated);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: actorMembership.role,
      action: 'update',
      entityType: 'user_institutions',
      entityId: updated.id,
      summary: `Updated member role from "${target.role}" to "${role}" (active: ${isActive}).`,
      oldData: { role: target.role, isActive: target.isActive },
      newData: { role: updated.role, isActive: updated.isActive },
    });

    if (target.userId === session.user.id) {
      this.notifyAuthChange();
    }

    return updated;
  }
}
