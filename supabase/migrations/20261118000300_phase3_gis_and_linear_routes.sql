-- =============================================================================
-- BADO (Buried Asset Documentation & Operations) — University Edition
-- Migration: 20261118000300_phase3_gis_and_linear_routes.sql
-- Phase 3: Linear utility route enrichment (ordered vertices, multi-point
--          variable burial depth observations, route junctions/tees),
--          automatic geodesic route-length computation, forced RLS policies,
--          audit triggers, and single-geometry-type QGIS PostGIS views.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Phase 3 Enumerated Types
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'vertex_kind') then
    create type public.vertex_kind as enum (
      'start_point',
      'track_point',
      'bend',
      'junction',
      'valve',
      'manhole',
      'depth_point',
      'note_point',
      'end_point'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'junction_kind') then
    create type public.junction_kind as enum (
      'tee',
      'cross',
      'elbow',
      'reducer',
      'chamber',
      'splice_box',
      'manhole',
      'service_tap',
      'other'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Geodesic Route Length Column & Geometry Validation on public.assets
-- -----------------------------------------------------------------------------
alter table public.assets
  add column if not exists route_length_m numeric(12, 2)
    check (route_length_m is null or route_length_m >= 0);

create or replace function public.compute_asset_route_length()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_geom_type text;
begin
  v_geom_type := geometrytype(new.geom);

  if v_geom_type in ('LINESTRING', 'MULTILINESTRING') then
    if st_npoints(new.geom) < 2 then
      raise exception 'Linear infrastructure geometry must contain at least 2 coordinate vertices.';
    end if;
    new.route_length_m := round(st_length(new.geom::geography)::numeric, 2);
  else
    new.route_length_m := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assets_compute_route_length on public.assets;
create trigger trg_assets_compute_route_length
  before insert or update of geom on public.assets
  for each row execute function public.compute_asset_route_length();

-- Backfill any existing LineString / MultiLineString rows
update public.assets
set route_length_m = round(st_length(geom::geography)::numeric, 2)
where geometrytype(geom) in ('LINESTRING', 'MULTILINESTRING')
  and route_length_m is null;

-- Allow Surveyors/GIS Officers with geometry-editing authority to update
-- non-archived campus geometries (while keeping verification & archival locked
-- inside enforce_asset_governance()).
drop policy if exists assets_update_policy on public.assets;
create policy assets_update_policy
  on public.assets
  for update
  to authenticated
  using (
    archived_at is null
    and public.has_campus_access(institution_id, campus_id)
    and (
      public.has_institution_role(
        institution_id,
        array['admin', 'supervisor', 'surveyor_gis']::public.app_role[]
      )
      or (
        public.has_institution_role(
          institution_id,
          array['field_technician']::public.app_role[]
        )
        and created_by = auth.uid()
        and verification_status in ('draft', 'rejected', 'needs_resurvey')
      )
    )
  )
  with check (
    public.has_campus_access(institution_id, campus_id)
    and (
      category <> 'survey_reference'
      or public.has_institution_role(
        institution_id,
        array['admin', 'surveyor_gis']::public.app_role[]
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Ordered Route Vertices (public.utility_route_vertices)
-- -----------------------------------------------------------------------------
create table if not exists public.utility_route_vertices (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  asset_id uuid not null,
  part_index integer not null default 0 check (part_index >= 0),
  sequence_index integer not null check (sequence_index >= 0),
  vertex_kind public.vertex_kind not null default 'track_point',
  geom geometry(Point, 4326) not null
    check (
      st_srid(geom) = 4326
      and not st_isempty(geom)
      and st_isvalid(geom)
    ),
  chainage_m numeric(12, 2) check (chainage_m is null or chainage_m >= 0),
  horizontal_accuracy_m numeric(8, 3)
    check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  vertical_accuracy_m numeric(8, 3)
    check (vertical_accuracy_m is null or vertical_accuracy_m >= 0),
  fix_quality public.gnss_fix_quality not null default 'unknown',
  notes text check (notes is null or char_length(notes) <= 1000),
  recorded_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),

  constraint uq_route_vertex_order unique (asset_id, part_index, sequence_index),
  constraint fk_route_vertices_asset_same_institution
    foreign key (asset_id, institution_id)
    references public.assets(id, institution_id)
    on delete cascade
);

create index if not exists idx_route_vertices_inst_asset
  on public.utility_route_vertices (institution_id, asset_id, part_index, sequence_index);

create index if not exists idx_route_vertices_geom_gist
  on public.utility_route_vertices using gist (geom);

drop trigger if exists trg_route_vertices_lock_institution on public.utility_route_vertices;
create trigger trg_route_vertices_lock_institution
  before update on public.utility_route_vertices
  for each row execute function public.prevent_institution_reassignment();

-- -----------------------------------------------------------------------------
-- 4. Multi-Point Burial Depth Observations (public.utility_depth_observations)
--    NOTE: Burial depth varies along pipelines/cables. Never infer depth from
--    unreliable consumer GPS altitude — measurement_method is strictly required.
-- -----------------------------------------------------------------------------
create table if not exists public.utility_depth_observations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  asset_id uuid not null,
  geom geometry(Point, 4326) not null
    check (
      st_srid(geom) = 4326
      and not st_isempty(geom)
      and st_isvalid(geom)
    ),
  depth_m numeric(6, 3) not null check (depth_m >= 0 and depth_m <= 100),
  measurement_method public.depth_measurement_method not null,
  documented_before_covering boolean not null default false,
  chainage_m numeric(12, 2) check (chainage_m is null or chainage_m >= 0),
  horizontal_accuracy_m numeric(8, 3)
    check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  observed_at timestamptz not null default timezone('utc', now()),
  observed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),

  constraint fk_depth_obs_asset_same_institution
    foreign key (asset_id, institution_id)
    references public.assets(id, institution_id)
    on delete cascade
);

create index if not exists idx_depth_obs_inst_asset
  on public.utility_depth_observations (institution_id, asset_id, observed_at desc);

create index if not exists idx_depth_obs_geom_gist
  on public.utility_depth_observations using gist (geom);

create index if not exists idx_depth_obs_geog_gist
  on public.utility_depth_observations using gist ((geom::geography));

drop trigger if exists trg_depth_obs_lock_institution on public.utility_depth_observations;
create trigger trg_depth_obs_lock_institution
  before update on public.utility_depth_observations
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_depth_obs_audit on public.utility_depth_observations;
create trigger trg_depth_obs_audit
  after insert or update or delete on public.utility_depth_observations
  for each row execute function public.record_institutional_audit();

-- -----------------------------------------------------------------------------
-- 5. Route Junctions, Tees & Connections (public.utility_junctions)
-- -----------------------------------------------------------------------------
create table if not exists public.utility_junctions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  asset_id uuid not null,
  connected_asset_id uuid,
  junction_kind public.junction_kind not null default 'tee',
  label text check (label is null or char_length(label) <= 140),
  geom geometry(Point, 4326) not null
    check (
      st_srid(geom) = 4326
      and not st_isempty(geom)
      and st_isvalid(geom)
    ),
  depth_m numeric(6, 3) check (depth_m is null or (depth_m >= 0 and depth_m <= 100)),
  depth_measurement_method public.depth_measurement_method,
  notes text check (notes is null or char_length(notes) <= 1000),
  recorded_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),

  constraint chk_junction_depth_method_required
    check (depth_m is null or depth_measurement_method is not null),
  constraint fk_junction_asset_same_institution
    foreign key (asset_id, institution_id)
    references public.assets(id, institution_id)
    on delete cascade,
  constraint fk_junction_connected_asset_same_institution
    foreign key (connected_asset_id, institution_id)
    references public.assets(id, institution_id)
    on delete set null
);

