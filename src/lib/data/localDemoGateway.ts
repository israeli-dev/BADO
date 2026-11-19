import { z } from 'zod';
import { isPendingVerification } from '@/lib/assets/labels';
import {
  addDepthObservationInputSchema,
  createAssetInputSchema,
  createLinearRouteInputSchema,
  reviewVerificationSchema,
  updateRouteGeometryInputSchema,
  uploadAssetDocumentMetaSchema,
  uploadAssetPhotoMetaSchema,
  validateDynamicAttributes,
  type AddDepthObservationInput,
  type CreateAssetInput,
  type CreateLinearRouteInput,
  type ReviewVerificationInput,
  type UpdateRouteGeometryInput,
} from '@/lib/assets/validation';
import {
  institutionThresholdsSchema,
  legendEntrySchema,
} from '@/lib/config/legend';
import { ensureDemoSeedData } from '@/lib/data/demoSeed';
import {
  createCampusSchema,
  createDepartmentSchema,
  type BadoDataGateway,
  type BenchmarkReferenceOption,
  type CreateCampusInput,
  type CreateDepartmentInput,
  type SignInInput,
  type UpdateSettingsInput,
  type UploadAssetDocumentInput,
  type UploadAssetPhotoInput,
} from '@/lib/data/gateway';
import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import {
  buildInstitutionalGeoJsonExport,
  type BadoGeoJsonFeatureCollection,
} from '@/lib/gis/geojsonIo';
import {
  computeGeometryLengthM,
  computeVertexChainagesM,
  isLinearGeometry,
  snapPointToLinearRoute,
} from '@/lib/gis/geometry';
import {
  preparePhotoForStorage,
  validateDocumentFile,
} from '@/lib/media/fileValidation';
import {
  assertPermission,
  canAccessCampus,
  roleHasPermission,
} from '@/lib/permissions/rbac';
import { enqueueSyncOperation, recordCacheSync } from '@/lib/sync/syncQueue';
import type {
  AppRole,
  AssetCategory,
  AssetDetailBundle,
  AssetDocumentRecord,
  AssetListFilters,
  AssetListItem,
  AssetPhotoRecord,
  AssetRecord,
  AssetTypeDefinition,
  AssetVerificationEvent,
  AuditAction,
  AuditLogEntry,
  AuthSessionState,
  Campus,
  DashboardSummary,
  DataQuality,
  Department,
  InstitutionSettings,
  LegendEntry,
  SurveyBenchmarkRecord,
  UserInstitutionMembership,
  UtilityDepthObservationRecord,
  UtilityJunctionRecord,
  UtilityRouteVertexRecord,
} from '@/types/domain';

const DEMO_SESSION_STORAGE_KEY = 'bado.demo.activeUserId';

