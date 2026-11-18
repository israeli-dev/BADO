-- =============================================================================
-- BADO (Buried Asset Documentation & Operations) — University Edition
-- Migration: 20261118000100_phase1_institutional_foundation.sql
-- Phase 1: Extensions, RBAC enums, multi-institution hierarchy, profiles,
--          configurable legend settings, immutable audit logs, offline sync
--          idempotency ledger, and Row Level Security (RLS).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;
create extension if not exists postgis;

-- -----------------------------------------------------------------------------
-- 2. Enumerated Types
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'admin',
      'supervisor',
      'field_technician',
      'surveyor_gis',
      'read_only'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'audit_action') then
    create type public.audit_action as enum (
      'insert',
      'update',
      'delete',
      'archive',
      'approve',
      'reject',
      'import',
      'export'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Default Configurable Map Legend Helper
-- NOTE: These colours are BADO interface conventions for institutional mapping,
-- NOT statutory or certified excavation utility-marking standards.
-- -----------------------------------------------------------------------------
create or replace function public.default_legend_config()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'key', 'surface_facility',
      'label', 'Surface Assets',
      'colorHex', '#16a34a',
      'iconKey', 'building-2',
      'lineStyle', 'solid',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'water',
      'label', 'Water Infrastructure',
      'colorHex', '#2563eb',
      'iconKey', 'droplets',
      'lineStyle', 'solid',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'electrical',
      'label', 'Electrical Infrastructure',
      'colorHex', '#ca8a04',
      'iconKey', 'zap',
      'lineStyle', 'solid',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'telecom',
      'label', 'Telecommunications & Fibre',
      'colorHex', '#9333ea',
      'iconKey', 'cable',
      'lineStyle', 'dashed',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'drainage_sewer',
      'label', 'Drainage & Sewer',
      'colorHex', '#ea580c',
      'iconKey', 'waves',
      'lineStyle', 'solid',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'other_utility',
      'label', 'Other Utilities',
      'colorHex', '#64748b',
      'iconKey', 'layers',
      'lineStyle', 'dotted',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'critical_hazard',
      'label', 'Critical Hazards',
      'colorHex', '#dc2626',
      'iconKey', 'triangle-alert',
      'lineStyle', 'solid',
      'defaultVisible', true
    ),
    jsonb_build_object(
      'key', 'survey_benchmark',
      'label', 'Survey Benchmarks & Control',
      'colorHex', '#0891b2',
      'iconKey', 'crosshair',
      'lineStyle', 'solid',
      'defaultVisible', true
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Core Institutional Tables
-- -----------------------------------------------------------------------------

-- 4.1 institutions (top-level data ownership & isolation root)
create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  short_code text not null check (char_length(btrim(short_code)) between 2 and 24),
  country_code char(2) not null default 'NG' check (country_code ~ '^[A-Z]{2}$'),
  is_demo boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.institutions is
  'Participating universities and tertiary institutions. Pilot institutions (e.g. FUTA) and demonstration environments are ordinary rows, never hardcoded.';

-- 4.2 profiles (1:1 extension of auth.users; never holds role or institution_id directly)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 140),
  phone text check (phone is null or char_length(phone) <= 40),
  job_title text check (job_title is null or char_length(job_title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'User identity profile linked 1:1 to Supabase auth.users. Institutional membership and roles live in user_institutions.';

-- 4.3 institution_settings (1:1 configurable thresholds, workflow flags, legend)
create table if not exists public.institution_settings (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  default_dig_buffer_m numeric(6, 2) not null default 15.00
    check (default_dig_buffer_m > 0 and default_dig_buffer_m <= 500),
  live_nearby_m numeric(6, 2) not null default 20.00,
  live_approaching_m numeric(6, 2) not null default 10.00,
  live_close_m numeric(6, 2) not null default 5.00,
  require_verification_approval boolean not null default true,
  allow_public_passports boolean not null default false,
  legend_config jsonb not null default public.default_legend_config()
    check (jsonb_typeof(legend_config) = 'array'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institution_settings_live_thresholds_order_chk check (
    live_close_m > 0
    and live_approaching_m > live_close_m
    and live_nearby_m > live_approaching_m
    and live_nearby_m <= 500
  )
);

comment on table public.institution_settings is
  'Per-institution awareness thresholds and UI legend configuration. Buffers and thresholds are awareness parameters, never certified safe digging clearances.';

-- 4.4 campuses (spatial subdivisions of an institution; EPSG:4326 WGS84)
create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
  description text check (description is null or char_length(description) <= 1000),
  is_demo boolean not null default false,
  center_geom geometry(Point, 4326)
    check (center_geom is null or (ST_SRID(center_geom) = 4326 and ST_IsValid(center_geom))),
  boundary_geom geometry(MultiPolygon, 4326)
    check (boundary_geom is null or (ST_SRID(boundary_geom) = 4326 and ST_IsValid(boundary_geom))),
  default_zoom smallint not null default 16 check (default_zoom between 1 and 22),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  -- Supports composite foreign keys from child tables (e.g. assets) to guarantee
  -- campus_id always belongs to the exact same institution_id.
  unique (id, institution_id)
);

create index if not exists idx_campuses_institution_id
  on public.campuses (institution_id);
create index if not exists idx_campuses_center_geom
  on public.campuses using gist (center_geom)
  where center_geom is not null;
create index if not exists idx_campuses_boundary_geom
  on public.campuses using gist (boundary_geom)
  where boundary_geom is not null;
create index if not exists idx_campuses_boundary_geog
  on public.campuses using gist ((boundary_geom::geography))
  where boundary_geom is not null;

-- 4.5 departments (e.g. Works & Maintenance, Electrical Unit, Water Resources)
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  -- Supports composite FK so cross-institution department links are impossible.
  unique (id, institution_id)
);

create index if not exists idx_departments_institution_id
  on public.departments (institution_id);

-- 4.6 user_institutions (RBAC & multi-institution membership binding)
create table if not exists public.user_institutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  department_id uuid,
  role public.app_role not null default 'read_only',
  allowed_campus_ids uuid[],
  is_active boolean not null default true,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, institution_id),
  constraint user_institutions_department_same_inst_fk
    foreign key (department_id, institution_id)
    references public.departments (id, institution_id)
    on delete set null (department_id)
);