create index if not exists idx_utility_junctions_inst_asset
  on public.utility_junctions (institution_id, asset_id);

create index if not exists idx_utility_junctions_geom_gist
  on public.utility_junctions using gist (geom);

drop trigger if exists trg_utility_junctions_lock_institution on public.utility_junctions;
create trigger trg_utility_junctions_lock_institution
  before update on public.utility_junctions
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_utility_junctions_audit on public.utility_junctions;
create trigger trg_utility_junctions_audit
  after insert or update or delete on public.utility_junctions
  for each row execute function public.record_institutional_audit();

-- -----------------------------------------------------------------------------
-- 6. RLS Helpers & Forced Row Level Security on Phase 3 Tables
-- -----------------------------------------------------------------------------
create or replace function public.can_access_asset_record(
  p_institution_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.institution_id = p_institution_id
      and a.archived_at is null
      and public.has_campus_access(a.institution_id, a.campus_id)
      and (
        a.verification_status <> 'draft'
        or a.created_by = auth.uid()
        or public.has_institution_role(
          a.institution_id,
          array['admin', 'supervisor', 'surveyor_gis']::public.app_role[]
        )
      )
  );
$$;

create or replace function public.can_write_asset_spatial_children(
  p_institution_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.institution_id = p_institution_id
      and a.archived_at is null
      and public.has_campus_access(a.institution_id, a.campus_id)
      and public.has_institution_role(
        a.institution_id,
        array['admin', 'supervisor', 'field_technician', 'surveyor_gis']::public.app_role[]
      )
  );
