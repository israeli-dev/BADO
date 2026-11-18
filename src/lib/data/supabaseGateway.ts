import { z } from 'zod';
import {
  DEFAULT_LEGEND_CONFIG,
  institutionThresholdsSchema,
  legendEntrySchema,
} from '@/lib/config/legend';
import {
  createCampusSchema,
  createDepartmentSchema,
  signInSchema,
  type CreateCampusInput,
  type CreateDepartmentInput,
  type FoundationDataGateway,
  type SignInInput,
  type UpdateSettingsInput,
} from '@/lib/data/gateway';
import { badoDb } from '@/lib/db/badoDb';
import { getSupabaseClient } from '@/lib/supabase/client';
import { recordCacheSync } from '@/lib/sync/syncQueue';
import type { Database } from '@/types/database';
import type {
  AppRole,
  AuditLogEntry,
  AuthSessionState,
  Campus,
  DashboardSummary,
  Department,
  GeoCoordinates,
  Institution,
  InstitutionSettings,
  LegendEntry,
  UserInstitutionMembership,
  UserProfile,
} from '@/types/domain';

type InstitutionRow = Database['public']['Tables']['institutions']['Row'];
type CampusRow = Database['public']['Tables']['campuses']['Row'];
type DepartmentRow = Database['public']['Tables']['departments']['Row'];
type SettingsRow = Database['public']['Tables']['institution_settings']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type MembershipRow = Database['public']['Tables']['user_institutions']['Row'];
type AuditRow = Database['public']['Tables']['audit_logs']['Row'];

function parsePointGeometry(raw: unknown): GeoCoordinates | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { type?: unknown; coordinates?: unknown };
  if (
    candidate.type === 'Point' &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length >= 2 &&
    typeof candidate.coordinates[0] === 'number' &&
    typeof candidate.coordinates[1] === 'number'
  ) {
    return { lng: candidate.coordinates[0], lat: candidate.coordinates[1] };
  }
  return null;
}