function buildBlobObjectUrl(blob: unknown): string | null {
  if (
    blob instanceof Blob &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    try {
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Local Demonstration Data Gateway (IndexedDB via Dexie.js).
 *
 * Mirrors the exact multi-institution isolation, RBAC rules, verification governance,
 * composite same-institution constraints, soft archival, and append-only audit trail
 * defined in the Phase 1 & Phase 2 Supabase PostgreSQL migrations.
 */
export class LocalDemoDataGateway implements BadoDataGateway {
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
      // Fall back to in-memory tracking if localStorage is blocked.
    }
  }

  private notifyAuthChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async hydrateSessionForUser(
    userId: string,
  ): Promise<AuthSessionState | null> {
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
      const institution = await this.db.institutions.get(
        membership.institutionId,
      );
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
  ): Promise<{
    session: AuthSessionState;
    membership: UserInstitutionMembership;
  }> {
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

  private isAssetVisibleToMember(
    asset: AssetRecord,
    membership: UserInstitutionMembership,
    userId: string,
  ): boolean {
    if (asset.archivedAt !== null) return false;
    if (asset.institutionId !== membership.institutionId) return false;
    if (!canAccessCampus(membership, asset.campusId)) return false;

    // Match RLS policy `assets_select_permitted`: unsubmitted drafts are private to creator + managers
    if (
      asset.verificationStatus === 'draft' &&
      asset.createdBy !== userId &&
      membership.role !== 'admin' &&
      membership.role !== 'supervisor'
    ) {
      return false;
    }

    return true;
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

  // ---------------------------------------------------------------------------
  // Authentication & Phase 1 Institutional Operations
  // ---------------------------------------------------------------------------

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

  async signUp(): Promise<AuthSessionState | null> {
    throw new Error('Account registration is unavailable in demo mode. Connect Supabase to create an account.');
  }

  async signInAsDemoUser(userId: string): Promise<AuthSessionState> {
    const session = await this.hydrateSessionForUser(userId);
    if (!session || session.memberships.length === 0) {
      throw new Error(
        'Selected demonstration account was not found or is inactive.',
      );
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
    await recordCacheSync(
      institutionId,
      null,
      'departments',
      sorted.length,
      this.db,
    );
    return sorted;
  }

  async getInstitutionSettings(
    institutionId: string,
  ): Promise<InstitutionSettings> {
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
    const { session, membership } = await this.requireMembership(institutionId);
    const campuses = await this.listCampuses(institutionId);
    if (campusId && !campuses.some((c) => c.id === campusId)) {
      throw new Error(
        'ACCESS DENIED: Requested campus does not belong to your permitted campuses.',
      );
    }
    const departments = await this.listDepartments(institutionId);

    const allInstAssets = await this.db.assets
      .where('institutionId')
      .equals(institutionId)
      .toArray();

    const scopedAssets = allInstAssets.filter(
      (asset) =>
        this.isAssetVisibleToMember(asset, membership, session.user.id) &&
        (!campusId || asset.campusId === campusId),
    );

    let surfaceAssets = 0;
    let undergroundAssets = 0;
    let linearRoutes = 0;
    let surveyBenchmarks = 0;
    let pendingVerification = 0;

    for (const asset of scopedAssets) {
      if (asset.category === 'surface') surfaceAssets += 1;
      if (asset.category === 'underground') undergroundAssets += 1;
      if (asset.category === 'survey_reference') surveyBenchmarks += 1;
      if (
        asset.geometry.type === 'LineString' ||
        asset.geometry.type === 'MultiLineString'
      ) {
        linearRoutes += 1;
      }
      if (isPendingVerification(asset.verificationStatus)) {
        pendingVerification += 1;
      }
    }

    return {
      institutionId,
      campusId,
      totalAssets: scopedAssets.length,
      surfaceAssets,
      undergroundAssets,
      linearRoutes,
      surveyBenchmarks,
      pendingVerification,
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

    const hasLat =
      typeof input.centerLat === 'number' && !Number.isNaN(input.centerLat);
    const hasLng =
      typeof input.centerLng === 'number' && !Number.isNaN(input.centerLng);
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
      throw new Error('Target membership not found in the active institution.');
    }

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

  // ---------------------------------------------------------------------------
  // Phase 2 — Core Asset Registry, Benchmarks, Media & Verification Workflow
  // ---------------------------------------------------------------------------

  async listAssetTypes(
    institutionId: string,
    category?: AssetCategory,
  ): Promise<AssetTypeDefinition[]> {
    const { membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    const rows = await this.db.assetTypes
      .where('institutionId')
      .equals(institutionId)
      .filter((t) => t.isActive && (!category || t.category === category))
      .toArray();

    const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
    await recordCacheSync(
      institutionId,
      null,
      'asset_types',
      sorted.length,
      this.db,
    );
    return sorted;
  }

  async listBenchmarkReferences(
    institutionId: string,
    campusId?: string | null,
  ): Promise<BenchmarkReferenceOption[]> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    const benchmarks = await this.db.surveyBenchmarks
      .where('institutionId')
      .equals(institutionId)
      .toArray();

    const results: BenchmarkReferenceOption[] = [];
    for (const bm of benchmarks) {
      const asset = await this.db.assets.get(bm.assetId);
      if (!asset) continue;
      if (!this.isAssetVisibleToMember(asset, membership, session.user.id)) {
        continue;
      }
      if (campusId && asset.campusId !== campusId) continue;

      results.push({
        assetId: asset.id,
        campusId: asset.campusId,
        name: asset.name,
        referenceCode: bm.referenceCode,
        elevationM: bm.elevationM,
        verticalDatum: bm.verticalDatum,
      });
    }

    return results.sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
  }

  async listAssets(
    institutionId: string,
    filters: AssetListFilters = {},
  ): Promise<AssetListItem[]> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    if (filters.campusId && !canAccessCampus(membership, filters.campusId)) {
      throw new Error(
        'ACCESS DENIED: Requested campus does not belong to your permitted campuses.',
      );
    }

    const [
      allAssets,
      allTypes,
      allCampuses,
      allDepartments,
      allBenchmarks,
      allPhotos,
      allDocuments,
      allDepthObs,
    ] = await Promise.all([
      this.db.assets.where('institutionId').equals(institutionId).toArray(),
      this.db.assetTypes.where('institutionId').equals(institutionId).toArray(),
      this.db.campuses.where('institutionId').equals(institutionId).toArray(),
      this.db.departments.where('institutionId').equals(institutionId).toArray(),
      this.db.surveyBenchmarks
        .where('institutionId')
        .equals(institutionId)
        .toArray(),
      this.db.assetPhotos.where('institutionId').equals(institutionId).toArray(),
      this.db.assetDocuments
        .where('institutionId')
        .equals(institutionId)
        .toArray(),
      this.db.depthObservations
        .where('institutionId')
        .equals(institutionId)
        .toArray(),
    ]);

    const typeById = new Map(allTypes.map((t) => [t.id, t]));
    const campusById = new Map(allCampuses.map((c) => [c.id, c]));
    const deptById = new Map(allDepartments.map((d) => [d.id, d]));
    const benchmarkByAssetId = new Map(allBenchmarks.map((b) => [b.assetId, b]));

    const depthStatsByAsset = new Map<
      string,
      { count: number; min: number; max: number }
    >();
    for (const obs of allDepthObs) {
      const existing = depthStatsByAsset.get(obs.assetId);
      if (!existing) {
        depthStatsByAsset.set(obs.assetId, {
          count: 1,
          min: obs.depthM,
          max: obs.depthM,
        });
      } else {
        existing.count += 1;
        existing.min = Math.min(existing.min, obs.depthM);
        existing.max = Math.max(existing.max, obs.depthM);
      }
    }

    const photoCountByAsset = new Map<string, number>();
    for (const photo of allPhotos) {
      photoCountByAsset.set(
        photo.assetId,
        (photoCountByAsset.get(photo.assetId) ?? 0) + 1,
      );
    }

    const docCountByAsset = new Map<string, number>();
    for (const doc of allDocuments) {
      docCountByAsset.set(
        doc.assetId,
        (docCountByAsset.get(doc.assetId) ?? 0) + 1,
      );
    }

    const searchNeedle = (filters.search ?? '').trim().toLowerCase();

    const filtered: AssetListItem[] = [];
    for (const asset of allAssets) {
      if (!this.isAssetVisibleToMember(asset, membership, session.user.id)) {
        continue;
      }
      if (filters.campusId && asset.campusId !== filters.campusId) continue;
      if (
        filters.category &&
        filters.category !== 'all' &&
        asset.category !== filters.category
      ) {
        continue;
      }
      if (
        filters.assetTypeId &&
        filters.assetTypeId !== 'all' &&
        asset.assetTypeId !== filters.assetTypeId
      ) {
        continue;
      }
      if (
        filters.utilityGroup &&
        filters.utilityGroup !== 'all' &&
        asset.utilityGroup !== filters.utilityGroup
      ) {
        continue;
      }
      if (
        filters.operationalStatus &&
        filters.operationalStatus !== 'all' &&
        asset.operationalStatus !== filters.operationalStatus
      ) {
        continue;
      }
      if (filters.geometryScope && filters.geometryScope !== 'all') {
        const linear = isLinearGeometry(asset.geometry);
        if (filters.geometryScope === 'linear' && !linear) continue;
        if (filters.geometryScope === 'points' && linear) continue;
      }
      if (filters.verificationStatus && filters.verificationStatus !== 'all') {
        if (filters.verificationStatus === 'pending_review') {
          if (!isPendingVerification(asset.verificationStatus)) continue;
        } else if (asset.verificationStatus !== filters.verificationStatus) {
          continue;
        }
      }

      const assetType = typeById.get(asset.assetTypeId);
      if (!assetType) continue;
      const benchmark = benchmarkByAssetId.get(asset.id) ?? null;
      const campus = campusById.get(asset.campusId) ?? null;
      const department = asset.departmentId
        ? (deptById.get(asset.departmentId) ?? null)
        : null;

      if (searchNeedle) {
        const haystack = [
          asset.assetCode,
          asset.name,
          asset.description ?? '',
          asset.locationReferenceText ?? '',
          asset.material ?? '',
          assetType.name,
          campus?.name ?? '',
          department?.name ?? '',
          benchmark?.referenceCode ?? '',
          benchmark?.monumentType ?? '',
          benchmark?.surveyorName ?? '',
        ]
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(searchNeedle)) continue;
      }

      const depthStat = depthStatsByAsset.get(asset.id);
      const enrichedAsset: AssetRecord =
        asset.routeLengthM === undefined && isLinearGeometry(asset.geometry)
          ? { ...asset, routeLengthM: computeGeometryLengthM(asset.geometry) }
          : asset;

      filtered.push({
        asset: enrichedAsset,
        assetType,
        campus,
        department,
        benchmark,
        photoCount: photoCountByAsset.get(asset.id) ?? 0,
        documentCount: docCountByAsset.get(asset.id) ?? 0,
        depthObservationCount: depthStat?.count ?? 0,
        minDepthM: depthStat?.min ?? null,
        maxDepthM: depthStat?.max ?? null,
      });
    }

    filtered.sort((a, b) => b.asset.updatedAt.localeCompare(a.asset.updatedAt));
    await recordCacheSync(
      institutionId,
      filters.campusId ?? null,
      'assets',
      filtered.length,
      this.db,
    );
    return filtered;
  }

  async getAssetDetail(
    institutionId: string,
    assetId: string,
  ): Promise<AssetDetailBundle> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'infrastructure:view');

    const asset = await this.db.assets.get(assetId);
    if (
      !asset ||
      !this.isAssetVisibleToMember(asset, membership, session.user.id)
    ) {
      throw new Error('Asset record not found or outside your permitted scope.');
    }

    const [
      assetType,
      campus,
      department,
      benchmark,
      registeredByProfile,
      verifiedByProfile,
      rawPhotos,
      rawDocuments,
      observations,
      rawVertices,
      rawDepthObs,
      rawJunctions,
      history,
    ] = await Promise.all([
      this.db.assetTypes.get(asset.assetTypeId),
      this.db.campuses.get(asset.campusId),
      asset.departmentId
        ? this.db.departments.get(asset.departmentId)
        : Promise.resolve(undefined),
      this.db.surveyBenchmarks.get(asset.id),
      asset.createdBy
        ? this.db.profiles.get(asset.createdBy)
        : Promise.resolve(undefined),
      asset.lastVerifiedBy
        ? this.db.profiles.get(asset.lastVerifiedBy)
        : Promise.resolve(undefined),
      this.db.assetPhotos
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
      this.db.assetDocuments
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
      this.db.assetObservations
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
      this.db.routeVertices
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
      this.db.depthObservations
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
      this.db.utilityJunctions
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
      this.db.verificationHistory
        .where('[institutionId+assetId]')
        .equals([institutionId, asset.id])
        .toArray(),
    ]);

    if (!assetType) {
      throw new Error('Associated asset type definition was not found.');
    }

    let referenceBenchmark: AssetDetailBundle['referenceBenchmark'] = null;
    if (asset.referenceBenchmarkId) {
      const [refAsset, refBm] = await Promise.all([
        this.db.assets.get(asset.referenceBenchmarkId),
        this.db.surveyBenchmarks.get(asset.referenceBenchmarkId),
      ]);
      if (refAsset && refBm && refAsset.institutionId === institutionId) {
        referenceBenchmark = {
          assetId: refAsset.id,
          name: refAsset.name,
          referenceCode: refBm.referenceCode,
          elevationM: refBm.elevationM,
          verticalDatum: refBm.verticalDatum,
        };
      }
    }

    const photos: AssetPhotoRecord[] = [];
    for (const photo of rawPhotos.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )) {
      let previewUrl = photo.previewUrl ?? null;
      if (!previewUrl && photo.localBlobId) {
        const blobRec = await this.db.localMediaBlobs.get(photo.localBlobId);
        if (blobRec) {
          previewUrl = buildBlobObjectUrl(blobRec.blob);
        }
      }
      photos.push({ ...photo, previewUrl });
    }

    const documents: AssetDocumentRecord[] = [];
    for (const doc of rawDocuments.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )) {
      let downloadUrl = doc.downloadUrl ?? null;
      if (!downloadUrl && doc.localBlobId) {
        const blobRec = await this.db.localMediaBlobs.get(doc.localBlobId);
        if (blobRec) {
          downloadUrl = buildBlobObjectUrl(blobRec.blob);
        }
      }
      documents.push({ ...doc, downloadUrl });
    }

    const depthObservations: UtilityDepthObservationRecord[] = [];
    for (const obs of rawDepthObs.sort((a, b) =>
      (a.chainageM ?? Number.MAX_SAFE_INTEGER) -
        (b.chainageM ?? Number.MAX_SAFE_INTEGER) ||
      b.observedAt.localeCompare(a.observedAt),
    )) {
      const observerProfile = obs.observedBy
        ? await this.db.profiles.get(obs.observedBy)
        : undefined;
      depthObservations.push({
        ...obs,
        observedByName:
          obs.observedByName ?? observerProfile?.fullName ?? null,
      });
    }

    const minDepthM =
      depthObservations.length > 0
        ? Math.min(...depthObservations.map((o) => o.depthM))
        : null;
    const maxDepthM =
      depthObservations.length > 0
        ? Math.max(...depthObservations.map((o) => o.depthM))
        : null;

    const hydratedAsset: AssetRecord =
      asset.routeLengthM === undefined && isLinearGeometry(asset.geometry)
        ? { ...asset, routeLengthM: computeGeometryLengthM(asset.geometry) }
        : asset;

    return {
      asset: hydratedAsset,
      assetType,
      campus: campus ?? null,
      department: department ?? null,
      benchmark: benchmark ?? null,
      photoCount: photos.length,
      documentCount: documents.length,
      depthObservationCount: depthObservations.length,
      minDepthM,
      maxDepthM,
      registeredByName: registeredByProfile?.fullName ?? null,
      lastVerifiedByName: verifiedByProfile?.fullName ?? null,
      referenceBenchmark,
      photos,
      documents,
      observations: observations.sort((a, b) =>
        b.measuredAt.localeCompare(a.measuredAt),
      ),
      routeVertices: rawVertices.sort(
        (a, b) => a.partIndex - b.partIndex || a.sequenceIndex - b.sequenceIndex,
      ),
      depthObservations,
      junctions: rawJunctions.sort((a, b) =>
        a.recordedAt.localeCompare(b.recordedAt),
      ),
      verificationHistory: history.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    };
  }

  async createAsset(
    institutionId: string,
    rawInput: CreateAssetInput,
  ): Promise<AssetRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'assets:create');

    const input = createAssetInputSchema.parse(rawInput);

    if (input.category === 'survey_reference') {
      assertPermission(membership, institutionId, 'benchmarks:manage');
    }

    // Same-institution campus & access validation
    const campus = await this.db.campuses.get(input.campusId);
    if (!campus || campus.institutionId !== institutionId || !campus.isActive) {
      throw new Error('Selected campus does not belong to the active institution.');
    }
    if (!canAccessCampus(membership, campus.id)) {
      throw new Error(
        'ACCESS DENIED: You are not permitted to register assets on this campus.',
      );
    }

    // Same-institution department validation
    if (input.departmentId) {
      const dept = await this.db.departments.get(input.departmentId);
      if (!dept || dept.institutionId !== institutionId) {
        throw new Error(
          'Selected department does not belong to the active institution.',
        );
      }
    }

    // Same-institution asset type validation + category alignment
    const assetType = await this.db.assetTypes.get(input.assetTypeId);
    if (!assetType || assetType.institutionId !== institutionId) {
      throw new Error(
        'Selected asset type does not belong to the active institution.',
      );
    }
    if (assetType.category !== input.category) {
      throw new Error(
        `Asset type "${assetType.name}" belongs to category "${assetType.category}", not "${input.category}".`,
      );
    }

    // Validate dynamic type-specific fields against assetType.fieldSchema
    const cleanedAttributes = validateDynamicAttributes(
      assetType,
      input.customAttributes,
      input.submissionMode,
    );

    // Idempotent check for offline replay using the same asset UUID
    if (input.id) {
      const existingById = await this.db.assets.get(input.id);
      if (existingById && existingById.institutionId === institutionId) {
        return existingById;
      }
    }

    // Check duplicate asset code within institution
    const duplicateCode = await this.db.assets
      .where('[institutionId+assetCode]')
      .equals([institutionId, input.assetCode])
      .first();
    if (duplicateCode) {
      throw new Error(
        `An asset with ID "${input.assetCode}" already exists in this institution.`,
      );
    }

    // Check duplicate benchmark reference code within institution
    if (input.category === 'survey_reference' && input.benchmark) {
      const duplicateBm = await this.db.surveyBenchmarks
        .where('[institutionId+referenceCode]')
        .equals([institutionId, input.benchmark.referenceCode])
        .first();
      if (duplicateBm) {
        throw new Error(
          `A survey benchmark with Reference ID "${input.benchmark.referenceCode}" already exists in this institution.`,
        );
      }
    }

    // Validate optional benchmark reference belongs to same institution
    if (input.referenceBenchmarkId) {
      const refBm = await this.db.surveyBenchmarks.get(input.referenceBenchmarkId);
      if (!refBm || refBm.institutionId !== institutionId) {
        throw new Error(
          'Selected reference benchmark does not belong to this institution.',
        );
      }
    }

    const now = new Date().toISOString();
    const capturedAt = input.capturedAt ?? now;
    const measuredAt = input.measuredAt ?? capturedAt;
    const isOfflineCapture =
      Boolean(input.saveOffline) ||
      (typeof navigator !== 'undefined' && !navigator.onLine);

    const dataQuality: DataQuality =
      input.submissionMode === 'draft' ? 'incomplete' : 'unverified';

    const asset: AssetRecord = {
      id: input.id ?? crypto.randomUUID(),
      institutionId,
      campusId: input.campusId,
      departmentId: input.departmentId ?? null,
      assetTypeId: assetType.id,
      assetCode: input.assetCode,
      name: input.name,
      category: assetType.category,
      utilityGroup: input.isCriticalHazard
        ? 'critical_hazard'
        : assetType.utilityGroup,
      description: input.description ? input.description : null,
      geometry: {
        type: 'Point',
        coordinates: [input.longitude, input.latitude],
      },
      installationDate: input.installationDate ? input.installationDate : null,
      operationalStatus: input.operationalStatus,
      physicalCondition: input.physicalCondition,
      // New records NEVER auto-verify (Master Spec Section 9)
      verificationStatus: input.submissionMode,
      dataQuality,
      isCriticalHazard: input.isCriticalHazard || assetType.code === 'GAS_LINE',

      material: input.material ? input.material : null,
      diameterMm: input.diameterMm ?? null,
      cableSpecification: input.cableSpecification
        ? input.cableSpecification
        : null,
      recordedDepthM: input.recordedDepthM ?? null,
      depthIsVariable: input.depthIsVariable,
      depthMeasurementMethod: input.depthMeasurementMethod ?? null,
      documentedBeforeCovering: input.documentedBeforeCovering,
      directionDescription: input.directionDescription
        ? input.directionDescription
        : null,
      constructionRecordRef: input.constructionRecordRef
        ? input.constructionRecordRef
        : null,

      customAttributes: cleanedAttributes,
      referenceBenchmarkId: input.referenceBenchmarkId ?? null,
      locationReferenceText: input.locationReferenceText
        ? input.locationReferenceText
        : null,
      notes: input.notes ? input.notes : null,

      positionSource: input.positionSource,
      captureMethod: input.captureMethod,
      receiverModel: input.receiverModel ? input.receiverModel : null,
      horizontalAccuracyM: input.horizontalAccuracyM ?? null,
      verticalAccuracyM: input.verticalAccuracyM ?? null,
      fixQuality: input.fixQuality,
      correctionSource: input.correctionSource ? input.correctionSource : null,
      sourceCrs: input.sourceCrs,
      measuredAt,
      isManuallyAdjusted: input.isManuallyAdjusted,

      capturedAt,
      lastVerifiedAt: null,
      lastVerifiedBy: null,
      version: 1,
      createdBy: session.user.id,
      updatedBy: session.user.id,
      archivedAt: null,
      archivedBy: null,
      createdAt: now,
      updatedAt: now,
      localSyncStatus: isOfflineCapture ? 'pending' : 'synced',
    };

    const benchmarkRecord: SurveyBenchmarkRecord | null =
      input.category === 'survey_reference' && input.benchmark
        ? {
            assetId: asset.id,
            institutionId,
            referenceCode: input.benchmark.referenceCode,
            monumentType: input.benchmark.monumentType,
            elevationM: input.benchmark.elevationM ?? null,
            verticalDatum: input.benchmark.verticalDatum,
            horizontalCrs: input.benchmark.horizontalCrs,
            surveyMethod: input.benchmark.surveyMethod,
            horizontalAccuracyM:
              input.benchmark.horizontalAccuracyM ??
              input.horizontalAccuracyM ??
              null,
            verticalAccuracyM:
              input.benchmark.verticalAccuracyM ?? input.verticalAccuracyM ?? null,
            surveyDate: input.benchmark.surveyDate
              ? input.benchmark.surveyDate
              : null,
            surveyorName: input.benchmark.surveyorName
              ? input.benchmark.surveyorName
              : session.user.fullName,
            createdAt: now,
            updatedAt: now,
          }
        : null;

    const initialVerificationEvent: AssetVerificationEvent = {
      id: crypto.randomUUID(),
      institutionId,
      assetId: asset.id,
      fromStatus: null,
      toStatus: asset.verificationStatus,
      reviewerId: session.user.id,
      reviewerName: session.user.fullName,
      reviewerRole: membership.role,
      remarks:
        asset.verificationStatus === 'submitted'
          ? 'Registered in the field and submitted for supervisor verification.'
          : 'Saved as a field draft pending completion and submission.',
      createdAt: now,
    };

    await this.db.transaction(
      'rw',
      [
        this.db.assets,
        this.db.surveyBenchmarks,
        this.db.verificationHistory,
        this.db.auditLogs,
      ],
      async () => {
        await this.db.assets.add(asset);
        if (benchmarkRecord) {
          await this.db.surveyBenchmarks.add(benchmarkRecord);
        }
        await this.db.verificationHistory.add(initialVerificationEvent);
        await this.writeAuditLog({
          institutionId,
          actorUserId: session.user.id,
          actorName: session.user.fullName,
          actorRole: membership.role,
          action: 'insert',
          entityType: 'assets',
          entityId: asset.id,
          summary: `Registered ${assetType.name} "${asset.name}" (${asset.assetCode}) as ${asset.verificationStatus}.`,
          oldData: null,
          newData: {
            assetCode: asset.assetCode,
            category: asset.category,
            verificationStatus: asset.verificationStatus,
            positionSource: asset.positionSource,
            horizontalAccuracyM: asset.horizontalAccuracyM,
          },
        });
      },
    );

    if (isOfflineCapture) {
      await enqueueSyncOperation(
        {
          institutionId,
          campusId: asset.campusId,
          recordType: 'assets',
          recordId: asset.id,
          operationType: 'create',
          payload: {
            assetCode: asset.assetCode,
            name: asset.name,
            category: asset.category,
            verificationStatus: asset.verificationStatus,
          },
          capturedAt,
        },
        this.db,
      );
    }

    return asset;
  }

  async submitDraftAsset(
    institutionId: string,
    assetId: string,
  ): Promise<AssetRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'assets:edit_own_draft');

    const asset = await this.db.assets.get(assetId);
    if (!asset || asset.institutionId !== institutionId || asset.archivedAt) {
      throw new Error('Asset record not found.');
    }

    const isOwner = asset.createdBy === session.user.id;
    const isManager =
      membership.role === 'admin' || membership.role === 'supervisor';
    if (!isOwner && !isManager) {
      throw new Error(
        'ACCESS DENIED: You can only submit your own draft or rejected asset records.',
      );
    }

    if (
      asset.verificationStatus !== 'draft' &&
      asset.verificationStatus !== 'rejected' &&
      asset.verificationStatus !== 'needs_resurvey'
    ) {
      throw new Error(
        `Asset with status "${asset.verificationStatus}" cannot be re-submitted.`,
      );
    }

    const assetType = await this.db.assetTypes.get(asset.assetTypeId);
    if (assetType) {
      validateDynamicAttributes(assetType, asset.customAttributes, 'submitted');
    }

    const now = new Date().toISOString();
    const updated: AssetRecord = {
      ...asset,
      verificationStatus: 'submitted',
      dataQuality: 'unverified',
      updatedBy: session.user.id,
      version: asset.version + 1,
      updatedAt: now,
    };

    await this.db.assets.put(updated);
    await this.db.verificationHistory.add({
      id: crypto.randomUUID(),
      institutionId,
      assetId: asset.id,
      fromStatus: asset.verificationStatus,
      toStatus: 'submitted',
      reviewerId: session.user.id,
      reviewerName: session.user.fullName,
      reviewerRole: membership.role,
      remarks: 'Submitted asset record for supervisor verification.',
      createdAt: now,
    });

    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'update',
      entityType: 'assets',
      entityId: asset.id,
      summary: `Submitted asset "${asset.name}" (${asset.assetCode}) for review.`,
      oldData: { verificationStatus: asset.verificationStatus },
      newData: { verificationStatus: 'submitted' },
    });

    return updated;
  }

  async reviewAssetVerification(
    institutionId: string,
    rawInput: ReviewVerificationInput,
  ): Promise<AssetRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    const input = reviewVerificationSchema.parse(rawInput);

    // Mirror SQL trigger `enforce_asset_governance()`:
    // - admin & supervisor: under_review, verified, rejected, needs_resurvey
    // - surveyor_gis: spatial review only (under_review, needs_resurvey)
    if (input.toStatus === 'verified' || input.toStatus === 'rejected') {
      assertPermission(membership, institutionId, 'assets:verify');
    } else if (
      input.toStatus === 'under_review' ||
      input.toStatus === 'needs_resurvey'
    ) {
      if (
        membership.role !== 'admin' &&
        membership.role !== 'supervisor' &&
        membership.role !== 'surveyor_gis'
      ) {
        throw new Error(
          'ACCESS DENIED: Only Administrators, Supervisors, and Surveyor/GIS Officers can change review state.',
        );
      }
    } else {
      throw new Error(
        `Invalid verification review target status "${input.toStatus}".`,
      );
    }

    const asset = await this.db.assets.get(input.assetId);
    if (!asset || asset.institutionId !== institutionId || asset.archivedAt) {
      throw new Error('Asset record not found in the active institution.');
    }
    if (!canAccessCampus(membership, asset.campusId)) {
      throw new Error('ACCESS DENIED: Asset belongs to an unpermitted campus.');
    }

    const now = new Date().toISOString();
    const dataQuality: DataQuality =
      input.toStatus === 'verified'
        ? 'verified'
        : input.toStatus === 'needs_resurvey'
          ? 'needs_resurvey'
          : 'unverified';

    const updated: AssetRecord = {
      ...asset,
      verificationStatus: input.toStatus,
      dataQuality,
      lastVerifiedAt:
        input.toStatus === 'verified' ? now : asset.lastVerifiedAt,
      lastVerifiedBy:
        input.toStatus === 'verified' ? session.user.id : asset.lastVerifiedBy,
      updatedBy: session.user.id,
      version: asset.version + 1,
      updatedAt: now,
    };

    const auditAction: AuditAction =
      input.toStatus === 'verified'
        ? 'approve'
        : input.toStatus === 'rejected'
          ? 'reject'
          : 'update';

    await this.db.transaction(
      'rw',
      [this.db.assets, this.db.verificationHistory, this.db.auditLogs],
      async () => {
        await this.db.assets.put(updated);
        await this.db.verificationHistory.add({
          id: crypto.randomUUID(),
          institutionId,
          assetId: asset.id,
          fromStatus: asset.verificationStatus,
          toStatus: input.toStatus,
          reviewerId: session.user.id,
          reviewerName: session.user.fullName,
          reviewerRole: membership.role,
          remarks:
            input.remarks ||
            `Verification status updated from ${asset.verificationStatus} to ${input.toStatus}.`,
          createdAt: now,
        });
        await this.writeAuditLog({
          institutionId,
          actorUserId: session.user.id,
          actorName: session.user.fullName,
          actorRole: membership.role,
          action: auditAction,
          entityType: 'assets',
          entityId: asset.id,
          summary: `Marked asset "${asset.name}" (${asset.assetCode}) as ${input.toStatus}.`,
          oldData: { verificationStatus: asset.verificationStatus },
          newData: {
            verificationStatus: input.toStatus,
            remarks: input.remarks,
          },
        });
      },
    );

    return updated;
  }

  async archiveAsset(
    institutionId: string,
    assetId: string,
    reason: string,
  ): Promise<void> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'assets:archive');

    const cleanReason = reason.trim();
    if (cleanReason.length < 4) {
      throw new Error(
        'Provide an archival reason (at least 4 characters) for the institutional audit log.',
      );
    }

    const asset = await this.db.assets.get(assetId);
    if (!asset || asset.institutionId !== institutionId || asset.archivedAt) {
      throw new Error('Asset record not found or already archived.');
    }

    const now = new Date().toISOString();
    await this.db.assets.put({
      ...asset,
      archivedAt: now,
      archivedBy: session.user.id,
      updatedBy: session.user.id,
      version: asset.version + 1,
      updatedAt: now,
    });

    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'archive',
      entityType: 'assets',
      entityId: asset.id,
      summary: `Archived asset "${asset.name}" (${asset.assetCode}): ${cleanReason}`,
      oldData: { archivedAt: null },
      newData: { archivedAt: now, reason: cleanReason },
    });
  }

  async uploadAssetPhoto(
    institutionId: string,
    input: UploadAssetPhotoInput,
  ): Promise<AssetPhotoRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'assets:create');

    const meta = uploadAssetPhotoMetaSchema.parse({
      assetId: input.assetId,
      photoKind: input.photoKind,
      caption: input.caption,
      capturedAt: input.capturedAt,
    });

    const asset = await this.db.assets.get(meta.assetId);
    if (!asset || asset.institutionId !== institutionId || asset.archivedAt) {
      throw new Error('Target asset not found in the active institution.');
    }

    const prepared = await preparePhotoForStorage(input.file);
    const now = new Date().toISOString();
    const photoId = crypto.randomUUID();
    const blobId = crypto.randomUUID();
    const storagePath = `${institutionId}/${asset.campusId}/${asset.id}/photos/${photoId}_${prepared.fileName}`;

    await this.db.localMediaBlobs.add({
      id: blobId,
      institutionId,
      assetId: asset.id,
      mediaKind: 'photo',
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      blob: prepared.blob,
      createdAt: now,
    });

    const record: AssetPhotoRecord = {
      id: photoId,
      institutionId,
      assetId: asset.id,
      observationId: null,
      storagePath,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      fileSizeBytes: prepared.fileSizeBytes,
      widthPx: prepared.widthPx,
      heightPx: prepared.heightPx,
      photoKind: meta.photoKind,
      caption: meta.caption ? meta.caption : null,
      capturedAt: meta.capturedAt ?? now,
      uploadedBy: session.user.id,
      uploadedByName: session.user.fullName,
      createdAt: now,
      localBlobId: blobId,
    };

    await this.db.assetPhotos.add(record);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'insert',
      entityType: 'asset_photos',
      entityId: photoId,
      summary: `Attached ${meta.photoKind} photograph "${prepared.fileName}" to ${asset.assetCode}.`,
      oldData: null,
      newData: {
        assetCode: asset.assetCode,
        fileName: prepared.fileName,
        fileSizeBytes: prepared.fileSizeBytes,
      },
    });

    const isOffline =
      Boolean(input.saveOffline) ||
      (typeof navigator !== 'undefined' && !navigator.onLine);
    if (isOffline) {
      await enqueueSyncOperation(
        {
          institutionId,
          campusId: asset.campusId,
          recordType: 'asset_photos',
          recordId: photoId,
          operationType: 'upload_photo',
          payload: {
            assetId: asset.id,
            localBlobId: blobId,
            storagePath,
            photoKind: meta.photoKind,
          },
          capturedAt: record.capturedAt,
        },
        this.db,
      );
    }

    return {
      ...record,
      previewUrl: buildBlobObjectUrl(prepared.blob),
    };
  }

  async uploadAssetDocument(
    institutionId: string,
    input: UploadAssetDocumentInput,
  ): Promise<AssetDocumentRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'assets:create');

    const meta = uploadAssetDocumentMetaSchema.parse({
      assetId: input.assetId,
      documentKind: input.documentKind,
      title: input.title,
      description: input.description,
    });

    const asset = await this.db.assets.get(meta.assetId);
    if (!asset || asset.institutionId !== institutionId || asset.archivedAt) {
      throw new Error('Target asset not found in the active institution.');
    }

    const validatedFile = validateDocumentFile(input.file);
    const now = new Date().toISOString();
    const docId = crypto.randomUUID();
    const blobId = crypto.randomUUID();
    const storagePath = `${institutionId}/${asset.campusId}/${asset.id}/docs/${docId}_${validatedFile.fileName}`;

    await this.db.localMediaBlobs.add({
      id: blobId,
      institutionId,
      assetId: asset.id,
      mediaKind: 'document',
      fileName: validatedFile.fileName,
      mimeType: validatedFile.mimeType,
      blob: validatedFile.blob,
      createdAt: now,
    });

    const record: AssetDocumentRecord = {
      id: docId,
      institutionId,
      assetId: asset.id,
      storagePath,
      fileName: validatedFile.fileName,
      mimeType: validatedFile.mimeType,
      fileSizeBytes: validatedFile.fileSizeBytes,
      documentKind: meta.documentKind,
      title: meta.title,
      description: meta.description ? meta.description : null,
      uploadedBy: session.user.id,
      uploadedByName: session.user.fullName,
      createdAt: now,
      localBlobId: blobId,
    };

    await this.db.assetDocuments.add(record);
    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'insert',
      entityType: 'asset_documents',
      entityId: docId,
      summary: `Attached document "${meta.title}" (${validatedFile.fileName}) to ${asset.assetCode}.`,
      oldData: null,
      newData: {
        assetCode: asset.assetCode,
        title: meta.title,
        mimeType: validatedFile.mimeType,
      },
    });

    return {
      ...record,
      downloadUrl: buildBlobObjectUrl(validatedFile.blob),
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 3 — Linear Utility Mapping, Multi-Point Depths & GeoJSON Export
  // ---------------------------------------------------------------------------

  async createLinearRoute(
    institutionId: string,
    rawInput: CreateLinearRouteInput,
  ): Promise<AssetRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'routes:record');

    const input = createLinearRouteInputSchema.parse(rawInput);

    if (input.captureMethod === 'geojson_import') {
      assertPermission(membership, institutionId, 'gis:import');
    }

    const campus = await this.db.campuses.get(input.campusId);
    if (!campus || campus.institutionId !== institutionId || !campus.isActive) {
      throw new Error('Selected campus does not belong to the active institution.');
    }
    if (!canAccessCampus(membership, campus.id)) {
      throw new Error(
        'ACCESS DENIED: You are not permitted to record routes on this campus.',
      );
    }

    if (input.departmentId) {
      const dept = await this.db.departments.get(input.departmentId);
      if (!dept || dept.institutionId !== institutionId) {
        throw new Error(
          'Selected department does not belong to the active institution.',
        );
      }
    }

    const assetType = await this.db.assetTypes.get(input.assetTypeId);
    if (!assetType || assetType.institutionId !== institutionId) {
      throw new Error(
        'Selected asset type does not belong to the active institution.',
      );
    }
    if (
      !assetType.allowedGeomTypes.includes('LineString') &&
      !assetType.allowedGeomTypes.includes('MultiLineString')
    ) {
      throw new Error(
        `Asset type "${assetType.name}" does not support linear route geometries.`,
      );
    }

    if (input.referenceBenchmarkId) {
      const bm = await this.db.surveyBenchmarks.get(input.referenceBenchmarkId);
      if (!bm || bm.institutionId !== institutionId) {
        throw new Error(
          'Referenced survey benchmark does not belong to the active institution.',
        );
      }
    }

    const existingCode = await this.db.assets
      .where('[institutionId+assetCode]')
      .equals([institutionId, input.assetCode])
      .first();
    if (existingCode) {
      throw new Error(
        `An asset or route with ID "${input.assetCode}" already exists in this institution.`,
      );
    }

    // Validate connected assets on junctions belong to the same institution
    for (const jn of input.junctions) {
      if (jn.connectedAssetId) {
        const connected = await this.db.assets.get(jn.connectedAssetId);
        if (!connected || connected.institutionId !== institutionId) {
          throw new Error(
            'Connected junction asset does not belong to the active institution.',
          );
        }
      }
    }

    const cleanedAttributes = validateDynamicAttributes(
      assetType,
      input.customAttributes,
      input.submissionMode,
    );

    const now = new Date().toISOString();
    const capturedAt = input.capturedAt || now;
    const measuredAt = input.measuredAt || capturedAt;
    const assetId = input.id ?? crypto.randomUUID();
    const routeLengthM = computeGeometryLengthM(input.geometry) ?? 0;
    if (routeLengthM <= 0) {
      throw new Error('Linear utility route must have a non-zero length.');
    }

    const verificationStatus = input.submissionMode; // strictly 'draft' | 'submitted'
    const dataQuality: DataQuality =
      verificationStatus === 'draft' ? 'incomplete' : 'unverified';

    // Default recordedDepthM summary from first explicit depth observation when omitted
    const firstDepthObs = input.depthObservations[0];
    const recordedDepthM =
      input.recordedDepthM ?? (firstDepthObs ? firstDepthObs.depthM : null);
    const depthMeasurementMethod =
      input.depthMeasurementMethod ??
      (firstDepthObs ? firstDepthObs.measurementMethod : null);
    const documentedBeforeCovering =
      input.documentedBeforeCovering ||
      input.depthObservations.some((d) => d.documentedBeforeCovering);

    const asset: AssetRecord = {
      id: assetId,
      institutionId,
      campusId: campus.id,
      departmentId: input.departmentId ?? null,
      assetTypeId: assetType.id,
      assetCode: input.assetCode,
      name: input.name,
      category: assetType.category,
      utilityGroup: assetType.utilityGroup,
      description: input.description ? input.description : null,
      geometry: input.geometry,
      routeLengthM,
      installationDate: input.installationDate ? input.installationDate : null,
      operationalStatus: input.operationalStatus,
      physicalCondition: input.physicalCondition,
      verificationStatus,
      dataQuality,
      isCriticalHazard:
        input.isCriticalHazard || assetType.utilityGroup === 'critical_hazard',
      material: input.material ? input.material : null,
      diameterMm: input.diameterMm ?? null,
      cableSpecification: input.cableSpecification
        ? input.cableSpecification
        : null,
      recordedDepthM,
      depthIsVariable: input.depthIsVariable,
      depthMeasurementMethod,
      documentedBeforeCovering,
      directionDescription: input.directionDescription
        ? input.directionDescription
        : null,
      constructionRecordRef: input.constructionRecordRef
        ? input.constructionRecordRef
        : null,
      customAttributes: cleanedAttributes,
      referenceBenchmarkId: input.referenceBenchmarkId ?? null,
      locationReferenceText: input.locationReferenceText
        ? input.locationReferenceText
        : null,
      notes: input.notes ? input.notes : null,
      positionSource: input.positionSource,
      captureMethod: input.captureMethod,
      receiverModel: input.receiverModel ? input.receiverModel : null,
      horizontalAccuracyM: input.horizontalAccuracyM ?? null,
      verticalAccuracyM: input.verticalAccuracyM ?? null,
      fixQuality: input.fixQuality,
      correctionSource: input.correctionSource ? input.correctionSource : null,
      sourceCrs: input.sourceCrs,
      measuredAt,
      isManuallyAdjusted: input.isManuallyAdjusted,
      capturedAt,
      lastVerifiedAt: null,
      lastVerifiedBy: null,
      version: 1,
      createdBy: session.user.id,
      updatedBy: session.user.id,
      archivedAt: null,
      archivedBy: null,
      createdAt: now,
      updatedAt: now,
      localSyncStatus: input.saveOffline ? 'pending' : 'synced',
    };

    // Build ordered vertex records (either explicit vertices or derived from geometry)
    const vertexRecords = this.buildVertexRecords(
      institutionId,
      assetId,
      input.geometry,
      input.vertices,
      session.user.id,
      capturedAt,
      now,
    );

    const depthRecords: UtilityDepthObservationRecord[] =
      input.depthObservations.map((obs) => {
        const snap = snapPointToLinearRoute(input.geometry, {
          lat: obs.latitude,
          lng: obs.longitude,
        });
        return {
          id: crypto.randomUUID(),
          institutionId,
          assetId,
          location: { lat: obs.latitude, lng: obs.longitude },
          depthM: obs.depthM,
          measurementMethod: obs.measurementMethod,
          documentedBeforeCovering: obs.documentedBeforeCovering ?? false,
          chainageM: obs.chainageM ?? snap.chainageM,
          horizontalAccuracyM: obs.horizontalAccuracyM ?? null,
          notes: obs.notes ? obs.notes : null,
          observedAt: obs.observedAt || capturedAt,
          observedBy: session.user.id,
          observedByName: session.user.fullName,
          createdAt: now,
        };
      });

    const junctionRecords: UtilityJunctionRecord[] = input.junctions.map(
      (jn) => ({
        id: crypto.randomUUID(),
        institutionId,
        assetId,
        connectedAssetId: jn.connectedAssetId ?? null,
        junctionKind: jn.junctionKind ?? 'tee',
        label: jn.label ? jn.label : null,
        location: { lat: jn.latitude, lng: jn.longitude },
        depthM: jn.depthM ?? null,
        depthMeasurementMethod: jn.depthMeasurementMethod ?? null,
        notes: jn.notes ? jn.notes : null,
        recordedAt: jn.recordedAt || capturedAt,
        createdBy: session.user.id,
        createdAt: now,
      }),
    );

    const initialEvent: AssetVerificationEvent = {
      id: crypto.randomUUID(),
      institutionId,
      assetId,
      fromStatus: null,
      toStatus: verificationStatus,
      reviewerId: session.user.id,
      reviewerName: session.user.fullName,
      reviewerRole: membership.role,
      remarks:
        verificationStatus === 'draft'
          ? `Saved linear route draft (${routeLengthM.toFixed(1)} m, ${vertexRecords.length} vertices).`
          : `Submitted linear utility route (${routeLengthM.toFixed(1)} m, ${vertexRecords.length} vertices) via ${input.captureMethod}.`,
      createdAt: now,
    };

    await this.db.transaction(
      'rw',
      [
        this.db.assets,
        this.db.routeVertices,
        this.db.depthObservations,
        this.db.utilityJunctions,
        this.db.verificationHistory,
      ],
      async () => {
        await this.db.assets.add(asset);
        if (vertexRecords.length > 0) {
          await this.db.routeVertices.bulkAdd(vertexRecords);
        }
        if (depthRecords.length > 0) {
          await this.db.depthObservations.bulkAdd(depthRecords);
        }
        if (junctionRecords.length > 0) {
          await this.db.utilityJunctions.bulkAdd(junctionRecords);
        }
        await this.db.verificationHistory.add(initialEvent);
      },
    );

    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: input.captureMethod === 'geojson_import' ? 'import' : 'insert',
      entityType: 'assets',
      entityId: assetId,
      summary: `Mapped linear utility route ${asset.assetCode} ("${asset.name}", ${routeLengthM.toFixed(1)} m, ${depthRecords.length} depth observation(s)).`,
      oldData: null,
      newData: {
        assetCode: asset.assetCode,
        captureMethod: asset.captureMethod,
        routeLengthM,
        vertexCount: vertexRecords.length,
        depthObservations: depthRecords.length,
        junctions: junctionRecords.length,
      },
    });

    if (input.saveOffline) {
      await enqueueSyncOperation(
        {
          institutionId,
          campusId: campus.id,
          recordType: 'linear_routes',
          recordId: assetId,
          operationType: 'create',
          payload: {
            asset,
            vertices: vertexRecords,
            depthObservations: depthRecords,
            junctions: junctionRecords,
          },
          baseVersion: 1,
          capturedAt,
        },
        this.db,
      );
    }

    return asset;
  }

  async updateRouteGeometry(
    institutionId: string,
    rawInput: UpdateRouteGeometryInput,
  ): Promise<AssetRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    const input = updateRouteGeometryInputSchema.parse(rawInput);

    const existing = await this.db.assets.get(input.assetId);
    if (!existing || existing.institutionId !== institutionId || existing.archivedAt) {
      throw new Error('Target route was not found in the active institution.');
    }
    if (!canAccessCampus(membership, existing.campusId)) {
      throw new Error(
        'ACCESS DENIED: You are not permitted to edit routes on this campus.',
      );
    }

    const canEditAnyGeometry = roleHasPermission(
      membership.role,
      'routes:edit_geometry',
    );
    const canEditOwnUnverified =
      roleHasPermission(membership.role, 'assets:edit_own_draft') &&
      existing.createdBy === session.user.id &&
      (existing.verificationStatus === 'draft' ||
        existing.verificationStatus === 'rejected' ||
        existing.verificationStatus === 'needs_resurvey');

    if (!canEditAnyGeometry && !canEditOwnUnverified) {
      throw new Error(
        'ACCESS DENIED: Your role is not authorised to modify this route geometry.',
      );
    }

    const routeLengthM = computeGeometryLengthM(input.geometry) ?? 0;
    if (routeLengthM <= 0) {
      throw new Error('Updated route geometry must have a non-zero length.');
    }

    const now = new Date().toISOString();
    const updated: AssetRecord = {
      ...existing,
      geometry: input.geometry,
      routeLengthM,
      captureMethod: input.captureMethod ?? existing.captureMethod,
      positionSource: input.positionSource ?? existing.positionSource,
      horizontalAccuracyM:
        input.horizontalAccuracyM !== undefined
          ? input.horizontalAccuracyM
          : existing.horizontalAccuracyM,
      isManuallyAdjusted: input.isManuallyAdjusted,
      measuredAt: now,
      version: existing.version + 1,
      updatedBy: session.user.id,
      updatedAt: now,
      localSyncStatus: input.saveOffline ? 'pending' : existing.localSyncStatus,
    };

    const vertexRecords = this.buildVertexRecords(
      institutionId,
      existing.id,
      input.geometry,
      input.vertices,
      session.user.id,
      now,
      now,
    );

    await this.db.transaction(
      'rw',
      [this.db.assets, this.db.routeVertices, this.db.utilityJunctions],
      async () => {
        await this.db.assets.put(updated);
        await this.db.routeVertices
          .where('[institutionId+assetId]')
          .equals([institutionId, existing.id])
          .delete();
        if (vertexRecords.length > 0) {
          await this.db.routeVertices.bulkAdd(vertexRecords);
        }
        if (input.junctions !== undefined) {
          await this.db.utilityJunctions
            .where('[institutionId+assetId]')
            .equals([institutionId, existing.id])
            .delete();
          const newJunctions: UtilityJunctionRecord[] = input.junctions.map(
            (jn) => ({
              id: crypto.randomUUID(),
              institutionId,
              assetId: existing.id,
              connectedAssetId: jn.connectedAssetId ?? null,
              junctionKind: jn.junctionKind ?? 'tee',
              label: jn.label ? jn.label : null,
              location: { lat: jn.latitude, lng: jn.longitude },
              depthM: jn.depthM ?? null,
              depthMeasurementMethod: jn.depthMeasurementMethod ?? null,
              notes: jn.notes ? jn.notes : null,
              recordedAt: jn.recordedAt || now,
              createdBy: session.user.id,
              createdAt: now,
            }),
          );
          if (newJunctions.length > 0) {
            await this.db.utilityJunctions.bulkAdd(newJunctions);
          }
        }
      },
    );

    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'update',
      entityType: 'assets',
      entityId: existing.id,
      summary: `Updated spatial route geometry for ${existing.assetCode} (${existing.routeLengthM ?? 0} m → ${routeLengthM.toFixed(1)} m, ${vertexRecords.length} vertices).`,
      oldData: {
        routeLengthM: existing.routeLengthM ?? null,
        version: existing.version,
      },
      newData: {
        routeLengthM,
        vertexCount: vertexRecords.length,
        version: updated.version,
        editNotes: input.editNotes ?? null,
      },
    });

    if (input.saveOffline) {
      await enqueueSyncOperation(
        {
          institutionId,
          campusId: existing.campusId,
          recordType: 'linear_routes',
          recordId: existing.id,
          operationType: 'update',
          payload: {
            geometry: input.geometry,
            vertices: vertexRecords,
            editNotes: input.editNotes ?? null,
          },
          baseVersion: existing.version,
          capturedAt: now,
        },
        this.db,
      );
    }

    return updated;
  }

  async addDepthObservation(
    institutionId: string,
    rawInput: AddDepthObservationInput,
  ): Promise<UtilityDepthObservationRecord> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'assets:create');

    const input = addDepthObservationInputSchema.parse(rawInput);

    const asset = await this.db.assets.get(input.assetId);
    if (!asset || asset.institutionId !== institutionId || asset.archivedAt) {
      throw new Error('Target asset not found in the active institution.');
    }
    if (!canAccessCampus(membership, asset.campusId)) {
      throw new Error(
        'ACCESS DENIED: You are not permitted to record depth observations on this campus.',
      );
    }

    let chainageM = input.chainageM ?? null;
    if (chainageM === null && isLinearGeometry(asset.geometry)) {
      chainageM = snapPointToLinearRoute(asset.geometry, {
        lat: input.latitude,
        lng: input.longitude,
      }).chainageM;
    }

    const now = new Date().toISOString();
    const observedAt = input.observedAt || now;
    const record: UtilityDepthObservationRecord = {
      id: crypto.randomUUID(),
      institutionId,
      assetId: asset.id,
      location: { lat: input.latitude, lng: input.longitude },
      depthM: input.depthM,
      measurementMethod: input.measurementMethod,
      documentedBeforeCovering: input.documentedBeforeCovering,
      chainageM,
      horizontalAccuracyM: input.horizontalAccuracyM ?? null,
      notes: input.notes ? input.notes : null,
      observedAt,
      observedBy: session.user.id,
      observedByName: session.user.fullName,
      createdAt: now,
    };

    await this.db.depthObservations.add(record);

    // If the parent asset had no nominal depth yet, populate it and mark variable
    if (asset.recordedDepthM === null) {
      await this.db.assets.update(asset.id, {
        recordedDepthM: record.depthM,
        depthMeasurementMethod: record.measurementMethod,
        depthIsVariable: true,
        updatedAt: now,
      });
    } else if (asset.recordedDepthM !== record.depthM && !asset.depthIsVariable) {
      await this.db.assets.update(asset.id, {
        depthIsVariable: true,
        updatedAt: now,
      });
    }

    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'insert',
      entityType: 'utility_depth_observations',
      entityId: record.id,
      summary: `Recorded ${record.depthM.toFixed(2)} m burial depth observation (${record.measurementMethod}) on ${asset.assetCode}.`,
      oldData: null,
      newData: {
        assetCode: asset.assetCode,
        depthM: record.depthM,
        measurementMethod: record.measurementMethod,
        chainageM: record.chainageM,
      },
    });

    if (input.saveOffline) {
      await enqueueSyncOperation(
        {
          institutionId,
          campusId: asset.campusId,
          recordType: 'utility_depth_observations',
          recordId: record.id,
          operationType: 'create',
          payload: { ...record },
          baseVersion: 1,
          capturedAt: observedAt,
        },
        this.db,
      );
    }

    return record;
  }

  async exportAssetsGeoJson(
    institutionId: string,
    filters: AssetListFilters = {},
  ): Promise<BadoGeoJsonFeatureCollection> {
    const { session, membership } = await this.requireMembership(institutionId);
    assertPermission(membership, institutionId, 'gis:export');

    const [institution, campus, items] = await Promise.all([
      this.db.institutions.get(institutionId),
      filters.campusId
        ? this.db.campuses.get(filters.campusId)
        : Promise.resolve(undefined),
      this.listAssets(institutionId, filters),
    ]);

    const collection = buildInstitutionalGeoJsonExport(items, {
      institutionName: institution?.name ?? 'Institution',
      isDemoInstitution: institution?.isDemo ?? true,
      campusName: campus?.name ?? null,
    });

    await this.writeAuditLog({
      institutionId,
      actorUserId: session.user.id,
      actorName: session.user.fullName,
      actorRole: membership.role,
      action: 'export',
      entityType: 'assets',
      entityId: institutionId,
      summary: `Exported ${collection.features.length} spatial feature(s) as EPSG:4326 GeoJSON.`,
      oldData: null,
      newData: {
        featureCount: collection.features.length,
        campusId: filters.campusId ?? 'all',
        category: filters.category ?? 'all',
      },
    });

    return collection;
  }

  private buildVertexRecords(
    institutionId: string,
    assetId: string,
    geometry: CreateLinearRouteInput['geometry'],
    explicitVertices: NonNullable<CreateLinearRouteInput['vertices']>,
    userId: string,
    defaultRecordedAt: string,
    createdAt: string,
  ): UtilityRouteVertexRecord[] {
    if (explicitVertices.length >= 2) {
      const coords = explicitVertices.map((v) => ({
        lat: v.latitude,
        lng: v.longitude,
      }));
      const chainages = computeVertexChainagesM(coords);
      return explicitVertices.map((v, idx) => ({
        id: crypto.randomUUID(),
        institutionId,
        assetId,
        partIndex: v.partIndex ?? 0,
        sequenceIndex: v.sequenceIndex,
        vertexKind: v.vertexKind ?? 'track_point',
        location: { lat: v.latitude, lng: v.longitude },
        chainageM: v.chainageM ?? chainages[idx] ?? null,
        horizontalAccuracyM: v.horizontalAccuracyM ?? null,
        verticalAccuracyM: v.verticalAccuracyM ?? null,
        fixQuality: v.fixQuality ?? 'unknown',
        notes: v.notes ? v.notes : null,
        recordedAt: v.recordedAt || defaultRecordedAt,
        createdBy: userId,
        createdAt,
      }));
    }

    const parts =
      geometry.type === 'LineString'
        ? [geometry.coordinates]
        : geometry.coordinates;

    const records: UtilityRouteVertexRecord[] = [];
    parts.forEach((part, partIdx) => {
      const partCoords = part.map(([lng, lat]) => ({ lat, lng }));
      const chainages = computeVertexChainagesM(partCoords);
      part.forEach(([lng, lat], seqIdx) => {
        records.push({
          id: crypto.randomUUID(),
          institutionId,
          assetId,
          partIndex: partIdx,
          sequenceIndex: seqIdx,
          vertexKind:
            seqIdx === 0
              ? 'start_point'
              : seqIdx === part.length - 1
                ? 'end_point'
                : 'track_point',
          location: { lat, lng },
          chainageM: chainages[seqIdx] ?? null,
          horizontalAccuracyM: null,
          verticalAccuracyM: null,
          fixQuality: 'unknown',
          notes: null,
          recordedAt: defaultRecordedAt,
          createdBy: userId,
          createdAt,
        });
      });
    });
    return records;
  }
}