create index if not exists idx_user_institutions_user_active
  on public.user_institutions (user_id, institution_id)
  where is_active = true;
create index if not exists idx_user_institutions_inst_role
  on public.user_institutions (institution_id, role)
  where is_active = true;

-- 4.7 audit_logs (immutable, append-only institutional audit trail)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role public.app_role,
  action public.audit_action not null,
  entity_type text not null check (char_length(btrim(entity_type)) between 2 and 80),
  entity_id uuid not null,
  summary text not null default '',
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_institution_created
  on public.audit_logs (institution_id, created_at desc);
create index if not exists idx_audit_logs_entity
  on public.audit_logs (institution_id, entity_type, entity_id);

-- 4.8 sync_idempotency_ledger (prevents duplicate records during offline sync retries)
create table if not exists public.sync_idempotency_ledger (
  mutation_id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null check (char_length(btrim(entity_type)) between 2 and 80),
  entity_id uuid not null,
  operation text not null check (operation in ('create', 'update', 'archive', 'verify')),
  applied_at timestamptz not null default now(),
  response_snapshot jsonb
);

create index if not exists idx_sync_ledger_institution_user
  on public.sync_idempotency_ledger (institution_id, user_id, applied_at desc);

-- -----------------------------------------------------------------------------
-- 5. Security Definer RBAC & Tenant Isolation Helpers (Non-Recursive)
-- -----------------------------------------------------------------------------

create or replace function public.current_user_institution_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ui.institution_id
  from public.user_institutions ui
  join public.institutions i on i.id = ui.institution_id
  where ui.user_id = auth.uid()
    and ui.is_active = true
    and i.is_active = true;
$$;

