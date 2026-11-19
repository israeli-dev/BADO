import type {
  AllowedGeometryType,
  AppRole,
  AssetCategory,
  AuditAction,
  CaptureMethod,
  CustomAttributeValue,
  DataQuality,
  DepthMeasurementMethod,
  DocumentKind,
  DynamicFieldDefinition,
  GnssFixQuality,
  JunctionKind,
  LegendEntry,
  LegendLineStyle,
  OperationalStatus,
  PhotoKind,
  PhysicalCondition,
  PositionSource,
  UtilityGroup,
  VerificationStatus,
  VertexKind,
} from './domain';

/**
 * Typed Supabase schema contract matching Phases 1–3 migrations.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      institutions: {
        Row: {
          id: string;
          name: string;
          slug: string;
          short_code: string;
          country_code: string;
          is_demo: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          short_code: string;
          country_code?: string;
          is_demo?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          short_code?: string;
          country_code?: string;
          is_demo?: boolean;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          phone: string | null;
          job_title: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          phone?: string | null;
          job_title?: string | null;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          job_title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      institution_settings: {
        Row: {
          institution_id: string;
          default_dig_buffer_m: number;
          live_nearby_m: number;
          live_approaching_m: number;
          live_close_m: number;
          require_verification_approval: boolean;
          allow_public_passports: boolean;
          legend_config: LegendEntry[];
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          institution_id: string;
          default_dig_buffer_m?: number;
          live_nearby_m?: number;
          live_approaching_m?: number;
          live_close_m?: number;
          require_verification_approval?: boolean;
          allow_public_passports?: boolean;
          legend_config?: LegendEntry[];
          updated_by?: string | null;
        };
        Update: {
          default_dig_buffer_m?: number;
          live_nearby_m?: number;
          live_approaching_m?: number;
          live_close_m?: number;
          require_verification_approval?: boolean;
          allow_public_passports?: boolean;
          legend_config?: LegendEntry[];
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      campuses: {
        Row: {
          id: string;
          institution_id: string;
          name: string;
          code: string;
          description: string | null;
          is_demo: boolean;
          center_geom: unknown;
          boundary_geom: unknown;
          default_zoom: number;
          is_active: boolean;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          name: string;
          code: string;
          description?: string | null;
          is_demo?: boolean;
          center_geom?: unknown;
          boundary_geom?: unknown;
          default_zoom?: number;
          is_active?: boolean;
          created_by?: string | null;
          updated_by?: string | null;
        };
        Update: {
          name?: string;
          code?: string;
          description?: string | null;
          is_demo?: boolean;
          center_geom?: unknown;
          boundary_geom?: unknown;
          default_zoom?: number;
          is_active?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          institution_id: string;
          name: string;
          code: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          name: string;
          code: string;
          description?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          code?: string;
          description?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_institutions: {
        Row: {
          id: string;
          user_id: string;
          institution_id: string;
          department_id: string | null;
          role: AppRole;
          allowed_campus_ids: string[] | null;
          is_active: boolean;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          institution_id: string;
          department_id?: string | null;
          role?: AppRole;
          allowed_campus_ids?: string[] | null;
          is_active?: boolean;
          invited_by?: string | null;
        };
        Update: {
          department_id?: string | null;
          role?: AppRole;
          allowed_campus_ids?: string[] | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      asset_types: {
        Row: {
          id: string;
          institution_id: string;
          category: AssetCategory;
          utility_group: UtilityGroup;
          code: string;
          name: string;
          description: string | null;
          default_code_prefix: string;
          allowed_geom_types: AllowedGeometryType[];
          color_hex: string;
          icon_key: string;
          line_style: LegendLineStyle;
          field_schema: DynamicFieldDefinition[];
          supports_passport: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          category: AssetCategory;
          utility_group: UtilityGroup;
          code: string;
          name: string;
          description?: string | null;
          default_code_prefix?: string;
          allowed_geom_types?: AllowedGeometryType[];
          color_hex: string;
          icon_key: string;
          line_style?: LegendLineStyle;
          field_schema?: DynamicFieldDefinition[];
          supports_passport?: boolean;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          description?: string | null;
          color_hex?: string;
          icon_key?: string;
          line_style?: LegendLineStyle;
          field_schema?: DynamicFieldDefinition[];
          is_active?: boolean;
        };
        Relationships: [];
      };
      assets: {
        Row: {
          id: string;
          institution_id: string;
          campus_id: string;
          department_id: string | null;
          asset_type_id: string;
          asset_code: string;
          name: string;
          category: AssetCategory;
          utility_group: UtilityGroup;
          description: string | null;
          geom: unknown;
          route_length_m: number | null;
          installation_date: string | null;
          operational_status: OperationalStatus;
          physical_condition: PhysicalCondition;
          verification_status: VerificationStatus;
          data_quality: DataQuality;
          is_critical_hazard: boolean;
          material: string | null;
          diameter_mm: number | null;
          cable_specification: string | null;
          recorded_depth_m: number | null;
          depth_is_variable: boolean;
          depth_measurement_method: DepthMeasurementMethod | null;
          documented_before_covering: boolean;
          direction_description: string | null;
          construction_record_ref: string | null;
          custom_attributes: Record<string, CustomAttributeValue>;
          reference_benchmark_id: string | null;
          location_reference_text: string | null;
          notes: string | null;
          position_source: PositionSource;
          capture_method: CaptureMethod;
          receiver_model: string | null;
          horizontal_accuracy_m: number | null;
          vertical_accuracy_m: number | null;
          fix_quality: GnssFixQuality;
          correction_source: string | null;
          source_crs: string;
          measured_at: string;
          is_manually_adjusted: boolean;
          captured_at: string;
          last_verified_at: string | null;
          last_verified_by: string | null;
          version: number;
          created_by: string | null;
          updated_by: string | null;
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          campus_id: string;
          department_id?: string | null;
          asset_type_id: string;
          asset_code: string;
          name: string;
          category: AssetCategory;
          utility_group: UtilityGroup;
          description?: string | null;
          geom: unknown;
          installation_date?: string | null;
          operational_status?: OperationalStatus;
          physical_condition?: PhysicalCondition;
          verification_status?: VerificationStatus;
          data_quality?: DataQuality;
          is_critical_hazard?: boolean;
          material?: string | null;
          diameter_mm?: number | null;
          cable_specification?: string | null;
          recorded_depth_m?: number | null;
          depth_is_variable?: boolean;
          depth_measurement_method?: DepthMeasurementMethod | null;
          documented_before_covering?: boolean;
          direction_description?: string | null;
          construction_record_ref?: string | null;
          custom_attributes?: Record<string, CustomAttributeValue>;
          reference_benchmark_id?: string | null;
          location_reference_text?: string | null;
          notes?: string | null;
          position_source?: PositionSource;
          capture_method?: CaptureMethod;
          receiver_model?: string | null;
          horizontal_accuracy_m?: number | null;
          vertical_accuracy_m?: number | null;
          fix_quality?: GnssFixQuality;
          correction_source?: string | null;
          source_crs?: string;
          measured_at?: string;
          is_manually_adjusted?: boolean;
          captured_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          department_id?: string | null;
          installation_date?: string | null;
          operational_status?: OperationalStatus;
          physical_condition?: PhysicalCondition;
          verification_status?: VerificationStatus;
          data_quality?: DataQuality;
          is_critical_hazard?: boolean;
          material?: string | null;
          diameter_mm?: number | null;
          cable_specification?: string | null;
          recorded_depth_m?: number | null;
          depth_is_variable?: boolean;
          depth_measurement_method?: DepthMeasurementMethod | null;
          documented_before_covering?: boolean;
          direction_description?: string | null;
          construction_record_ref?: string | null;
          custom_attributes?: Record<string, CustomAttributeValue>;
          reference_benchmark_id?: string | null;
          location_reference_text?: string | null;
          notes?: string | null;
          geom?: string;
          position_source?: PositionSource;
          capture_method?: CaptureMethod;
          horizontal_accuracy_m?: number | null;
          vertical_accuracy_m?: number | null;
          fix_quality?: GnssFixQuality;
          measured_at?: string;
          is_manually_adjusted?: boolean;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      survey_benchmarks: {
        Row: {
          asset_id: string;
          institution_id: string;
          reference_code: string;
          monument_type: string;
          elevation_m: number | null;
          vertical_datum: string;
          horizontal_crs: string;
          survey_method: string;
          horizontal_accuracy_m: number | null;
          vertical_accuracy_m: number | null;
          survey_date: string | null;
          surveyor_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          asset_id: string;
          institution_id: string;
          reference_code: string;
          monument_type: string;
          elevation_m?: number | null;
          vertical_datum: string;
          horizontal_crs?: string;
          survey_method: string;
          horizontal_accuracy_m?: number | null;
          vertical_accuracy_m?: number | null;
          survey_date?: string | null;
          surveyor_name?: string | null;
        };
        Update: {
          monument_type?: string;
          elevation_m?: number | null;
          vertical_datum?: string;
          horizontal_crs?: string;
          survey_method?: string;
          horizontal_accuracy_m?: number | null;
          vertical_accuracy_m?: number | null;
          survey_date?: string | null;
          surveyor_name?: string | null;
        };
        Relationships: [];
      };
      asset_observations: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          geom: unknown;
          depth_m: number | null;
          depth_measurement_method: DepthMeasurementMethod | null;
          elevation_m: number | null;
          position_source: PositionSource;
          receiver_model: string | null;
          horizontal_accuracy_m: number | null;
          vertical_accuracy_m: number | null;
          fix_quality: GnssFixQuality;
          correction_source: string | null;
          source_crs: string;
          measured_at: string;
          notes: string | null;
          observed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          geom: unknown;
          depth_m?: number | null;
          depth_measurement_method?: DepthMeasurementMethod | null;
          elevation_m?: number | null;
          position_source?: PositionSource;
          receiver_model?: string | null;
          horizontal_accuracy_m?: number | null;
          vertical_accuracy_m?: number | null;
          fix_quality?: GnssFixQuality;
          correction_source?: string | null;
          source_crs?: string;
          measured_at?: string;
          notes?: string | null;
          observed_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      asset_verification_history: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          from_status: VerificationStatus | null;
          to_status: VerificationStatus;
          reviewer_id: string | null;
          reviewer_role: AppRole | null;
          remarks: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          from_status?: VerificationStatus | null;
          to_status: VerificationStatus;
          reviewer_id?: string | null;
          reviewer_role?: AppRole | null;
          remarks?: string;
        };
        Update: never;
        Relationships: [];
      };
      asset_photos: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          observation_id: string | null;
          storage_path: string;
          file_name: string;
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          file_size_bytes: number;
          width_px: number | null;
          height_px: number | null;
          photo_kind: PhotoKind;
          caption: string | null;
          captured_at: string;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          observation_id?: string | null;
          storage_path: string;
          file_name: string;
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          file_size_bytes: number;
          width_px?: number | null;
          height_px?: number | null;
          photo_kind?: PhotoKind;
          caption?: string | null;
          captured_at?: string;
          uploaded_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      asset_documents: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          document_kind: DocumentKind;
          title: string;
          description: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          document_kind?: DocumentKind;
          title: string;
          description?: string | null;
          uploaded_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          institution_id: string;
          actor_user_id: string | null;
          actor_role: AppRole | null;
          action: AuditAction;
          entity_type: string;
          entity_id: string;
          summary: string;
          old_data: Record<string, unknown> | null;
          new_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      sync_idempotency_ledger: {
        Row: {
          mutation_id: string;
          institution_id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          operation: string;
          applied_at: string;
          response_snapshot: Json | null;
        };
        Insert: {
          mutation_id: string;
          institution_id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          operation: string;
          response_snapshot?: Json | null;
        };
        Update: never;
        Relationships: [];
      };
      utility_route_vertices: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          part_index: number;
          sequence_index: number;
          vertex_kind: VertexKind;
          geom: unknown;
          chainage_m: number | null;
          horizontal_accuracy_m: number | null;
          vertical_accuracy_m: number | null;
          fix_quality: GnssFixQuality;
          notes: string | null;
          recorded_at: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          part_index?: number;
          sequence_index: number;
          vertex_kind?: VertexKind;
          geom: unknown;
          chainage_m?: number | null;
          horizontal_accuracy_m?: number | null;
          vertical_accuracy_m?: number | null;
          fix_quality?: GnssFixQuality;
          notes?: string | null;
          recorded_at?: string;
          created_by?: string | null;
        };
        Update: {
          vertex_kind?: VertexKind;
          geom?: unknown;
          chainage_m?: number | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      utility_depth_observations: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          geom: unknown;
          depth_m: number;
          measurement_method: DepthMeasurementMethod;
          documented_before_covering: boolean;
          chainage_m: number | null;
          horizontal_accuracy_m: number | null;
          notes: string | null;
          observed_at: string;
          observed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          geom: unknown;
          depth_m: number;
          measurement_method: DepthMeasurementMethod;
          documented_before_covering?: boolean;
          chainage_m?: number | null;
          horizontal_accuracy_m?: number | null;
          notes?: string | null;
          observed_at?: string;
          observed_by?: string | null;
        };
        Update: {
          depth_m?: number;
          measurement_method?: DepthMeasurementMethod;
          documented_before_covering?: boolean;
          notes?: string | null;
        };
        Relationships: [];
      };
      utility_junctions: {
        Row: {
          id: string;
          institution_id: string;
          asset_id: string;
          connected_asset_id: string | null;
          junction_kind: JunctionKind;
          label: string | null;
          geom: unknown;
          depth_m: number | null;
          depth_measurement_method: DepthMeasurementMethod | null;
          notes: string | null;
          recorded_at: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          institution_id: string;
          asset_id: string;
          connected_asset_id?: string | null;
          junction_kind?: JunctionKind;
          label?: string | null;
          geom: unknown;
          depth_m?: number | null;
          depth_measurement_method?: DepthMeasurementMethod | null;
          notes?: string | null;
          recorded_at?: string;
          created_by?: string | null;
        };
        Update: {
          connected_asset_id?: string | null;
          junction_kind?: JunctionKind;
          label?: string | null;
          geom?: unknown;
          depth_m?: number | null;
          depth_measurement_method?: DepthMeasurementMethod | null;
          notes?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_before_dig: { Args: { p_institution_id: string; p_campus_id: string; p_geometry: Json; p_buffer_m: number }; Returns: Json };
      assign_confirmed_member: { Args: { p_institution_id: string; p_campus_id: string; p_email: string }; Returns: string };
      create_point_asset_atomic: { Args: { p_institution_id: string; p_asset: Json; p_benchmark: Json }; Returns: Json };
      replay_point_asset_mutation: { Args: { p_mutation_id: string; p_institution_id: string; p_actor_id: string; p_asset_id: string; p_payload: Json }; Returns: Json };
      replay_linear_route_mutation: {
        Args: { p_mutation_id: string; p_institution_id: string; p_actor_id: string; p_asset_id: string; p_operation: string; p_payload: Json; p_base_version?: number | null };
        Returns: Json;
      };
      create_linear_route_atomic: {
        Args: { p_institution_id: string; p_asset: Json; p_vertices: Json; p_depths: Json; p_junctions: Json };
        Returns: Json;
      };
      update_linear_route_atomic: {
        Args: { p_institution_id: string; p_asset_id: string; p_update: Json; p_vertices: Json; p_junctions: Json; p_expected_version?: number | null };
        Returns: Json;
      };
      current_user_institution_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      current_user_role: {
        Args: { p_institution_id: string };
        Returns: AppRole | null;
      };
      has_institution_role: {
        Args: { p_institution_id: string; p_roles: AppRole[] };
        Returns: boolean;
      };
      has_campus_access: {
        Args: { p_institution_id: string; p_campus_id: string };
        Returns: boolean;
      };
      review_asset_verification: {
        Args: {
          p_institution_id: string;
          p_asset_id: string;
          p_to_status: VerificationStatus;
          p_remarks?: string;
        };
        Returns: Database['public']['Tables']['assets']['Row'];
      };
    };
    Enums: {
      app_role: AppRole;
      audit_action: AuditAction;
      asset_category: AssetCategory;
      utility_group: UtilityGroup;
      operational_status: OperationalStatus;
      physical_condition: PhysicalCondition;
      verification_status: VerificationStatus;
      data_quality: DataQuality;
      gnss_fix_quality: GnssFixQuality;
      position_source: PositionSource;
      capture_method: CaptureMethod;
      depth_measurement_method: DepthMeasurementMethod;
      vertex_kind: VertexKind;
      junction_kind: JunctionKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