$$;

create or replace function public.can_replace_asset_geometry(
  p_institution_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.institution_id = p_institution_id
      and a.archived_at is null
      and public.has_campus_access(a.institution_id, a.campus_id)
      and (
        public.has_institution_role(
          a.institution_id,
          array['admin', 'supervisor', 'surveyor_gis']::public.app_role[]
        )
        or (
          public.has_institution_role(
            a.institution_id,
            array['field_technician']::public.app_role[]
          )
          and a.created_by = auth.uid()
          and a.verification_status in ('draft', 'rejected', 'needs_resurvey')
        )
      )
  );
$$;

revoke all on function public.can_access_asset_record(uuid, uuid) from public;
revoke all on function public.can_write_asset_spatial_children(uuid, uuid) from public;
revoke all on function public.can_replace_asset_geometry(uuid, uuid) from public;
grant execute on function public.can_access_asset_record(uuid, uuid) to authenticated;
grant execute on function public.can_write_asset_spatial_children(uuid, uuid) to authenticated;
grant execute on function public.can_replace_asset_geometry(uuid, uuid) to authenticated;

-- utility_route_vertices RLS
alter table public.utility_route_vertices enable row level security;
alter table public.utility_route_vertices force row level security;

drop policy if exists route_vertices_select_policy on public.utility_route_vertices;
create policy route_vertices_select_policy
  on public.utility_route_vertices
  for select
  to authenticated
  using (public.can_access_asset_record(institution_id, asset_id));

drop policy if exists route_vertices_insert_policy on public.utility_route_vertices;
create policy route_vertices_insert_policy
  on public.utility_route_vertices
  for insert
  to authenticated
  with check (public.can_write_asset_spatial_children(institution_id, asset_id));

drop policy if exists route_vertices_update_policy on public.utility_route_vertices;
create policy route_vertices_update_policy
  on public.utility_route_vertices
  for update
  to authenticated
  using (public.can_replace_asset_geometry(institution_id, asset_id))
  with check (public.can_replace_asset_geometry(institution_id, asset_id));

drop policy if exists route_vertices_delete_policy on public.utility_route_vertices;
create policy route_vertices_delete_policy
  on public.utility_route_vertices
  for delete
  to authenticated
  using (public.can_replace_asset_geometry(institution_id, asset_id));

-- utility_depth_observations RLS
alter table public.utility_depth_observations enable row level security;
alter table public.utility_depth_observations force row level security;