create or replace function public.current_user_role(p_institution_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ui.role
  from public.user_institutions ui
  join public.institutions i on i.id = ui.institution_id
  where ui.user_id = auth.uid()
    and ui.institution_id = p_institution_id
    and ui.is_active = true
    and i.is_active = true
  limit 1;
$$;

create or replace function public.has_institution_role(
  p_institution_id uuid,
  p_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_institutions ui
    join public.institutions i on i.id = ui.institution_id
    where ui.user_id = auth.uid()
      and ui.institution_id = p_institution_id
      and ui.is_active = true
      and i.is_active = true
      and ui.role = any(p_roles)
  );
$$;

create or replace function public.has_campus_access(
  p_institution_id uuid,
  p_campus_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_institutions ui
    join public.institutions i on i.id = ui.institution_id
    where ui.user_id = auth.uid()
      and ui.institution_id = p_institution_id
      and ui.is_active = true
      and i.is_active = true
      and (
        ui.role = 'admin'
        or ui.allowed_campus_ids is null
        or p_campus_id = any(ui.allowed_campus_ids)
      )
  );
$$;

revoke all on function public.current_user_institution_ids() from public;
revoke all on function public.current_user_role(uuid) from public;
revoke all on function public.has_institution_role(uuid, public.app_role[]) from public;
revoke all on function public.has_campus_access(uuid, uuid) from public;

grant execute on function public.current_user_institution_ids() to authenticated;
grant execute on function public.current_user_role(uuid) to authenticated;
grant execute on function public.has_institution_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.has_campus_access(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Integrity, Profile Sync & Audit Triggers
-- -----------------------------------------------------------------------------

-- 6.1 Maintain updated_at automatically
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 6.2 Block reassignment of institution_id after creation
create or replace function public.prevent_institution_reassignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.institution_id is distinct from old.institution_id then
    raise exception 'Changing institution_id on an existing record is prohibited (table: %).', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 6.3 Prevent demoting/deactivating/removing the last active admin of an institution
create or replace function public.protect_last_institution_admin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  remaining_admins integer;
begin
  if tg_op = 'UPDATE' then
    if old.role = 'admin' and old.is_active = true
       and (new.role <> 'admin' or new.is_active = false) then
      select count(*) into remaining_admins
      from public.user_institutions
      where institution_id = old.institution_id
        and role = 'admin'
        and is_active = true
        and id <> old.id;

      if remaining_admins = 0 then
        raise exception 'Cannot remove or deactivate the last active administrator of an institution.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.role = 'admin' and old.is_active = true then
      select count(*) into remaining_admins
      from public.user_institutions
      where institution_id = old.institution_id
        and role = 'admin'
        and is_active = true
        and id <> old.id;

      if remaining_admins = 0 then
        raise exception 'Cannot delete the last active administrator of an institution.'
          using errcode = '23514';
      end if;
    end if;
    return old;
  end if;
  return null;
end;
$$;

-- 6.4 Enforce append-only audit_logs
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_logs is immutable; UPDATE and DELETE operations are prohibited.'
    using errcode = '42501';
end;
$$;

-- 6.5 Provision default institution_settings automatically
create or replace function public.auto_create_institution_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.institution_settings (institution_id)
  values (new.id)
  on conflict (institution_id) do nothing;
  return new;
end;
$$;

-- 6.6 Sync auth.users -> public.profiles on registration/invite
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

-- 6.7 Automatic audit logging for institutional changes
create or replace function public.record_institutional_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst_id uuid;
  v_entity_id uuid;
  v_action public.audit_action;
  v_old jsonb;
  v_new jsonb;
  v_actor uuid := auth.uid();
  v_role public.app_role;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_new := to_jsonb(new);
    v_old := null;
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  else
    v_action := 'delete';
    v_old := to_jsonb(old);
    v_new := null;
  end if;

  if tg_table_name = 'institutions' then
    v_inst_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
    v_entity_id := v_inst_id;
  elsif tg_table_name = 'institution_settings' then
    v_inst_id := coalesce((v_new ->> 'institution_id')::uuid, (v_old ->> 'institution_id')::uuid);
    v_entity_id := v_inst_id;
  else
    v_inst_id := coalesce((v_new ->> 'institution_id')::uuid, (v_old ->> 'institution_id')::uuid);
    v_entity_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  end if;

  -- Skip delete audit when the parent institution itself is cascading away
  if tg_op = 'DELETE' and not exists (select 1 from public.institutions where id = v_inst_id) then
    return old;
  end if;

  if v_actor is not null then
    v_role := public.current_user_role(v_inst_id);
  end if;

  insert into public.audit_logs (
    institution_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    old_data,
    new_data
  )
  values (
    v_inst_id,
    v_actor,
    v_role,
    v_action,
    tg_table_name,
    v_entity_id,
    format('%s on %s', upper(v_action::text), tg_table_name),
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

-- Attach updated_at triggers
drop trigger if exists trg_institutions_updated_at on public.institutions;
create trigger trg_institutions_updated_at
  before update on public.institutions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_institution_settings_updated_at on public.institution_settings;
create trigger trg_institution_settings_updated_at
  before update on public.institution_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_campuses_updated_at on public.campuses;
create trigger trg_campuses_updated_at
  before update on public.campuses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_departments_updated_at on public.departments;
create trigger trg_departments_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_institutions_updated_at on public.user_institutions;
create trigger trg_user_institutions_updated_at
  before update on public.user_institutions
  for each row execute function public.set_updated_at();

-- Attach institution_id immutability guards
drop trigger if exists trg_campuses_immutable_institution on public.campuses;
create trigger trg_campuses_immutable_institution
  before update on public.campuses
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_departments_immutable_institution on public.departments;
create trigger trg_departments_immutable_institution
  before update on public.departments
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_user_institutions_immutable_institution on public.user_institutions;
create trigger trg_user_institutions_immutable_institution
  before update on public.user_institutions
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_institution_settings_immutable_institution on public.institution_settings;
create trigger trg_institution_settings_immutable_institution
  before update on public.institution_settings
  for each row execute function public.prevent_institution_reassignment();

-- Attach last-admin protection
drop trigger if exists trg_protect_last_institution_admin on public.user_institutions;
create trigger trg_protect_last_institution_admin
  before update or delete on public.user_institutions
  for each row execute function public.protect_last_institution_admin();

-- Attach immutable audit log protection
drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_log_mutation();

-- Attach default settings creation
drop trigger if exists trg_institutions_auto_settings on public.institutions;
create trigger trg_institutions_auto_settings
  after insert on public.institutions
  for each row execute function public.auto_create_institution_settings();

-- Attach auth.users profile trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Attach automatic audit triggers
drop trigger if exists trg_audit_institutions on public.institutions;
create trigger trg_audit_institutions
  after insert or update on public.institutions
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_institution_settings on public.institution_settings;
create trigger trg_audit_institution_settings
  after update on public.institution_settings
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_campuses on public.campuses;
create trigger trg_audit_campuses
  after insert or update or delete on public.campuses
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_departments on public.departments;
create trigger trg_audit_departments
  after insert or update or delete on public.departments
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_user_institutions on public.user_institutions;
create trigger trg_audit_user_institutions
  after insert or update or delete on public.user_institutions
  for each row execute function public.record_institutional_audit();

-- -----------------------------------------------------------------------------
-- 7. Row Level Security (RLS) — Enabled & Forced on Every Table
-- -----------------------------------------------------------------------------

alter table public.institutions enable row level security;
alter table public.institutions force row level security;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.institution_settings enable row level security;
alter table public.institution_settings force row level security;

alter table public.campuses enable row level security;
alter table public.campuses force row level security;

alter table public.departments enable row level security;
alter table public.departments force row level security;

alter table public.user_institutions enable row level security;
alter table public.user_institutions force row level security;

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

alter table public.sync_idempotency_ledger enable row level security;
alter table public.sync_idempotency_ledger force row level security;

-- 7.1 institutions: members read; admins update metadata; provisioning happens server-side
create policy institutions_select_member
  on public.institutions for select
  to authenticated
  using (id in (select public.current_user_institution_ids()));

create policy institutions_update_admin
  on public.institutions for update
  to authenticated
  using (public.has_institution_role(id, array['admin'::public.app_role]))
  with check (public.has_institution_role(id, array['admin'::public.app_role]));

-- 7.2 profiles: users read self or colleagues in a shared active institution; update self only
create policy profiles_select_self_or_colleague
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.user_institutions ui
      where ui.user_id = profiles.id
        and ui.institution_id in (select public.current_user_institution_ids())
    )
  );

create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 7.3 institution_settings: members read legend/thresholds; admins update
create policy institution_settings_select_member
  on public.institution_settings for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy institution_settings_update_admin
  on public.institution_settings for update
  to authenticated
  using (public.has_institution_role(institution_id, array['admin'::public.app_role]))
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

-- 7.4 campuses: permitted members read; admins create/update (soft-deactivation preferred over delete)
create policy campuses_select_permitted
  on public.campuses for select
  to authenticated
  using (
    institution_id in (select public.current_user_institution_ids())
    and public.has_campus_access(institution_id, id)
  );

create policy campuses_insert_admin
  on public.campuses for insert
  to authenticated
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

create policy campuses_update_admin
  on public.campuses for update
  to authenticated
  using (public.has_institution_role(institution_id, array['admin'::public.app_role]))
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

-- 7.5 departments: members read; admins create/update
create policy departments_select_member
  on public.departments for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy departments_insert_admin
  on public.departments for insert
  to authenticated
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

create policy departments_update_admin
  on public.departments for update
  to authenticated
  using (public.has_institution_role(institution_id, array['admin'::public.app_role]))
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

-- 7.6 user_institutions: users read own memberships; admins/supervisors view institution roster;
--     ONLY institution admins can assign, modify, or revoke roles (no self-assignment possible).
create policy user_institutions_select_self_or_manager
  on public.user_institutions for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.has_institution_role(
      institution_id,
      array['admin'::public.app_role, 'supervisor'::public.app_role]
    )
  );

create policy user_institutions_insert_admin
  on public.user_institutions for insert
  to authenticated
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

create policy user_institutions_update_admin
  on public.user_institutions for update
  to authenticated
  using (public.has_institution_role(institution_id, array['admin'::public.app_role]))
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

-- 7.7 audit_logs: institution admins read; inserts happen via security definer triggers/RPCs
create policy audit_logs_select_admin
  on public.audit_logs for select
  to authenticated
  using (public.has_institution_role(institution_id, array['admin'::public.app_role]));

-- 7.8 sync_idempotency_ledger: active institutional operators read/insert own mutation keys
create policy sync_ledger_select_own_or_admin
  on public.sync_idempotency_ledger for select
  to authenticated
  using (
    (
      user_id = auth.uid()
      and institution_id in (select public.current_user_institution_ids())
    )
    or public.has_institution_role(institution_id, array['admin'::public.app_role])
  );

create policy sync_ledger_insert_operator
  on public.sync_idempotency_ledger for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.has_institution_role(
      institution_id,
      array[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'field_technician'::public.app_role,
        'surveyor_gis'::public.app_role
      ]
    )
  );

commit;
