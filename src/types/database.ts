import type { AppRole, AuditAction, LegendEntry } from './domain';

/**
 * Typed Supabase schema contract matching `supabase/migrations/20261118000100_phase1_institutional_foundation.sql`.
 * Expanded progressively in later migrations (assets, routes, passports, etc.).
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
    };
    Views: Record<string, never>;
    Functions: {
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
    };
    Enums: {
      app_role: AppRole;
      audit_action: AuditAction;
    };
    CompositeTypes: Record<string, never>;
  };
}