function mapInstitution(row: InstitutionRow): Institution {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortCode: row.short_code,
    countryCode: row.country_code,
    isDemo: row.is_demo,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCampus(row: CampusRow): Campus {
  return {
    id: row.id,
    institutionId: row.institution_id,
    name: row.name,
    code: row.code,
    description: row.description,
    isDemo: row.is_demo,
    center: parsePointGeometry(row.center_geom),
    defaultZoom: row.default_zoom,
    isActive: row.is_active,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    institutionId: row.institution_id,
    name: row.name,
    code: row.code,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSettings(row: SettingsRow): InstitutionSettings {
  return {
    institutionId: row.institution_id,
    defaultDigBufferM: Number(row.default_dig_buffer_m),
    liveNearbyM: Number(row.live_nearby_m),
    liveApproachingM: Number(row.live_approaching_m),
    liveCloseM: Number(row.live_close_m),
    requireVerificationApproval: row.require_verification_approval,
    allowPublicPassports: row.allow_public_passports,
    legendConfig: Array.isArray(row.legend_config)
      ? row.legend_config
      : DEFAULT_LEGEND_CONFIG,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    jobTitle: row.job_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(row: MembershipRow): UserInstitutionMembership {
  return {
    id: row.id,
    userId: row.user_id,
    institutionId: row.institution_id,
    departmentId: row.department_id,
    role: row.role,
    allowedCampusIds: row.allowed_campus_ids,
    isActive: row.is_active,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    institutionId: row.institution_id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    oldData: row.old_data,
    newData: row.new_data,
    createdAt: row.created_at,
  };
}

/**
 * Production Supabase Data Gateway.
 * All permissions and institution boundaries are enforced server-side by
 * PostgreSQL Row Level Security (RLS); successful reads are cached into Dexie
 * with cache-age timestamps so offline sessions have fresh reference data.
 */
export class SupabaseDataGateway implements FoundationDataGateway {
  readonly mode = 'supabase' as const;

  async getSession(): Promise<AuthSessionState | null> {
    const supabase = getSupabaseClient();
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) throw new Error(sessionError.message);
    if (!session?.user) return null;

    const userId = session.user.id;

    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) throw new Error(profileError.message);

    const { data: membershipRows, error: memError } = await supabase
      .from('user_institutions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (memError) throw new Error(memError.message);

    const institutionIds = (membershipRows ?? []).map((m) => m.institution_id);
    const institutionsById = new Map<string, Institution>();

    if (institutionIds.length > 0) {
      const { data: instRows, error: instError } = await supabase
        .from('institutions')
        .select('*')
        .in('id', institutionIds);

      if (instError) throw new Error(instError.message);
      for (const instRow of instRows ?? []) {
        const mapped = mapInstitution(instRow);
        institutionsById.set(mapped.id, mapped);
      }
      await badoDb.institutions.bulkPut([...institutionsById.values()]);
    }

    const user = mapProfile(profileRow);
    const memberships = (membershipRows ?? [])
      .map((row) => ({
        ...mapMembership(row),
        institution: institutionsById.get(row.institution_id),
        profile: user,
      }))
      .filter((m) => Boolean(m.institution));

    return {
      user,
      memberships,
      mode: 'supabase',
    };
  }

  async signInWithPassword(rawInput: SignInInput): Promise<AuthSessionState> {
    const input = signInSchema.parse(rawInput);
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) throw new Error(error.message);

    const session = await this.getSession();
    if (!session) {
      throw new Error('Signed in, but failed to load institutional user profile.');
    }
    return session;
  }

  async signInAsDemoUser(_userId: string): Promise<AuthSessionState> {
    throw new Error(
      'Quick demo persona switching is disabled while connected to a live Supabase project. Sign in with an authorised institutional account.',
    );
  }

  async signOut(): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  onAuthStateChange(listener: () => void): () => void {
    const supabase = getSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      listener();
    });
    return () => subscription.unsubscribe();
  }

  async listCampuses(institutionId: string): Promise<Campus[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('campuses')
      .select('*')
      .eq('institution_id', institutionId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      // Offline fallback to locally cached campuses for this exact institution
      if (!navigator.onLine) {
        return badoDb.campuses
          .where('institutionId')
          .equals(institutionId)
          .filter((c) => c.isActive)
          .toArray();
      }
      throw new Error(error.message);
    }

    const mapped = (data ?? []).map(mapCampus);
    await badoDb.campuses.bulkPut(mapped);
    await recordCacheSync(institutionId, null, 'campuses', mapped.length);
    return mapped;
  }

  async listDepartments(institutionId: string): Promise<Department[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('institution_id', institutionId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      if (!navigator.onLine) {
        return badoDb.departments
          .where('institutionId')
          .equals(institutionId)
          .filter((d) => d.isActive)
          .toArray();
      }
      throw new Error(error.message);
    }

    const mapped = (data ?? []).map(mapDepartment);
    await badoDb.departments.bulkPut(mapped);
    await recordCacheSync(institutionId, null, 'departments', mapped.length);
    return mapped;
  }

  async getInstitutionSettings(institutionId: string): Promise<InstitutionSettings> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('institution_settings')
      .select('*')
      .eq('institution_id', institutionId)
      .single();

    if (error) {
      if (!navigator.onLine) {
        const cached = await badoDb.institutionSettings.get(institutionId);
        if (cached) return cached;
      }
      throw new Error(error.message);
    }

    const mapped = mapSettings(data);
    await badoDb.institutionSettings.put(mapped);
    return mapped;
  }

  async listInstitutionMembers(
    institutionId: string,
  ): Promise<UserInstitutionMembership[]> {
    const supabase = getSupabaseClient();
    const { data: rows, error } = await supabase
      .from('user_institutions')
      .select('*')
      .eq('institution_id', institutionId);

    if (error) throw new Error(error.message);

    const userIds = (rows ?? []).map((r) => r.user_id);
    const profilesById = new Map<string, UserProfile>();
    if (userIds.length > 0) {
      const { data: profileRows, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);
      if (pErr) throw new Error(pErr.message);
      for (const p of profileRows ?? []) {
        profilesById.set(p.id, mapProfile(p));
      }
    }

    const departments = await this.listDepartments(institutionId);
    const deptById = new Map(departments.map((d) => [d.id, d]));

    return (rows ?? []).map((row) => ({
      ...mapMembership(row),
      profile: profilesById.get(row.user_id),
      department: row.department_id ? (deptById.get(row.department_id) ?? null) : null,
    }));
  }

  async listAuditLogs(institutionId: string, limit = 50): Promise<AuditLogEntry[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []).map(mapAudit);
  }

  async getDashboardSummary(
    institutionId: string,
    campusId: string | null,
  ): Promise<DashboardSummary> {
    const [campuses, departments] = await Promise.all([
      this.listCampuses(institutionId),
      this.listDepartments(institutionId),
    ]);

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
    const input = createCampusSchema.parse(rawInput);
    const hasLat = typeof input.centerLat === 'number' && !Number.isNaN(input.centerLat);
    const hasLng = typeof input.centerLng === 'number' && !Number.isNaN(input.centerLng);
    if (hasLat !== hasLng) {
      throw new Error(
        'Provide both latitude and longitude for campus centre coordinates, or leave both blank.',
      );
    }

    const centerEwkt =
      hasLat && hasLng
        ? `SRID=4326;POINT(${input.centerLng} ${input.centerLat})`
        : null;

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('campuses')
      .insert({
        institution_id: institutionId,
        name: input.name,
        code: input.code,
        description: input.description ? input.description : null,
        center_geom: centerEwkt,
        default_zoom: input.defaultZoom,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const mapped = mapCampus(data);
    await badoDb.campuses.put(mapped);
    return mapped;
  }

  async createDepartment(
    institutionId: string,
    rawInput: CreateDepartmentInput,
  ): Promise<Department> {
    const input = createDepartmentSchema.parse(rawInput);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('departments')
      .insert({
        institution_id: institutionId,
        name: input.name,
        code: input.code,
        description: input.description ? input.description : null,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const mapped = mapDepartment(data);
    await badoDb.departments.put(mapped);
    return mapped;
  }

  async updateInstitutionThresholds(
    institutionId: string,
    rawInput: Omit<UpdateSettingsInput, 'legendConfig'>,
  ): Promise<InstitutionSettings> {
    const validated = institutionThresholdsSchema.parse(rawInput);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('institution_settings')
      .update({
        default_dig_buffer_m: validated.defaultDigBufferM,
        live_nearby_m: validated.liveNearbyM,
        live_approaching_m: validated.liveApproachingM,
        live_close_m: validated.liveCloseM,
        require_verification_approval: validated.requireVerificationApproval,
        allow_public_passports: validated.allowPublicPassports,
      })
      .eq('institution_id', institutionId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const mapped = mapSettings(data);
    await badoDb.institutionSettings.put(mapped);
    return mapped;
  }

  async updateLegendConfig(
    institutionId: string,
    rawLegend: LegendEntry[],
  ): Promise<InstitutionSettings> {
    const legend = z.array(legendEntrySchema).min(1).parse(rawLegend);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('institution_settings')
      .update({ legend_config: legend })
      .eq('institution_id', institutionId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const mapped = mapSettings(data);
    await badoDb.institutionSettings.put(mapped);
    return mapped;
  }

  async updateMemberRole(
    institutionId: string,
    membershipId: string,
    role: AppRole,
    isActive: boolean,
  ): Promise<UserInstitutionMembership> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('user_institutions')
      .update({ role, is_active: isActive })
      .eq('id', membershipId)
      .eq('institution_id', institutionId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return mapMembership(data);
  }
}