drop policy if exists depth_obs_select_policy on public.utility_depth_observations;
create policy depth_obs_select_policy
  on public.utility_depth_observations
  for select
  to authenticated
  using (public.can_access_asset_record(institution_id, asset_id));

drop policy if exists depth_obs_insert_policy on public.utility_depth_observations;
create policy depth_obs_insert_policy
  on public.utility_depth_observations
  for insert
  to authenticated
  with check (public.can_write_asset_spatial_children(institution_id, asset_id));

drop policy if exists depth_obs_update_policy on public.utility_depth_observations;
create policy depth_obs_update_policy
  on public.utility_depth_observations
  for update
  to authenticated
  using (public.can_replace_asset_geometry(institution_id, asset_id))
  with check (public.can_replace_asset_geometry(institution_id, asset_id));

-- utility_junctions RLS
alter table public.utility_junctions enable row level security;
alter table public.utility_junctions force row level security;

drop policy if exists utility_junctions_select_policy on public.utility_junctions;
create policy utility_junctions_select_policy
  on public.utility_junctions
  for select
  to authenticated
  using (public.can_access_asset_record(institution_id, asset_id));

drop policy if exists utility_junctions_insert_policy on public.utility_junctions;
create policy utility_junctions_insert_policy
  on public.utility_junctions
  for insert
  to authenticated
  with check (public.can_write_asset_spatial_children(institution_id, asset_id));

drop policy if exists utility_junctions_update_policy on public.utility_junctions;
create policy utility_junctions_update_policy
  on public.utility_junctions
  for update
  to authenticated
  using (public.can_replace_asset_geometry(institution_id, asset_id))
  with check (public.can_replace_asset_geometry(institution_id, asset_id));

drop policy if exists utility_junctions_delete_policy on public.utility_junctions;
create policy utility_junctions_delete_policy
  on public.utility_junctions
  for delete
  to authenticated
  using (public.can_replace_asset_geometry(institution_id, asset_id));

-- -----------------------------------------------------------------------------
-- 7. QGIS-Compatible Typed PostGIS Views (SECURITY INVOKER — preserves RLS)
--    Each view exposes a strict geometry subtype + EPSG:4326 SRID so QGIS
--    populates `geometry_columns` cleanly without mixed-geometry ambiguity.
-- -----------------------------------------------------------------------------
create or replace view public.v_qgis_point_assets
with (security_invoker = true) as
select
  a.id,
  a.institution_id,
  a.campus_id,
  c.name as campus_name,
  a.department_id,
  d.code as department_code,
  a.asset_code,
  a.name,
  a.category,
  a.utility_group,
  t.code as asset_type_code,
  t.name as asset_type_name,
  a.operational_status,
  a.physical_condition,
  a.verification_status,
  a.data_quality,
  a.is_critical_hazard,
  a.material,
  a.diameter_mm,
  a.recorded_depth_m,
  a.depth_measurement_method,
  a.position_source,
  a.capture_method,
  a.horizontal_accuracy_m,
  a.vertical_accuracy_m,
  a.fix_quality,
  a.source_crs,
  a.is_manually_adjusted,
  a.installation_date,
  a.last_verified_at,
  a.updated_at,
  a.geom::geometry(Point, 4326) as geom
from public.assets a
join public.asset_types t on t.id = a.asset_type_id
join public.campuses c on c.id = a.campus_id
left join public.departments d on d.id = a.department_id
where a.archived_at is null
  and a.category <> 'survey_reference'
  and geometrytype(a.geom) = 'POINT';

