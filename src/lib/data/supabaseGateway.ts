import { cacheAndMergeServerAssets } from '@/lib/sync/assetCache';
import type { Geometry } from 'geojson';
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
  DEFAULT_LEGEND_CONFIG,
  institutionThresholdsSchema,
  legendEntrySchema,
} from '@/lib/config/legend';
import {
  createCampusSchema,
  createDepartmentSchema,
  signInSchema,
  type BadoDataGateway,
  type BenchmarkReferenceOption,
  type CreateCampusInput,
  type CreateDepartmentInput,
  type SignInInput,
  type UpdateSettingsInput,
  type UploadAssetDocumentInput,
  type UploadAssetPhotoInput,
} from '@/lib/data/gateway';
import { badoDb } from '@/lib/db/badoDb';
import {
  buildInstitutionalGeoJsonExport,
  type BadoGeoJsonFeatureCollection,
} from '@/lib/gis/geojsonIo';
import {
  computeGeometryLengthM,
  computeVertexChainagesM,
  geometryToEwkt,
  isLinearGeometry,
  snapPointToLinearRoute,
} from '@/lib/gis/geometry';
import {
  preparePhotoForStorage,
  validateDocumentFile,
} from '@/lib/media/fileValidation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { enqueueSyncOperation, recordCacheSync } from '@/lib/sync/syncQueue';
import type { Database } from '@/types/database';
import type {
  AppRole,
  AssetCategory,
  AssetDetailBundle,
  AssetDocumentRecord,
  AssetListFilters,
  AssetListItem,
  AssetObservationRecord,
  AssetPhotoRecord,
  AssetRecord,
  AssetTypeDefinition,
  AssetVerificationEvent,
  AuditLogEntry,
  AuthSessionState,
  Campus,
  DashboardSummary,
  Department,
  GeoCoordinates,
  Institution,
  InstitutionSettings,
  LegendEntry,
  SurveyBenchmarkRecord,
  UserInstitutionMembership,
  UserProfile,
  UtilityDepthObservationRecord,
  UtilityJunctionRecord,
  UtilityRouteVertexRecord,
} from '@/types/domain';

type InstitutionRow = Database['public']['Tables']['institutions']['Row'];
type CampusRow = Database['public']['Tables']['campuses']['Row'];
type DepartmentRow = Database['public']['Tables']['departments']['Row'];
type SettingsRow = Database['public']['Tables']['institution_settings']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type MembershipRow = Database['public']['Tables']['user_institutions']['Row'];
type AuditRow = Database['public']['Tables']['audit_logs']['Row'];
type AssetTypeRow = Database['public']['Tables']['asset_types']['Row'];
type AssetRow = Database['public']['Tables']['assets']['Row'];
type BenchmarkRow = Database['public']['Tables']['survey_benchmarks']['Row'];
type PhotoRow = Database['public']['Tables']['asset_photos']['Row'];
type DocumentRow = Database['public']['Tables']['asset_documents']['Row'];
type ObservationRow = Database['public']['Tables']['asset_observations']['Row'];
type HistoryRow =
  Database['public']['Tables']['asset_verification_history']['Row'];
type RouteVertexRow =
  Database['public']['Tables']['utility_route_vertices']['Row'];
type DepthObsRow =
  Database['public']['Tables']['utility_depth_observations']['Row'];
type JunctionRow = Database['public']['Tables']['utility_junctions']['Row'];

function parseGeometry(raw: unknown): Geometry {
  if (raw && typeof raw === 'object' && 'type' in raw && 'coordinates' in raw) {
    return raw as Geometry;
  }
  return { type: 'Point', coordinates: [0, 0] };
}

function parsePointGeometry(raw: unknown): GeoCoordinates | null {
  const geom = raw && typeof raw === 'object' ? (raw as { type?: unknown; coordinates?: unknown }) : null;
  if (
    geom &&
    geom.type === 'Point' &&
    Array.isArray(geom.coordinates) &&
    geom.coordinates.length >= 2 &&
    typeof geom.coordinates[0] === 'number' &&
    typeof geom.coordinates[1] === 'number'
  ) {
    return { lng: geom.coordinates[0], lat: geom.coordinates[1] };
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

function mapAssetType(row: AssetTypeRow): AssetTypeDefinition {
  return {
    id: row.id,
    institutionId: row.institution_id,
    category: row.category,
    utilityGroup: row.utility_group,
    code: row.code,
    name: row.name,
    description: row.description,
    defaultCodePrefix: row.default_code_prefix,
    allowedGeomTypes: row.allowed_geom_types,
    colorHex: row.color_hex,
    iconKey: row.icon_key,
    lineStyle: row.line_style,
    fieldSchema: Array.isArray(row.field_schema) ? row.field_schema : [],
    supportsPassport: row.supports_passport,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    campusId: row.campus_id,
    departmentId: row.department_id,
    assetTypeId: row.asset_type_id,
    assetCode: row.asset_code,
    name: row.name,
    category: row.category,
    utilityGroup: row.utility_group,
    description: row.description,
    geometry: parseGeometry(row.geom),
    installationDate: row.installation_date,
    operationalStatus: row.operational_status,
    routeLengthM:
      row.route_length_m !== null && row.route_length_m !== undefined
        ? Number(row.route_length_m)
        : computeGeometryLengthM(parseGeometry(row.geom)),
    physicalCondition: row.physical_condition,
    verificationStatus: row.verification_status,
    dataQuality: row.data_quality,
    isCriticalHazard: row.is_critical_hazard,
    material: row.material,
    diameterMm: row.diameter_mm !== null ? Number(row.diameter_mm) : null,
    cableSpecification: row.cable_specification,
    recordedDepthM:
      row.recorded_depth_m !== null ? Number(row.recorded_depth_m) : null,
    depthIsVariable: row.depth_is_variable,
    depthMeasurementMethod: row.depth_measurement_method,
    documentedBeforeCovering: row.documented_before_covering,
    directionDescription: row.direction_description,
    constructionRecordRef: row.construction_record_ref,
    customAttributes: row.custom_attributes ?? {},
    referenceBenchmarkId: row.reference_benchmark_id,
    locationReferenceText: row.location_reference_text,
    notes: row.notes,
    positionSource: row.position_source,
    captureMethod: row.capture_method,
    receiverModel: row.receiver_model,
    horizontalAccuracyM:
      row.horizontal_accuracy_m !== null
        ? Number(row.horizontal_accuracy_m)
        : null,
    verticalAccuracyM:
      row.vertical_accuracy_m !== null ? Number(row.vertical_accuracy_m) : null,
    fixQuality: row.fix_quality,
    correctionSource: row.correction_source,
    sourceCrs: row.source_crs,
    measuredAt: row.measured_at,
    isManuallyAdjusted: row.is_manually_adjusted,
    capturedAt: row.captured_at,
    lastVerifiedAt: row.last_verified_at,
    lastVerifiedBy: row.last_verified_by,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    localSyncStatus: 'synced',
  };
}

function mapRouteVertex(row: RouteVertexRow): UtilityRouteVertexRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    partIndex: row.part_index,
    sequenceIndex: row.sequence_index,
    vertexKind: row.vertex_kind,
    location: parsePointGeometry(row.geom) ?? { lat: 0, lng: 0 },
    chainageM: row.chainage_m !== null ? Number(row.chainage_m) : null,
    horizontalAccuracyM:
      row.horizontal_accuracy_m !== null
        ? Number(row.horizontal_accuracy_m)
        : null,
    verticalAccuracyM:
      row.vertical_accuracy_m !== null ? Number(row.vertical_accuracy_m) : null,
    fixQuality: row.fix_quality,
    notes: row.notes,
    recordedAt: row.recorded_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapDepthObservation(row: DepthObsRow): UtilityDepthObservationRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    location: parsePointGeometry(row.geom) ?? { lat: 0, lng: 0 },
    depthM: Number(row.depth_m),
    measurementMethod: row.measurement_method,
    documentedBeforeCovering: row.documented_before_covering,
    chainageM: row.chainage_m !== null ? Number(row.chainage_m) : null,
    horizontalAccuracyM:
      row.horizontal_accuracy_m !== null
        ? Number(row.horizontal_accuracy_m)
        : null,
    notes: row.notes,
    observedAt: row.observed_at,
    observedBy: row.observed_by,
    createdAt: row.created_at,
  };
}