create or replace view public.v_qgis_linear_utilities
with (security_invoker = true) as
select
  a.id,
  a.institution_id,
  a.campus_id,
  c.name as campus_name,
  a.department_id,
  d.code as department_code,
  a.asset_code,
  a.name,
  a.category,
  a.utility_group,
  t.code as asset_type_code,
  t.name as asset_type_name,
  a.operational_status,
  a.physical_condition,
  a.verification_status,
  a.data_quality,
  a.is_critical_hazard,
  a.route_length_m,
  a.material,
  a.diameter_mm,
  a.cable_specification,
  a.recorded_depth_m,
  a.depth_is_variable,
  a.depth_measurement_method,
  a.documented_before_covering,
  ds.min_depth_m,
  ds.max_depth_m,
  coalesce(ds.depth_observation_count, 0) as depth_observation_count,
  a.position_source,
  a.capture_method,
  a.horizontal_accuracy_m,
  a.fix_quality,
  a.source_crs,
  a.installation_date,
  a.last_verified_at,
  a.updated_at,
  st_multi(a.geom)::geometry(MultiLineString, 4326) as geom
from public.assets a
join public.asset_types t on t.id = a.asset_type_id
join public.campuses c on c.id = a.campus_id
left join public.departments d on d.id = a.department_id
left join lateral (
  select
    min(o.depth_m) as min_depth_m,
    max(o.depth_m) as max_depth_m,
    count(*)::integer as depth_observation_count
  from public.utility_depth_observations o
  where o.asset_id = a.id
    and o.institution_id = a.institution_id
) ds on true
where a.archived_at is null
  and geometrytype(a.geom) in ('LINESTRING', 'MULTILINESTRING');

create or replace view public.v_qgis_polygon_assets
with (security_invoker = true) as
select
  a.id,
  a.institution_id,
  a.campus_id,
  c.name as campus_name,
  a.asset_code,
  a.name,
  a.category,
  a.utility_group,
  t.code as asset_type_code,
  t.name as asset_type_name,
  a.operational_status,
  a.physical_condition,
  a.verification_status,
  a.data_quality,
  a.installation_date,
  a.last_verified_at,
  a.updated_at,
  st_multi(a.geom)::geometry(MultiPolygon, 4326) as geom
from public.assets a
join public.asset_types t on t.id = a.asset_type_id
join public.campuses c on c.id = a.campus_id
where a.archived_at is null
  and geometrytype(a.geom) in ('POLYGON', 'MULTIPOLYGON');

create or replace view public.v_qgis_survey_benchmarks
with (security_invoker = true) as
select
  a.id as asset_id,
  a.institution_id,
  a.campus_id,
  c.name as campus_name,
  sb.reference_code,
  a.asset_code,
  a.name,
  sb.monument_type,
  sb.elevation_m,
  sb.vertical_datum,
  sb.horizontal_crs,
  sb.survey_method,
  sb.horizontal_accuracy_m,
  sb.vertical_accuracy_m,
  sb.survey_date,
  sb.surveyor_name,
  a.verification_status,
  a.physical_condition,
  a.last_verified_at,
  a.updated_at,
  a.geom::geometry(Point, 4326) as geom
from public.assets a
join public.survey_benchmarks sb
  on sb.asset_id = a.id
  and sb.institution_id = a.institution_id
join public.campuses c on c.id = a.campus_id
where a.archived_at is null
  and geometrytype(a.geom) = 'POINT';

create or replace view public.v_qgis_depth_observations
with (security_invoker = true) as
select
  o.id,
  o.institution_id,
  a.campus_id,
  o.asset_id,
  a.asset_code,
  a.name as asset_name,
  a.utility_group,
  o.depth_m,
  o.measurement_method,
  o.documented_before_covering,
  o.chainage_m,
  o.horizontal_accuracy_m,
  o.notes,
  o.observed_at,
  o.geom::geometry(Point, 4326) as geom
from public.utility_depth_observations o
join public.assets a
  on a.id = o.asset_id
  and a.institution_id = o.institution_id
where a.archived_at is null;

grant select on public.v_qgis_point_assets to authenticated;
grant select on public.v_qgis_linear_utilities to authenticated;
grant select on public.v_qgis_polygon_assets to authenticated;
grant select on public.v_qgis_survey_benchmarks to authenticated;
grant select on public.v_qgis_depth_observations to authenticated;

commit;