function mapJunction(row: JunctionRow): UtilityJunctionRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    connectedAssetId: row.connected_asset_id,
    junctionKind: row.junction_kind,
    label: row.label,
    location: parsePointGeometry(row.geom) ?? { lat: 0, lng: 0 },
    depthM: row.depth_m !== null ? Number(row.depth_m) : null,
    depthMeasurementMethod: row.depth_measurement_method,
    notes: row.notes,
    recordedAt: row.recorded_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapBenchmark(row: BenchmarkRow): SurveyBenchmarkRecord {
  return {
    assetId: row.asset_id,
    institutionId: row.institution_id,
    referenceCode: row.reference_code,
    monumentType: row.monument_type,
    elevationM: row.elevation_m !== null ? Number(row.elevation_m) : null,
    verticalDatum: row.vertical_datum,
    horizontalCrs: row.horizontal_crs,
    surveyMethod: row.survey_method,
    horizontalAccuracyM:
      row.horizontal_accuracy_m !== null
        ? Number(row.horizontal_accuracy_m)
        : null,
    verticalAccuracyM:
      row.vertical_accuracy_m !== null ? Number(row.vertical_accuracy_m) : null,
    surveyDate: row.survey_date,
    surveyorName: row.surveyor_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPhoto(row: PhotoRow): AssetPhotoRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    observationId: row.observation_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    widthPx: row.width_px,
    heightPx: row.height_px,
    photoKind: row.photo_kind,
    caption: row.caption,
    capturedAt: row.captured_at,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function mapDocument(row: DocumentRow): AssetDocumentRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    documentKind: row.document_kind,
    title: row.title,
    description: row.description,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function mapObservation(row: ObservationRow): AssetObservationRecord {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    location: parsePointGeometry(row.geom) ?? { lat: 0, lng: 0 },
    depthM: row.depth_m !== null ? Number(row.depth_m) : null,
    depthMeasurementMethod: row.depth_measurement_method,
    elevationM: row.elevation_m !== null ? Number(row.elevation_m) : null,
    positionSource: row.position_source,
    receiverModel: row.receiver_model,
    horizontalAccuracyM:
      row.horizontal_accuracy_m !== null
        ? Number(row.horizontal_accuracy_m)
        : null,
    verticalAccuracyM:
      row.vertical_accuracy_m !== null ? Number(row.vertical_accuracy_m) : null,
    fixQuality: row.fix_quality,
    correctionSource: row.correction_source,
    sourceCrs: row.source_crs,
    measuredAt: row.measured_at,
    notes: row.notes,
    observedBy: row.observed_by,
    createdAt: row.created_at,
  };
}

function mapHistory(row: HistoryRow): AssetVerificationEvent {
  return {
    id: row.id,
    institutionId: row.institution_id,
    assetId: row.asset_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reviewerId: row.reviewer_id,
    reviewerRole: row.reviewer_role,
    remarks: row.remarks,
    createdAt: row.created_at,
  };
}

/**
 * Production Supabase Data Gateway (PostgreSQL + PostGIS + Storage + RLS).
 * Caches reference and asset datasets locally into Dexie and writes new assets
 * and compressed photographs to the offline `syncQueue` when disconnected.
 */
export class SupabaseDataGateway implements BadoDataGateway {
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

  async getInstitutionSettings(
    institutionId: string,
  ): Promise<InstitutionSettings> {
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
      department: row.department_id
        ? (deptById.get(row.department_id) ?? null)
        : null,
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
    const [campuses, departments, assetItems] = await Promise.all([
      this.listCampuses(institutionId),
      this.listDepartments(institutionId),
      this.listAssets(institutionId, { campusId }),
    ]);

    let surfaceAssets = 0;
    let undergroundAssets = 0;
    let linearRoutes = 0;
    let surveyBenchmarks = 0;
    let pendingVerification = 0;

    for (const { asset } of assetItems) {
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
      totalAssets: assetItems.length,
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

  // ---------------------------------------------------------------------------
  // Phase 2 — Core Asset Registry, Benchmarks, Media & Verification
  // ---------------------------------------------------------------------------

  async listAssetTypes(
    institutionId: string,
    category?: AssetCategory,
  ): Promise<AssetTypeDefinition[]> {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('asset_types')
      .select('*')
      .eq('institution_id', institutionId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) {
      if (!navigator.onLine) {
        return badoDb.assetTypes
          .where('institutionId')
          .equals(institutionId)
          .filter((t) => t.isActive && (!category || t.category === category))
          .toArray();
      }
      throw new Error(error.message);
    }

    const mapped = (data ?? []).map(mapAssetType);
    await badoDb.assetTypes.bulkPut(mapped);
    await recordCacheSync(institutionId, null, 'asset_types', mapped.length);
    return mapped;
  }

  async listBenchmarkReferences(
    institutionId: string,
    campusId?: string | null,
  ): Promise<BenchmarkReferenceOption[]> {
    const items = await this.listAssets(institutionId, {
      campusId,
      category: 'survey_reference',
    });

    return items
      .filter((item): item is AssetListItem & { benchmark: SurveyBenchmarkRecord } =>
        Boolean(item.benchmark),
      )
      .map((item) => ({
        assetId: item.asset.id,
        campusId: item.asset.campusId,
        name: item.asset.name,
        referenceCode: item.benchmark.referenceCode,
        elevationM: item.benchmark.elevationM,
        verticalDatum: item.benchmark.verticalDatum,
      }))
      .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
  }

  async listAssets(
    institutionId: string,
    filters: AssetListFilters = {},
  ): Promise<AssetListItem[]> {
    const [assetTypes, campuses, departments] = await Promise.all([
      this.listAssetTypes(institutionId),
      this.listCampuses(institutionId),
      this.listDepartments(institutionId),
    ]);

    const supabase = getSupabaseClient();
    let assetQuery = supabase
      .from('assets')
      .select('*')
      .eq('institution_id', institutionId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false });

    if (filters.campusId) {
      assetQuery = assetQuery.eq('campus_id', filters.campusId);
    }
    if (filters.category && filters.category !== 'all') {
      assetQuery = assetQuery.eq('category', filters.category);
    }
    if (filters.assetTypeId && filters.assetTypeId !== 'all') {
      assetQuery = assetQuery.eq('asset_type_id', filters.assetTypeId);
    }
    if (filters.utilityGroup && filters.utilityGroup !== 'all') {
      assetQuery = assetQuery.eq('utility_group', filters.utilityGroup);
    }
    if (
      filters.verificationStatus &&
      filters.verificationStatus !== 'all' &&
      filters.verificationStatus !== 'pending_review'
    ) {
      assetQuery = assetQuery.eq(
        'verification_status',
        filters.verificationStatus,
      );
    }

    let assets: AssetRecord[];
    let benchmarks: SurveyBenchmarkRecord[];
    let photoRows: { asset_id: string }[] = [];
    let docRows: { asset_id: string }[] = [];
    let depthRows: { asset_id: string; depth_m: number }[] = [];

    const { data: assetData, error: assetErr } = await assetQuery;
    if (assetErr) {
      if (!navigator.onLine) {
        assets = await badoDb.assets
          .where('institutionId')
          .equals(institutionId)
          .filter((a) => a.archivedAt === null)
          .toArray();
        benchmarks = await badoDb.surveyBenchmarks
          .where('institutionId')
          .equals(institutionId)
          .toArray();
        const cachedDepths = await badoDb.depthObservations
          .where('institutionId')
          .equals(institutionId)
          .toArray();
        depthRows = cachedDepths.map((d) => ({
          asset_id: d.assetId,
          depth_m: d.depthM,
        }));
      } else {
        throw new Error(assetErr.message);
      }
    } else {
      const serverAssets = (assetData ?? []).map(mapAsset);
      assets = await cacheAndMergeServerAssets(institutionId, serverAssets);

      const [bmRes, photoRes, docRes, depthRes] = await Promise.all([
        supabase
          .from('survey_benchmarks')
          .select('*')
          .eq('institution_id', institutionId),
        supabase
          .from('asset_photos')
          .select('asset_id')
          .eq('institution_id', institutionId),
        supabase
          .from('asset_documents')
          .select('asset_id')
          .eq('institution_id', institutionId),
        supabase
          .from('utility_depth_observations')
          .select('asset_id, depth_m')
          .eq('institution_id', institutionId),
      ]);

      benchmarks = (bmRes.data ?? []).map(mapBenchmark);
      await badoDb.surveyBenchmarks.bulkPut(benchmarks);
      photoRows = photoRes.data ?? [];
      docRows = docRes.data ?? [];
      depthRows = (depthRes.data ?? []).map((row) => ({
        asset_id: row.asset_id,
        depth_m: Number(row.depth_m),
      }));
      await recordCacheSync(
        institutionId,
        filters.campusId ?? null,
        'assets',
        assets.length,
      );
    }

    const typeById = new Map(assetTypes.map((t) => [t.id, t]));
    const campusById = new Map(campuses.map((c) => [c.id, c]));
    const deptById = new Map(departments.map((d) => [d.id, d]));
    const bmById = new Map(benchmarks.map((b) => [b.assetId, b]));

    const photoCount = new Map<string, number>();
    for (const p of photoRows) {
      photoCount.set(p.asset_id, (photoCount.get(p.asset_id) ?? 0) + 1);
    }
    const docCount = new Map<string, number>();
    for (const d of docRows) {
      docCount.set(d.asset_id, (docCount.get(d.asset_id) ?? 0) + 1);
    }
    const depthsByAsset = new Map<string, number[]>();
    for (const row of depthRows) {
      const list = depthsByAsset.get(row.asset_id) ?? [];
      list.push(row.depth_m);
      depthsByAsset.set(row.asset_id, list);
    }

    const searchNeedle = (filters.search ?? '').trim().toLowerCase();

    return assets
      .filter((asset) => {
        if (filters.campusId && asset.campusId !== filters.campusId) return false;
        if (filters.category && filters.category !== 'all' && asset.category !== filters.category) return false;
        if (filters.assetTypeId && filters.assetTypeId !== 'all' && asset.assetTypeId !== filters.assetTypeId) return false;
        if (filters.utilityGroup && filters.utilityGroup !== 'all' && asset.utilityGroup !== filters.utilityGroup) return false;
        if (filters.verificationStatus && filters.verificationStatus !== 'all' && filters.verificationStatus !== 'pending_review' && asset.verificationStatus !== filters.verificationStatus) return false;
        if (
          filters.operationalStatus &&
          filters.operationalStatus !== 'all' &&
          asset.operationalStatus !== filters.operationalStatus
        ) {
          return false;
        }
        if (filters.geometryScope && filters.geometryScope !== 'all') {
          const linear = isLinearGeometry(asset.geometry);
          if (filters.geometryScope === 'linear' && !linear) return false;
          if (filters.geometryScope === 'points' && linear) return false;
        }
        if (
          filters.verificationStatus === 'pending_review' &&
          !isPendingVerification(asset.verificationStatus)
        ) {
          return false;
        }
        return true;
      })
      .map((asset): AssetListItem | null => {
        const assetType = typeById.get(asset.assetTypeId);
        if (!assetType) return null;
        const benchmark = bmById.get(asset.id) ?? null;
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
            assetType.name,
            benchmark?.referenceCode ?? '',
            benchmark?.monumentType ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(searchNeedle)) return null;
        }

        const depths = depthsByAsset.get(asset.id) ?? [];
        return {
          asset,
          assetType,
          campus,
          department,
          benchmark,
          photoCount: photoCount.get(asset.id) ?? 0,
          documentCount: docCount.get(asset.id) ?? 0,
          depthObservationCount: depths.length,
          minDepthM: depths.length > 0 ? Math.min(...depths) : null,
          maxDepthM: depths.length > 0 ? Math.max(...depths) : null,
        };
      })
      .filter((item): item is AssetListItem => item !== null)
      .sort((a, b) => b.asset.updatedAt.localeCompare(a.asset.updatedAt));
  }

  async getAssetDetail(
    institutionId: string,
    assetId: string,
  ): Promise<AssetDetailBundle> {
    const supabase = getSupabaseClient();
    const { data: assetRow, error: assetErr } = await supabase
      .from('assets')
      .select('*')
      .eq('institution_id', institutionId)
      .eq('id', assetId)
      .is('archived_at', null)
      .single();

    if (assetErr) {
      const cached = await badoDb.assets.get(assetId);
      if (!navigator.onLine && cached && cached.institutionId === institutionId) {
        const cachedType = await badoDb.assetTypes.get(cached.assetTypeId);
        if (!cachedType) throw new Error('Cached asset type missing.');
        const [cachedVertices, cachedDepths, cachedJunctions] =
          await Promise.all([
            badoDb.routeVertices
              .where('[institutionId+assetId]')
              .equals([institutionId, cached.id])
              .toArray(),
            badoDb.depthObservations
              .where('[institutionId+assetId]')
              .equals([institutionId, cached.id])
              .toArray(),
            badoDb.utilityJunctions
              .where('[institutionId+assetId]')
              .equals([institutionId, cached.id])
              .toArray(),
          ]);
        return {
          asset: cached,
          assetType: cachedType,
          campus: (await badoDb.campuses.get(cached.campusId)) ?? null,
          department: cached.departmentId
            ? ((await badoDb.departments.get(cached.departmentId)) ?? null)
            : null,
          benchmark: (await badoDb.surveyBenchmarks.get(cached.id)) ?? null,
          photoCount: 0,
          documentCount: 0,
          depthObservationCount: cachedDepths.length,
          minDepthM:
            cachedDepths.length > 0
              ? Math.min(...cachedDepths.map((d) => d.depthM))
              : null,
          maxDepthM:
            cachedDepths.length > 0
              ? Math.max(...cachedDepths.map((d) => d.depthM))
              : null,
          registeredByName: null,
          lastVerifiedByName: null,
          referenceBenchmark: null,
          photos: [],
          documents: [],
          observations: [],
          routeVertices: cachedVertices,
          depthObservations: cachedDepths,
          junctions: cachedJunctions,
          verificationHistory: [],
        };
      }
      throw new Error(assetErr.message);
    }

    const serverAsset = mapAsset(assetRow);
    const cachedAsset = await badoDb.assets.get(assetId);
    const hasPendingLocalAsset = cachedAsset?.institutionId === institutionId && cachedAsset.localSyncStatus === 'pending';
    const asset = hasPendingLocalAsset ? cachedAsset : serverAsset;
    const [
      assetTypes,
      campuses,
      departments,
      bmRes,
      photosRes,
      docsRes,
      obsRes,
      verticesRes,
      depthObsRes,
      junctionsRes,
      histRes,
    ] = await Promise.all([
      this.listAssetTypes(institutionId),
      this.listCampuses(institutionId),
      this.listDepartments(institutionId),
      supabase
        .from('survey_benchmarks')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .maybeSingle(),
      supabase
        .from('asset_photos')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('asset_documents')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('asset_observations')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('measured_at', { ascending: false }),
      supabase
        .from('utility_route_vertices')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('part_index', { ascending: true })
        .order('sequence_index', { ascending: true }),
      supabase
        .from('utility_depth_observations')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('chainage_m', { ascending: true }),
      supabase
        .from('utility_junctions')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('recorded_at', { ascending: true }),
      supabase
        .from('asset_verification_history')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false }),
    ]);

    const assetType = assetTypes.find((t) => t.id === asset.assetTypeId);
    if (!assetType) throw new Error('Asset type not found.');

    // Resolve short-lived signed URLs from private Storage buckets
    const photos: AssetPhotoRecord[] = [];
    for (const row of photosRes.data ?? []) {
      const mapped = mapPhoto(row);
      const { data: signed } = await supabase.storage
        .from('asset-photos')
        .createSignedUrl(mapped.storagePath, 3600);
      photos.push({ ...mapped, previewUrl: signed?.signedUrl ?? null });
    }

    const documents: AssetDocumentRecord[] = [];
    for (const row of docsRes.data ?? []) {
      const mapped = mapDocument(row);
      const { data: signed } = await supabase.storage
        .from('asset-documents')
        .createSignedUrl(mapped.storagePath, 3600);
      documents.push({ ...mapped, downloadUrl: signed?.signedUrl ?? null });
    }

    let referenceBenchmark: AssetDetailBundle['referenceBenchmark'] = null;
    if (asset.referenceBenchmarkId) {
      const [refAssetRes, refBmRes] = await Promise.all([
        supabase
          .from('assets')
          .select('id, name')
          .eq('institution_id', institutionId)
          .eq('id', asset.referenceBenchmarkId)
          .maybeSingle(),
        supabase
          .from('survey_benchmarks')
          .select('*')
          .eq('institution_id', institutionId)
          .eq('asset_id', asset.referenceBenchmarkId)
          .maybeSingle(),
      ]);
      if (refAssetRes.data && refBmRes.data) {
        referenceBenchmark = {
          assetId: refAssetRes.data.id,
          name: refAssetRes.data.name,
          referenceCode: refBmRes.data.reference_code,
          elevationM:
            refBmRes.data.elevation_m !== null
              ? Number(refBmRes.data.elevation_m)
              : null,
          verticalDatum: refBmRes.data.vertical_datum,
        };
      }
    }

    const serverVertices = (verticesRes.data ?? []).map(mapRouteVertex);
    const serverDepths = (depthObsRes.data ?? []).map(mapDepthObservation);
    const serverJunctions = (junctionsRes.data ?? []).map(mapJunction);
    const routeVertices = hasPendingLocalAsset
      ? await badoDb.routeVertices.where('[institutionId+assetId]').equals([institutionId, asset.id]).toArray()
      : serverVertices;
    const junctions = hasPendingLocalAsset
      ? await badoDb.utilityJunctions.where('[institutionId+assetId]').equals([institutionId, asset.id]).toArray()
      : serverJunctions;
    const pendingDepthIds = new Set((await badoDb.syncQueue.where('institutionId').equals(institutionId)
      .filter(q => q.recordType === 'utility_depth_observations' && q.status !== 'synced').toArray()).map(q => q.recordId));
    const localDepths = await badoDb.depthObservations.where('[institutionId+assetId]').equals([institutionId, asset.id])
      .filter(d => pendingDepthIds.has(d.id) || hasPendingLocalAsset).toArray();
    const depthById = new Map(serverDepths.map(d => [d.id, d]));
    for (const depth of localDepths) depthById.set(depth.id, depth);
    const depthObservations = [...depthById.values()];

    if (!hasPendingLocalAsset && serverVertices.length > 0) {
      await badoDb.routeVertices.bulkPut(serverVertices);
    }
    if (serverDepths.length > 0) {
      await badoDb.depthObservations.bulkPut(serverDepths.filter(d => !pendingDepthIds.has(d.id)));
    }
    if (!hasPendingLocalAsset && serverJunctions.length > 0) {
      await badoDb.utilityJunctions.bulkPut(serverJunctions);
    }

    return {
      asset,
      assetType,
      campus: campuses.find((c) => c.id === asset.campusId) ?? null,
      department: asset.departmentId
        ? (departments.find((d) => d.id === asset.departmentId) ?? null)
        : null,
      benchmark: bmRes.data ? mapBenchmark(bmRes.data) : null,
      photoCount: photos.length,
      documentCount: documents.length,
      depthObservationCount: depthObservations.length,
      minDepthM:
        depthObservations.length > 0
          ? Math.min(...depthObservations.map((o) => o.depthM))
          : null,
      maxDepthM:
        depthObservations.length > 0
          ? Math.max(...depthObservations.map((o) => o.depthM))
          : null,
      registeredByName: null,
      lastVerifiedByName: null,
      referenceBenchmark,
      photos,
      documents,
      observations: (obsRes.data ?? []).map(mapObservation),
      routeVertices,
      depthObservations,
      junctions,
      verificationHistory: (histRes.data ?? []).map(mapHistory),
    };
  }

  async createAsset(
    institutionId: string,
    rawInput: CreateAssetInput,
  ): Promise<AssetRecord> {
    const input = createAssetInputSchema.parse(rawInput);
    const assetTypes = await this.listAssetTypes(institutionId);
    const assetType = assetTypes.find((t) => t.id === input.assetTypeId);
    if (!assetType) {
      throw new Error('Selected asset type was not found for this institution.');
    }

    const cleanedAttributes = validateDynamicAttributes(
      assetType,
      input.customAttributes,
      input.submissionMode,
    );

    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const capturedAt = input.capturedAt ?? now;
    const measuredAt = input.measuredAt ?? capturedAt;
    const ewkt = `SRID=4326;POINT(${input.longitude} ${input.latitude})`;

    const insertPayload: Database['public']['Tables']['assets']['Insert'] = {
      id,
      institution_id: institutionId,
      campus_id: input.campusId,
      department_id: input.departmentId ?? null,
      asset_type_id: assetType.id,
      asset_code: input.assetCode,
      name: input.name,
      category: assetType.category,
      utility_group: input.isCriticalHazard
        ? 'critical_hazard'
        : assetType.utilityGroup,
      description: input.description ? input.description : null,
      geom: ewkt,
      installation_date: input.installationDate ? input.installationDate : null,
      operational_status: input.operationalStatus,
      physical_condition: input.physicalCondition,
      verification_status: input.submissionMode,
      data_quality: input.submissionMode === 'draft' ? 'incomplete' : 'unverified',
      is_critical_hazard: input.isCriticalHazard || assetType.code === 'GAS_LINE',
      material: input.material ? input.material : null,
      diameter_mm: input.diameterMm ?? null,
      cable_specification: input.cableSpecification
        ? input.cableSpecification
        : null,
      recorded_depth_m: input.recordedDepthM ?? null,
      depth_is_variable: input.depthIsVariable,
      depth_measurement_method: input.depthMeasurementMethod ?? null,
      documented_before_covering: input.documentedBeforeCovering,
      direction_description: input.directionDescription
        ? input.directionDescription
        : null,
      construction_record_ref: input.constructionRecordRef
        ? input.constructionRecordRef
        : null,
      custom_attributes: cleanedAttributes,
      reference_benchmark_id: input.referenceBenchmarkId ?? null,
      location_reference_text: input.locationReferenceText
        ? input.locationReferenceText
        : null,
      notes: input.notes ? input.notes : null,
      position_source: input.positionSource,
      capture_method: input.captureMethod,
      receiver_model: input.receiverModel ? input.receiverModel : null,
      horizontal_accuracy_m: input.horizontalAccuracyM ?? null,
      vertical_accuracy_m: input.verticalAccuracyM ?? null,
      fix_quality: input.fixQuality,
      correction_source: input.correctionSource ? input.correctionSource : null,
      source_crs: input.sourceCrs,
      measured_at: measuredAt,
      is_manually_adjusted: input.isManuallyAdjusted,
      captured_at: capturedAt,
    };

    // Offline-first capture: save locally and queue idempotently when offline
    if (input.saveOffline || !navigator.onLine) {
      const localRecord: AssetRecord = {
        id,
        institutionId,
        campusId: input.campusId,
        departmentId: input.departmentId ?? null,
        assetTypeId: assetType.id,
        assetCode: input.assetCode,
        name: input.name,
        category: assetType.category,
        utilityGroup: insertPayload.utility_group!,
        description: insertPayload.description ?? null,
        geometry: {
          type: 'Point',
          coordinates: [input.longitude, input.latitude],
        },
        installationDate: insertPayload.installation_date ?? null,
        operationalStatus: input.operationalStatus,
        routeLengthM: null,
        physicalCondition: input.physicalCondition,
        verificationStatus: input.submissionMode,
        dataQuality: insertPayload.data_quality!,
        isCriticalHazard: Boolean(insertPayload.is_critical_hazard),
        material: insertPayload.material ?? null,
        diameterMm: insertPayload.diameter_mm ?? null,
        cableSpecification: insertPayload.cable_specification ?? null,
        recordedDepthM: insertPayload.recorded_depth_m ?? null,
        depthIsVariable: input.depthIsVariable,
        depthMeasurementMethod: input.depthMeasurementMethod ?? null,
        documentedBeforeCovering: input.documentedBeforeCovering,
        directionDescription: insertPayload.direction_description ?? null,
        constructionRecordRef: insertPayload.construction_record_ref ?? null,
        customAttributes: cleanedAttributes,
        referenceBenchmarkId: input.referenceBenchmarkId ?? null,
        locationReferenceText: insertPayload.location_reference_text ?? null,
        notes: insertPayload.notes ?? null,
        positionSource: input.positionSource,
        captureMethod: input.captureMethod,
        receiverModel: insertPayload.receiver_model ?? null,
        horizontalAccuracyM: input.horizontalAccuracyM ?? null,
        verticalAccuracyM: input.verticalAccuracyM ?? null,
        fixQuality: input.fixQuality,
        correctionSource: insertPayload.correction_source ?? null,
        sourceCrs: input.sourceCrs,
        measuredAt,
        isManuallyAdjusted: input.isManuallyAdjusted,
        capturedAt,
        lastVerifiedAt: null,
        lastVerifiedBy: null,
        version: 1,
        createdBy: null,
        updatedBy: null,
        archivedAt: null,
        archivedBy: null,
        createdAt: now,
        updatedAt: now,
        localSyncStatus: 'pending',
      };

      await badoDb.assets.put(localRecord);
      await enqueueSyncOperation({
        institutionId,
        campusId: input.campusId,
        recordType: 'assets',
        recordId: id,
        operationType: 'create',
        payload: {
          assetInsert: insertPayload,
          benchmarkInsert: input.benchmark ?? null,
        },
        capturedAt,
      });

      return localRecord;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('assets')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    if (input.category === 'survey_reference' && input.benchmark) {
      const { error: bmErr } = await supabase.from('survey_benchmarks').insert({
        asset_id: data.id,
        institution_id: institutionId,
        reference_code: input.benchmark.referenceCode,
        monument_type: input.benchmark.monumentType,
        elevation_m: input.benchmark.elevationM ?? null,
        vertical_datum: input.benchmark.verticalDatum,
        horizontal_crs: input.benchmark.horizontalCrs,
        survey_method: input.benchmark.surveyMethod,
        horizontal_accuracy_m:
          input.benchmark.horizontalAccuracyM ??
          input.horizontalAccuracyM ??
          null,
        vertical_accuracy_m:
          input.benchmark.verticalAccuracyM ?? input.verticalAccuracyM ?? null,
        survey_date: input.benchmark.surveyDate
          ? input.benchmark.surveyDate
          : null,
        surveyor_name: input.benchmark.surveyorName
          ? input.benchmark.surveyorName
          : null,
      });
      if (bmErr) throw new Error(bmErr.message);
    }

    const mapped = mapAsset(data);
    await badoDb.assets.put(mapped);
    return mapped;
  }

  async submitDraftAsset(
    institutionId: string,
    assetId: string,
  ): Promise<AssetRecord> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('assets')
      .update({ verification_status: 'submitted' })
      .eq('institution_id', institutionId)
      .eq('id', assetId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const mapped = mapAsset(data);
    await badoDb.assets.put(mapped);
    return mapped;
  }

  async reviewAssetVerification(
    institutionId: string,
    rawInput: ReviewVerificationInput,
  ): Promise<AssetRecord> {
    const input = reviewVerificationSchema.parse(rawInput);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('review_asset_verification', {
      p_institution_id: institutionId,
      p_asset_id: input.assetId,
      p_to_status: input.toStatus,
      p_remarks: input.remarks,
    });

    if (error) throw new Error(error.message);
    const mapped = mapAsset(data);
    await badoDb.assets.put(mapped);
    return mapped;
  }

  async archiveAsset(
    institutionId: string,
    assetId: string,
    reason: string,
  ): Promise<void> {
    if (reason.trim().length < 4) {
      throw new Error('Provide an archival reason (at least 4 characters).');
    }
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('assets')
      .update({ archived_at: new Date().toISOString() })
      .eq('institution_id', institutionId)
      .eq('id', assetId);

    if (error) throw new Error(error.message);
    await badoDb.assets.delete(assetId);
  }

  async uploadAssetPhoto(
    institutionId: string,
    input: UploadAssetPhotoInput,
  ): Promise<AssetPhotoRecord> {
    const meta = uploadAssetPhotoMetaSchema.parse({
      assetId: input.assetId,
      photoKind: input.photoKind,
      caption: input.caption,
      capturedAt: input.capturedAt,
    });

    const prepared = await preparePhotoForStorage(input.file);
    const photoId = crypto.randomUUID();
    const now = new Date().toISOString();
    const cachedAsset = await badoDb.assets.get(meta.assetId);
    const campusFolder = cachedAsset?.campusId ?? 'campus';
    const storagePath = `${institutionId}/${campusFolder}/${meta.assetId}/photos/${photoId}_${prepared.fileName}`;

    if (input.saveOffline || !navigator.onLine) {
      const blobId = crypto.randomUUID();
      await badoDb.localMediaBlobs.add({
        id: blobId,
        institutionId,
        assetId: meta.assetId,
        mediaKind: 'photo',
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        blob: prepared.blob,
        createdAt: now,
      });

      const localPhoto: AssetPhotoRecord = {
        id: photoId,
        institutionId,
        assetId: meta.assetId,
        observationId: null,
        storagePath,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        fileSizeBytes: prepared.fileSizeBytes,
        widthPx: prepared.widthPx,
        heightPx: prepared.heightPx,
        photoKind: meta.photoKind,
        caption: meta.caption ?? null,
        capturedAt: meta.capturedAt ?? now,
        uploadedBy: null,
        createdAt: now,
        localBlobId: blobId,
      };
      await badoDb.assetPhotos.put(localPhoto);
      await enqueueSyncOperation({
        institutionId,
        campusId: cachedAsset?.campusId ?? null,
        recordType: 'asset_photos',
        recordId: photoId,
        operationType: 'upload_photo',
        payload: { localBlobId: blobId, meta: localPhoto },
        capturedAt: localPhoto.capturedAt,
      });
      return localPhoto;
    }

    const supabase = getSupabaseClient();
    const { error: uploadErr } = await supabase.storage
      .from('asset-photos')
      .upload(storagePath, prepared.blob, {
        contentType: prepared.mimeType,
        upsert: false,
      });
    if (uploadErr) throw new Error(uploadErr.message);

    const { data, error: metaErr } = await supabase
      .from('asset_photos')
      .insert({
        id: photoId,
        institution_id: institutionId,
        asset_id: meta.assetId,
        storage_path: storagePath,
        file_name: prepared.fileName,
        mime_type: prepared.mimeType,
        file_size_bytes: prepared.fileSizeBytes,
        width_px: prepared.widthPx,
        height_px: prepared.heightPx,
        photo_kind: meta.photoKind,
        caption: meta.caption ? meta.caption : null,
        captured_at: meta.capturedAt ?? now,
      })
      .select('*')
      .single();

    if (metaErr) throw new Error(metaErr.message);
    return mapPhoto(data);
  }

  async uploadAssetDocument(
    institutionId: string,
    input: UploadAssetDocumentInput,
  ): Promise<AssetDocumentRecord> {
    const meta = uploadAssetDocumentMetaSchema.parse({
      assetId: input.assetId,
      documentKind: input.documentKind,
      title: input.title,
      description: input.description,
    });

    const validated = validateDocumentFile(input.file);
    const docId = crypto.randomUUID();
    const cachedAsset = await badoDb.assets.get(meta.assetId);
    const campusFolder = cachedAsset?.campusId ?? 'campus';
    const storagePath = `${institutionId}/${campusFolder}/${meta.assetId}/docs/${docId}_${validated.fileName}`;

    const supabase = getSupabaseClient();
    const { error: uploadErr } = await supabase.storage
      .from('asset-documents')
      .upload(storagePath, validated.blob, {
        contentType: validated.mimeType,
        upsert: false,
      });
    if (uploadErr) throw new Error(uploadErr.message);

    const { data, error: metaErr } = await supabase
      .from('asset_documents')
      .insert({
        id: docId,
        institution_id: institutionId,
        asset_id: meta.assetId,
        storage_path: storagePath,
        file_name: validated.fileName,
        mime_type: validated.mimeType,
        file_size_bytes: validated.fileSizeBytes,
        document_kind: meta.documentKind,
        title: meta.title,
        description: meta.description ? meta.description : null,
      })
      .select('*')
      .single();

    if (metaErr) throw new Error(metaErr.message);
    return mapDocument(data);
  }

  async createLinearRoute(
    institutionId: string,
    rawInput: CreateLinearRouteInput,
  ): Promise<AssetRecord> {
    const input = createLinearRouteInputSchema.parse(rawInput);
    const assetTypes = await this.listAssetTypes(institutionId);
    const assetType = assetTypes.find((t) => t.id === input.assetTypeId);
    if (!assetType) {
      throw new Error('Selected asset type was not found for this institution.');
    }
    if (
      !assetType.allowedGeomTypes.includes('LineString') &&
      !assetType.allowedGeomTypes.includes('MultiLineString')
    ) {
      throw new Error(
        `Asset type "${assetType.name}" does not support linear route geometries.`,
      );
    }

    const cleanedAttributes = validateDynamicAttributes(
      assetType,
      input.customAttributes,
      input.submissionMode,
    );

    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const capturedAt = input.capturedAt || now;
    const measuredAt = input.measuredAt || capturedAt;
    const routeLengthM = computeGeometryLengthM(input.geometry) ?? 0;
    if (routeLengthM <= 0) {
      throw new Error('Linear utility route must have a non-zero length.');
    }

    const hasDepthObs = input.depthObservations.length > 0;
    const distinctDepths = new Set(
      input.depthObservations.map((d) => Number(d.depthM.toFixed(2))),
    );
    const depthIsVariable = input.depthIsVariable || distinctDepths.size > 1;

    const representativeDepth =
      input.recordedDepthM ??
      (hasDepthObs ? input.depthObservations[0].depthM : null);
    const representativeDepthMethod =
      input.depthMeasurementMethod ??
      (hasDepthObs ? input.depthObservations[0].measurementMethod : null);
    const documentedBeforeCovering =
      input.documentedBeforeCovering ||
      input.depthObservations.some((d) => d.documentedBeforeCovering);

    const resolvedDataQuality: Database['public']['Enums']['data_quality'] =
      input.submissionMode === 'draft' ? 'incomplete' : 'unverified';

    const utilityGroup = assetType.utilityGroup;
    const isCriticalHazard =
      input.isCriticalHazard || assetType.utilityGroup === 'critical_hazard';

    const assetInsert: Database['public']['Tables']['assets']['Insert'] = {
      id,
      institution_id: institutionId,
      campus_id: input.campusId,
      department_id: input.departmentId ?? null,
      asset_type_id: assetType.id,
      asset_code: input.assetCode,
      name: input.name,
      category: assetType.category,
      utility_group: utilityGroup,
      description: input.description ? input.description : null,
      geom: geometryToEwkt(input.geometry),
      installation_date: input.installationDate ? input.installationDate : null,
      operational_status: input.operationalStatus,
      physical_condition: input.physicalCondition,
      verification_status: input.submissionMode,
      data_quality: resolvedDataQuality,
      is_critical_hazard: isCriticalHazard,
      material: input.material ? input.material : null,
      diameter_mm: input.diameterMm ?? null,
      cable_specification: input.cableSpecification
        ? input.cableSpecification
        : null,
      recorded_depth_m: representativeDepth,
      depth_is_variable: depthIsVariable,
      depth_measurement_method: representativeDepthMethod,
      documented_before_covering: documentedBeforeCovering,
      direction_description: input.directionDescription
        ? input.directionDescription
        : null,
      construction_record_ref: input.constructionRecordRef
        ? input.constructionRecordRef
        : null,
      custom_attributes: cleanedAttributes,
      reference_benchmark_id: input.referenceBenchmarkId ?? null,
      location_reference_text: input.locationReferenceText
        ? input.locationReferenceText
        : null,
      notes: input.notes ? input.notes : null,
      position_source: input.positionSource,
      capture_method: input.captureMethod,
      receiver_model: input.receiverModel ? input.receiverModel : null,
      horizontal_accuracy_m: input.horizontalAccuracyM ?? null,
      vertical_accuracy_m: input.verticalAccuracyM ?? null,
      fix_quality: input.fixQuality,
      correction_source: input.correctionSource ? input.correctionSource : null,
      source_crs: input.sourceCrs,
      measured_at: measuredAt,
      is_manually_adjusted: input.isManuallyAdjusted,
      captured_at: capturedAt,
    };

    const rawVertices =
      input.vertices.length > 0
        ? input.vertices
        : buildFallbackVerticesFromGeometry(input.geometry, measuredAt);

    const vertexRecords: UtilityRouteVertexRecord[] = buildRouteVertexRecords(
      institutionId,
      id,
      rawVertices,
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
          assetId: id,
          location: { lat: obs.latitude, lng: obs.longitude },
          depthM: obs.depthM,
          measurementMethod: obs.measurementMethod,
          documentedBeforeCovering: obs.documentedBeforeCovering ?? false,
          chainageM: obs.chainageM ?? snap.chainageM,
          horizontalAccuracyM: obs.horizontalAccuracyM ?? null,
          notes: obs.notes ? obs.notes : null,
          observedAt: obs.observedAt || now,
          observedBy: null,
          createdAt: now,
        };
      });
    const junctionRecords: UtilityJunctionRecord[] = input.junctions.map(
      (j) => ({
        id: crypto.randomUUID(),
        institutionId,
        assetId: id,
        connectedAssetId: j.connectedAssetId ?? null,
        junctionKind: j.junctionKind ?? 'tee',
        label: j.label ? j.label : null,
        location: { lat: j.latitude, lng: j.longitude },
        depthM: j.depthM ?? null,
        depthMeasurementMethod: j.depthMeasurementMethod ?? null,
        notes: j.notes ? j.notes : null,
        recordedAt: j.recordedAt || now,
        createdBy: null,
        createdAt: now,
      }),
    );

    const vertexInserts: Database['public']['Tables']['utility_route_vertices']['Insert'][] =
      vertexRecords.map((v) => ({
        id: v.id,
        institution_id: institutionId,
        asset_id: id,
        part_index: v.partIndex,
        sequence_index: v.sequenceIndex,
        vertex_kind: v.vertexKind,
        geom: geometryToEwkt({
          type: 'Point',
          coordinates: [v.location.lng, v.location.lat],
        }),
        chainage_m: v.chainageM,
        horizontal_accuracy_m: v.horizontalAccuracyM,
        vertical_accuracy_m: v.verticalAccuracyM,
        fix_quality: v.fixQuality,
        notes: v.notes,
        recorded_at: v.recordedAt,
      }));

    const depthInserts: Database['public']['Tables']['utility_depth_observations']['Insert'][] =
      depthRecords.map((d) => ({
        id: d.id,
        institution_id: institutionId,
        asset_id: id,
        geom: geometryToEwkt({
          type: 'Point',
          coordinates: [d.location.lng, d.location.lat],
        }),
        depth_m: d.depthM,
        measurement_method: d.measurementMethod,
        documented_before_covering: d.documentedBeforeCovering,
        chainage_m: d.chainageM,
        horizontal_accuracy_m: d.horizontalAccuracyM,
        notes: d.notes,
        observed_at: d.observedAt,
      }));

    const junctionInserts: Database['public']['Tables']['utility_junctions']['Insert'][] =
      junctionRecords.map((j) => ({
        id: j.id,
        institution_id: institutionId,
        asset_id: id,
        connected_asset_id: j.connectedAssetId,
        junction_kind: j.junctionKind,
        label: j.label,
        geom: geometryToEwkt({
          type: 'Point',
          coordinates: [j.location.lng, j.location.lat],
        }),
        depth_m: j.depthM,
        depth_measurement_method: j.depthMeasurementMethod,
        notes: j.notes,
        recorded_at: j.recordedAt,
      }));

    if (input.saveOffline || !navigator.onLine) {
      const localRecord: AssetRecord = {
        id,
        institutionId,
        campusId: input.campusId,
        departmentId: input.departmentId ?? null,
        assetTypeId: assetType.id,
        assetCode: input.assetCode,
        name: input.name,
        category: assetType.category,
        utilityGroup,
        description: assetInsert.description ?? null,
        geometry: input.geometry,
        installationDate: assetInsert.installation_date ?? null,
        operationalStatus: input.operationalStatus,
        routeLengthM,
        physicalCondition: input.physicalCondition,
        verificationStatus: input.submissionMode,
        dataQuality: resolvedDataQuality,
        isCriticalHazard,
        material: assetInsert.material ?? null,
        diameterMm: assetInsert.diameter_mm ?? null,
        cableSpecification: assetInsert.cable_specification ?? null,
        recordedDepthM: representativeDepth,
        depthIsVariable,
        depthMeasurementMethod: representativeDepthMethod,
        documentedBeforeCovering,
        directionDescription: assetInsert.direction_description ?? null,
        constructionRecordRef: assetInsert.construction_record_ref ?? null,
        customAttributes: cleanedAttributes,
        referenceBenchmarkId: input.referenceBenchmarkId ?? null,
        locationReferenceText: assetInsert.location_reference_text ?? null,
        notes: assetInsert.notes ?? null,
        positionSource: input.positionSource,
        captureMethod: input.captureMethod,
        receiverModel: assetInsert.receiver_model ?? null,
        horizontalAccuracyM: input.horizontalAccuracyM ?? null,
        verticalAccuracyM: input.verticalAccuracyM ?? null,
        fixQuality: input.fixQuality,
        correctionSource: assetInsert.correction_source ?? null,
        sourceCrs: input.sourceCrs,
        measuredAt,
        isManuallyAdjusted: input.isManuallyAdjusted,
        capturedAt,
        lastVerifiedAt: null,
        lastVerifiedBy: null,
        version: 1,
        createdBy: null,
        updatedBy: null,
        archivedAt: null,
        archivedBy: null,
        createdAt: now,
        updatedAt: now,
        localSyncStatus: 'pending',
      };

      await badoDb.transaction(
        'rw',
        [
          badoDb.assets,
          badoDb.routeVertices,
          badoDb.depthObservations,
          badoDb.utilityJunctions,
          badoDb.syncQueue,
        ],
        async () => {
          await badoDb.assets.put(localRecord);
          if (vertexRecords.length > 0) {
            await badoDb.routeVertices.bulkPut(vertexRecords);
          }
          if (depthRecords.length > 0) {
            await badoDb.depthObservations.bulkPut(depthRecords);
          }
          if (junctionRecords.length > 0) {
            await badoDb.utilityJunctions.bulkPut(junctionRecords);
          }
          await enqueueSyncOperation({
            institutionId,
            campusId: input.campusId,
            recordType: 'assets',
            recordId: id,
            operationType: 'create',
            payload: { assetInsert, routeVertexInserts: vertexInserts, depthObservationInserts: depthInserts, junctionInserts },
            capturedAt,
          });
        },
      );

      return localRecord;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('assets')
      .insert(assetInsert)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(
          `Asset code "${input.assetCode}" already exists in this institution.`,
        );
      }
      throw new Error(error.message);
    }

    if (vertexInserts.length > 0) {
      const { error: vErr } = await supabase
        .from('utility_route_vertices')
        .insert(vertexInserts);
      if (vErr) throw new Error(vErr.message);
    }
    if (depthInserts.length > 0) {
      const { error: dErr } = await supabase
        .from('utility_depth_observations')
        .insert(depthInserts);
      if (dErr) throw new Error(dErr.message);
    }
    if (junctionInserts.length > 0) {
      const { error: jErr } = await supabase
        .from('utility_junctions')
        .insert(junctionInserts);
      if (jErr) throw new Error(jErr.message);
    }

    const mapped = mapAsset(data);
    await badoDb.assets.put(mapped);
    if (vertexRecords.length > 0) {
      await badoDb.routeVertices.bulkPut(vertexRecords);
    }
    if (depthRecords.length > 0) {
      await badoDb.depthObservations.bulkPut(depthRecords);
    }
    if (junctionRecords.length > 0) {
      await badoDb.utilityJunctions.bulkPut(junctionRecords);
    }
    return mapped;
  }

  async updateRouteGeometry(
    institutionId: string,
    rawInput: UpdateRouteGeometryInput,
  ): Promise<AssetRecord> {
    const input = updateRouteGeometryInputSchema.parse(rawInput);
    const now = new Date().toISOString();
    const rawVertices =
      input.vertices.length > 0
        ? input.vertices
        : buildFallbackVerticesFromGeometry(input.geometry, now);
    const vertexRecords = buildRouteVertexRecords(
      institutionId,
      input.assetId,
      rawVertices,
      now,
    );

    const updatePayload: Database['public']['Tables']['assets']['Update'] = {
      geom: geometryToEwkt(input.geometry),
      is_manually_adjusted: input.isManuallyAdjusted,
      measured_at: now,
    };
    if (input.positionSource) updatePayload.position_source = input.positionSource;
    if (input.captureMethod) updatePayload.capture_method = input.captureMethod;
    if (input.horizontalAccuracyM !== undefined) {
      updatePayload.horizontal_accuracy_m = input.horizontalAccuracyM;
    }

    const vertexInserts: Database['public']['Tables']['utility_route_vertices']['Insert'][] =
      vertexRecords.map((v) => ({
        id: v.id,
        institution_id: institutionId,
        asset_id: input.assetId,
        part_index: v.partIndex,
        sequence_index: v.sequenceIndex,
        vertex_kind: v.vertexKind,
        geom: geometryToEwkt({
          type: 'Point',
          coordinates: [v.location.lng, v.location.lat],
        }),
        chainage_m: v.chainageM,
        horizontal_accuracy_m: v.horizontalAccuracyM,
        vertical_accuracy_m: v.verticalAccuracyM,
        fix_quality: v.fixQuality,
        notes: v.notes,
        recorded_at: v.recordedAt,
      }));

    const junctionRecords: UtilityJunctionRecord[] | undefined =
      input.junctions?.map((jn) => ({
        id: crypto.randomUUID(),
        institutionId,
        assetId: input.assetId,
        connectedAssetId: jn.connectedAssetId ?? null,
        junctionKind: jn.junctionKind ?? 'tee',
        label: jn.label ? jn.label : null,
        location: { lat: jn.latitude, lng: jn.longitude },
        depthM: jn.depthM ?? null,
        depthMeasurementMethod: jn.depthMeasurementMethod ?? null,
        notes: jn.notes ? jn.notes : null,
        recordedAt: jn.recordedAt || now,
        createdBy: null,
        createdAt: now,
      }));

    const junctionInserts:
      | Database['public']['Tables']['utility_junctions']['Insert'][]
      | undefined = junctionRecords?.map((j) => ({
      id: j.id,
      institution_id: institutionId,
      asset_id: input.assetId,
      connected_asset_id: j.connectedAssetId,
      junction_kind: j.junctionKind,
      label: j.label,
      geom: geometryToEwkt({
        type: 'Point',
        coordinates: [j.location.lng, j.location.lat],
      }),
      depth_m: j.depthM,
      depth_measurement_method: j.depthMeasurementMethod,
      notes: j.notes,
      recorded_at: j.recordedAt,
    }));

    if (input.saveOffline || !navigator.onLine) {
      const existing = await badoDb.assets.get(input.assetId);
      if (!existing || existing.institutionId !== institutionId) {
        throw new Error('Route not available in offline cache for editing.');
      }
      const updatedLocal: AssetRecord = {
        ...existing,
        geometry: input.geometry,
        routeLengthM: computeGeometryLengthM(input.geometry),
        positionSource: input.positionSource ?? existing.positionSource,
        captureMethod: input.captureMethod ?? existing.captureMethod,
        horizontalAccuracyM:
          input.horizontalAccuracyM !== undefined
            ? input.horizontalAccuracyM
            : existing.horizontalAccuracyM,
        isManuallyAdjusted: input.isManuallyAdjusted,
        measuredAt: now,
        updatedAt: now,
        version: existing.version + 1,
        localSyncStatus: 'pending',
      };

      await badoDb.transaction(
        'rw',
        [badoDb.assets, badoDb.routeVertices, badoDb.utilityJunctions, badoDb.syncQueue],
        async () => {
          await badoDb.assets.put(updatedLocal);
          await badoDb.routeVertices
            .where('[institutionId+assetId]')
            .equals([institutionId, input.assetId])
            .delete();
          if (vertexRecords.length > 0) {
            await badoDb.routeVertices.bulkPut(vertexRecords);
          }
          if (junctionRecords !== undefined) {
            await badoDb.utilityJunctions
              .where('[institutionId+assetId]')
              .equals([institutionId, input.assetId])
              .delete();
            if (junctionRecords.length > 0) {
              await badoDb.utilityJunctions.bulkPut(junctionRecords);
            }
          }
          await enqueueSyncOperation({
            institutionId,
            campusId: existing.campusId,
            recordType: 'assets',
            recordId: existing.id,
            operationType: 'update',
            payload: { assetUpdate: updatePayload, routeVertexInserts: vertexInserts, junctionInserts: junctionInserts ?? null, editNotes: input.editNotes ?? null },
            baseVersion: existing.version,
            capturedAt: now,
          });
        },
      );

      return updatedLocal;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('assets')
      .update(updatePayload)
      .eq('institution_id', institutionId)
      .eq('id', input.assetId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    const { error: delErr } = await supabase
      .from('utility_route_vertices')
      .delete()
      .eq('institution_id', institutionId)
      .eq('asset_id', input.assetId);
    if (delErr) throw new Error(delErr.message);

    if (vertexInserts.length > 0) {
      const { error: insErr } = await supabase
        .from('utility_route_vertices')
        .insert(vertexInserts);
      if (insErr) throw new Error(insErr.message);
    }

    if (junctionInserts !== undefined) {
      const { error: jDelErr } = await supabase
        .from('utility_junctions')
        .delete()
        .eq('institution_id', institutionId)
        .eq('asset_id', input.assetId);
      if (jDelErr) throw new Error(jDelErr.message);
      if (junctionInserts.length > 0) {
        const { error: jInsErr } = await supabase
          .from('utility_junctions')
          .insert(junctionInserts);
        if (jInsErr) throw new Error(jInsErr.message);
      }
    }

    const mapped = mapAsset(data);
    await badoDb.assets.put(mapped);
    await badoDb.routeVertices
      .where('[institutionId+assetId]')
      .equals([institutionId, input.assetId])
      .delete();
    if (vertexRecords.length > 0) {
      await badoDb.routeVertices.bulkPut(vertexRecords);
    }
    return mapped;
  }

  async addDepthObservation(
    institutionId: string,
    rawInput: AddDepthObservationInput,
  ): Promise<UtilityDepthObservationRecord> {
    const input = addDepthObservationInputSchema.parse(rawInput);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const cachedAsset = await badoDb.assets.get(input.assetId);
    const computedChainage =
      input.chainageM ??
      (cachedAsset && isLinearGeometry(cachedAsset.geometry)
        ? snapPointToLinearRoute(cachedAsset.geometry, {
            lat: input.latitude,
            lng: input.longitude,
          }).chainageM
        : null);

    const insertPayload: Database['public']['Tables']['utility_depth_observations']['Insert'] =
      {
        id,
        institution_id: institutionId,
        asset_id: input.assetId,
        geom: geometryToEwkt({
          type: 'Point',
          coordinates: [input.longitude, input.latitude],
        }),
        depth_m: input.depthM,
        measurement_method: input.measurementMethod,
        documented_before_covering: input.documentedBeforeCovering,
        chainage_m: computedChainage,
        horizontal_accuracy_m: input.horizontalAccuracyM ?? null,
        notes: input.notes ? input.notes : null,
        observed_at: input.observedAt ?? now,
      };

    if (input.saveOffline || !navigator.onLine) {
      const localObs: UtilityDepthObservationRecord = {
        id,
        institutionId,
        assetId: input.assetId,
        location: { lat: input.latitude, lng: input.longitude },
        depthM: input.depthM,
        measurementMethod: input.measurementMethod,
        documentedBeforeCovering: input.documentedBeforeCovering,
        chainageM: computedChainage,
        horizontalAccuracyM: input.horizontalAccuracyM ?? null,
        notes: input.notes ? input.notes : null,
        observedAt: input.observedAt ?? now,
        observedBy: null,
        createdAt: now,
      };
      await badoDb.transaction('rw', [badoDb.depthObservations, badoDb.syncQueue], async () => {
        await badoDb.depthObservations.put(localObs);
        await enqueueSyncOperation({
          institutionId,
          campusId: cachedAsset?.campusId ?? null,
          recordType: 'utility_depth_observations',
          recordId: id,
          operationType: 'create',
          payload: { depthObservationInsert: insertPayload },
          capturedAt: localObs.observedAt,
        });
      });
      return localObs;
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('utility_depth_observations')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    const mapped = mapDepthObservation(data);
    await badoDb.depthObservations.put(mapped);
    return mapped;
  }

  async exportAssetsGeoJson(
    institutionId: string,
    filters: AssetListFilters = {},
  ): Promise<BadoGeoJsonFeatureCollection> {
    const supabase = getSupabaseClient();
    const [items, institutionRes, campuses] = await Promise.all([
      this.listAssets(institutionId, filters),
      supabase
        .from('institutions')
        .select('name, is_demo')
        .eq('id', institutionId)
        .maybeSingle(),
      filters.campusId ? this.listCampuses(institutionId) : Promise.resolve([]),
    ]);

    const campusName = filters.campusId
      ? (campuses.find((c) => c.id === filters.campusId)?.name ?? null)
      : null;

    return buildInstitutionalGeoJsonExport(items, {
      institutionName: institutionRes.data?.name ?? 'BADO Institution',
      isDemoInstitution: Boolean(institutionRes.data?.is_demo),
      campusName,
    });
  }
}

type NonEmptyVertexInput = NonNullable<CreateLinearRouteInput['vertices']>[number];

function buildFallbackVerticesFromGeometry(
  geometry: CreateLinearRouteInput['geometry'],
  recordedAt: string,
): NonEmptyVertexInput[] {
  const parts =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.coordinates;
  const out: NonEmptyVertexInput[] = [];
  parts.forEach((part, partIndex) => {
    part.forEach((coord, seqIndex) => {
      out.push({
        partIndex,
        sequenceIndex: seqIndex,
        vertexKind:
          seqIndex === 0
            ? 'start_point'
            : seqIndex === part.length - 1
              ? 'end_point'
              : 'track_point',
        longitude: coord[0],
        latitude: coord[1],
        recordedAt,
      });
    });
  });
  return out;
}

function buildRouteVertexRecords(
  institutionId: string,
  assetId: string,
  vertices: NonEmptyVertexInput[],
  now: string,
): UtilityRouteVertexRecord[] {
  const grouped = new Map<number, NonEmptyVertexInput[]>();
  for (const v of vertices) {
    const part = v.partIndex ?? 0;
    const list = grouped.get(part) ?? [];
    list.push(v);
    grouped.set(part, list);
  }
  const records: UtilityRouteVertexRecord[] = [];
  for (const [partIndex, partVertices] of [...grouped.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const ordered = [...partVertices].sort(
      (a, b) => a.sequenceIndex - b.sequenceIndex,
    );
    const chainages = computeVertexChainagesM(
      ordered.map((v) => ({ lat: v.latitude, lng: v.longitude })),
    );
    ordered.forEach((v, idx) => {
      records.push({
        id: crypto.randomUUID(),
        institutionId,
        assetId,
        partIndex,
        sequenceIndex: idx,
        vertexKind: v.vertexKind ?? 'track_point',
        location: { lat: v.latitude, lng: v.longitude },
        chainageM: v.chainageM ?? chainages[idx] ?? 0,
        horizontalAccuracyM: v.horizontalAccuracyM ?? null,
        verticalAccuracyM: v.verticalAccuracyM ?? null,
        fixQuality: v.fixQuality ?? 'unknown',
        notes: v.notes ? v.notes : null,
        recordedAt: v.recordedAt || now,
        createdBy: null,
        createdAt: now,
      });
    });
  }
  return records;
}

