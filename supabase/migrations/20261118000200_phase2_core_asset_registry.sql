-- =============================================================================
-- BADO (Buried Asset Documentation & Operations) — University Edition
-- Migration: 20261118000200_phase2_core_asset_registry.sql
-- Phase 2: Configurable asset types, core PostGIS asset registry, GNSS-ready
--          metadata, survey benchmarks, field observations, verification
--          workflow history, photo & document metadata, private Storage buckets,
--          governance triggers, audit triggers, and forced RLS.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Phase 2 Enumerated Types
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'asset_category') then
    create type public.asset_category as enum (
      'surface',
      'underground',
      'survey_reference'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'utility_group') then
    create type public.utility_group as enum (
      'surface_facility',
      'water',
      'electrical',
      'telecom',
      'drainage_sewer',
      'gas',
      'other_utility',
      'critical_hazard',
      'survey_benchmark'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'operational_status') then
    create type public.operational_status as enum (
      'operational',
      'maintenance',
      'faulty',
      'standby',
      'decommissioned',
      'unknown'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'physical_condition') then
    create type public.physical_condition as enum (
      'excellent',
      'good',
      'fair',
      'poor',
      'critical',
      'unknown'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type public.verification_status as enum (
      'draft',
      'submitted',
      'under_review',
      'verified',
      'rejected',
      'needs_resurvey'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'data_quality') then
    create type public.data_quality as enum (
      'verified',
      'unverified',
      'needs_resurvey',
      'incomplete',
      'outdated'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'gnss_fix_quality') then
    create type public.gnss_fix_quality as enum (
      'autonomous',
      'differential',
      'rtk_float',
      'rtk_fixed',
      'unknown'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'position_source') then
    create type public.position_source as enum (
      'smartphone_gps',
      'external_gnss',
      'total_station',
      'manual_map',
      'gis_import',
      'as_built_drawing',
      'unknown'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'capture_method') then
    create type public.capture_method as enum (
      'gps_point',
      'gps_walk_route',
      'manual_pin',
      'manual_draw',
      'coordinate_entry',
      'geojson_import'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'depth_measurement_method') then
    create type public.depth_measurement_method as enum (
      'open_trench_tape',
      'survey_level',
      'em_locator',
      'gpr',
      'as_built_record',
      'estimated',
      'unknown'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Configurable Institutional Asset Types
-- -----------------------------------------------------------------------------
create table if not exists public.asset_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  category public.asset_category not null,
  utility_group public.utility_group not null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  default_code_prefix text not null default 'AST'
    check (default_code_prefix ~ '^[A-Z0-9]{2,8}$'),
  allowed_geom_types text[] not null default array['Point']::text[]
    check (
      cardinality(allowed_geom_types) >= 1
      and allowed_geom_types <@ array[
        'Point',
        'LineString',
        'MultiLineString',
        'Polygon',
        'MultiPolygon'
      ]::text[]
    ),
  color_hex text not null check (color_hex ~ '^#[0-9a-fA-F]{6}$'),
  icon_key text not null check (char_length(btrim(icon_key)) between 2 and 40),
  line_style text not null default 'solid'
    check (line_style in ('solid', 'dashed', 'dotted')),
  field_schema jsonb not null default '[]'::jsonb
    check (jsonb_typeof(field_schema) = 'array'),
  supports_passport boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, code),
  unique (id, institution_id)
);

create index if not exists idx_asset_types_inst_category
  on public.asset_types (institution_id, category)
  where is_active = true;

-- Template seeder so every university starts with BADO's full infrastructure catalog
-- while retaining independent admin customisation per institution.
create or replace function public.seed_default_asset_types(p_institution_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.asset_types (
    institution_id, category, utility_group, code, name, description,
    default_code_prefix, allowed_geom_types, color_hex, icon_key, line_style,
    field_schema, supports_passport
  )
  values
    -- A. Surface Assets
    (
      p_institution_id, 'surface', 'water', 'BOREHOLE', 'Borehole',
      'Drilled campus groundwater abstraction borehole and wellhead installation.',
      'BH', array['Point'], '#2563eb', 'droplets', 'solid',
      '[
        {"key":"drilledDepthM","label":"Total Drilled Depth (m)","type":"number","unit":"m","min":1,"max":1500},
        {"key":"casingDiameterMm","label":"Casing Diameter (mm)","type":"number","unit":"mm","min":50,"max":1000},
        {"key":"pumpType","label":"Installed Pump Type","type":"select","options":["Submersible electric","Solar submersible","Surface centrifugal","Hand pump","None installed"]},
        {"key":"staticWaterLevelM","label":"Static Water Level (m)","type":"number","unit":"m","min":0,"max":500},
        {"key":"yieldLps","label":"Estimated Yield (L/s)","type":"number","unit":"L/s","min":0,"max":200},
        {"key":"drillingContractor","label":"Drilling Contractor","type":"text"}
      ]'::jsonb,
      true
    ),
    (
      p_institution_id, 'surface', 'water', 'WATER_TANK', 'Water Storage Tank',
      'Elevated steel, overhead polymer, or ground-level concrete water reservoir.',
      'WT', array['Point','Polygon'], '#2563eb', 'droplets', 'solid',
      '[
        {"key":"capacityM3","label":"Storage Capacity (m³)","type":"number","unit":"m³","min":0.5,"max":50000,"required":true},
        {"key":"tankStructure","label":"Structure Type","type":"select","options":["Elevated steel","Ground concrete","Overhead PVC/HDPE","Braithwaite pressed steel"]},
        {"key":"elevationHeightM","label":"Tower / Stand Height (m)","type":"number","unit":"m","min":0,"max":80},
        {"key":"supplySource","label":"Primary Supply Source","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'water', 'PUMPING_STATION', 'Pumping Station',
      'Water booster, transfer, or treatment pumping facility.',
      'PS', array['Point','Polygon'], '#2563eb', 'factory', 'solid',
      '[
        {"key":"pumpCount","label":"Number of Pumps","type":"number","min":1,"max":50},
        {"key":"ratedCapacityM3h","label":"Rated Flow Capacity (m³/h)","type":"number","unit":"m³/h","min":0,"max":10000},
        {"key":"powerSource","label":"Power Source","type":"select","options":["Utility grid","Solar","Diesel generator","Grid + Generator","Grid + Solar"]}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'water', 'VALVE', 'Water Control Valve',
      'Gate, butterfly, air-release, washout, or isolation valve.',
      'VLV', array['Point'], '#2563eb', 'map-pin', 'solid',
      '[
        {"key":"valveType","label":"Valve Type","type":"select","options":["Gate valve","Butterfly valve","Air-release valve","Non-return valve","Washout valve","Fire hydrant"],"required":true},
        {"key":"nominalDiameterMm","label":"Nominal Diameter (mm)","type":"number","unit":"mm","min":15,"max":2000},
        {"key":"normalState","label":"Normal Operating State","type":"select","options":["Normally open","Normally closed","Throttled"]}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'electrical', 'TRANSFORMER', 'Distribution Transformer',
      'Step-down or step-up power transformer substation unit.',
      'TRF', array['Point'], '#ca8a04', 'zap', 'solid',
      '[
        {"key":"ratingKva","label":"Rated Capacity (kVA)","type":"number","unit":"kVA","min":5,"max":100000,"required":true},
        {"key":"voltageRatio","label":"Voltage Ratio","type":"select","options":["11kV / 0.415kV","33kV / 11kV","33kV / 0.415kV","Other"],"required":true},
        {"key":"coolingType","label":"Cooling Type","type":"select","options":["ONAN (Oil-immersed)","ONAF","Dry-type"]},
        {"key":"feederName","label":"Feeder / Substation Name","type":"text"},
        {"key":"manufacturer","label":"Manufacturer","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'electrical', 'POWER_PLANT', 'Power Plant / Substation',
      'Campus central power house, injection substation, or solar farm.',
      'PWR', array['Point','Polygon'], '#ca8a04', 'factory', 'solid',
      '[
        {"key":"installedCapacityMva","label":"Installed Capacity (MVA / MW)","type":"number","min":0.1,"max":1000},
        {"key":"primaryVoltageKv","label":"Primary Voltage (kV)","type":"number","unit":"kV","min":0.4,"max":330},
        {"key":"generationType","label":"Facility Type","type":"select","options":["Injection substation","Diesel power house","Solar PV plant","Hybrid microgrid","Gas plant"]}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'electrical', 'GENERATOR', 'Standby Generator',
      'Backup power generator serving buildings, boreholes, or campus feeders.',
      'GEN', array['Point'], '#ca8a04', 'zap', 'solid',
      '[
        {"key":"ratingKva","label":"Rated Output (kVA)","type":"number","unit":"kVA","min":1,"max":20000,"required":true},
        {"key":"fuelType","label":"Fuel Type","type":"select","options":["Diesel","Natural gas","LPG","Petrol"]},
        {"key":"manufacturer","label":"Manufacturer / Model","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'surface_facility', 'BUILDING', 'Campus Building / Facility',
      'Academic, administrative, residential, laboratory, or utility building.',
      'BLD', array['Point','Polygon'], '#16a34a', 'building-2', 'solid',
      '[
        {"key":"buildingUse","label":"Primary Use","type":"select","options":["Academic / Lecture","Laboratory / Workshop","Administrative","Student Hostel","Staff Quarters","Health Centre","Utility Building","Other"]},
        {"key":"floorCount","label":"Number of Floors","type":"number","min":1,"max":50}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'drainage_sewer', 'MANHOLE', 'Manhole / Surface Access Cover',
      'Surface inspection manhole for sewer, drainage, telecom, or power draw-pits.',
      'MH', array['Point'], '#ea580c', 'layers', 'solid',
      '[
        {"key":"servedUtility","label":"Served Utility","type":"select","options":["Sewer","Storm drainage","Telecom / Fibre","Electrical draw-pit","Water valve chamber"],"required":true},
        {"key":"coverMaterial","label":"Cover Material","type":"select","options":["Cast iron","Reinforced concrete","Ductile iron","Composite","Missing / Damaged"]},
        {"key":"invertDepthM","label":"Measured Chamber Depth (m)","type":"number","unit":"m","min":0.1,"max":30}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'surface', 'telecom', 'DIST_CABINET', 'Distribution Cabinet / Pillar',
      'Above-ground electrical feeder pillar or fibre/ICT distribution cabinet.',
      'CAB', array['Point'], '#9333ea', 'cable', 'solid',
      '[
        {"key":"cabinetDomain","label":"Cabinet Domain","type":"select","options":["Fibre / ICT ODF","Electrical feeder pillar","Streetlight control","CCTV / Security"],"required":true},
        {"key":"capacityWays","label":"Ways / Fibre Port Count","type":"number","min":1,"max":1000}
      ]'::jsonb,
      false
    ),

    -- B. Underground Assets (POINT and LINESTRING capable)
    (
      p_institution_id, 'underground', 'water', 'WATER_PIPELINE', 'Water Pipeline',
      'Buried potable, raw borehole, or fire-service water distribution pipeline.',
      'WP', array['Point','LineString','MultiLineString'], '#2563eb', 'droplets', 'solid',
      '[
        {"key":"serviceType","label":"Water Service Type","type":"select","options":["Treated distribution main","Raw borehole rising main","Secondary service line","Fire hydrant main"],"required":true},
        {"key":"pressureClass","label":"Pressure Rating / Class","type":"text"},
        {"key":"warningTapeInstalled","label":"Marker Tape Installed","type":"select","options":["Yes","No","Unknown"]}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'underground', 'electrical', 'ELECTRICAL_CABLE', 'Underground Electrical Cable',
      'Buried HV or LV armoured power distribution cable or duct bank.',
      'EC', array['Point','LineString','MultiLineString'], '#ca8a04', 'zap', 'solid',
      '[
        {"key":"voltageLevel","label":"Voltage Level","type":"select","options":["415V LV","11kV HV","33kV HV","230V Single-phase","Streetlight circuit"],"required":true},
        {"key":"conductorMaterial","label":"Conductor Material","type":"select","options":["Copper","Aluminium","Unknown"]},
        {"key":"burialProtection","label":"Burial Protection","type":"select","options":["Direct buried armoured","PVC conduit/duct","Concrete cable trench","Direct buried + tiles/tape","Unknown"]}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'underground', 'telecom', 'FIBRE_CABLE', 'Fibre-Optic / Telecom Cable',
      'Buried campus ICT fibre-optic backbone cable or telecom duct.',
      'FOC', array['Point','LineString','MultiLineString'], '#9333ea', 'cable', 'dashed',
      '[
        {"key":"coreCount","label":"Fibre Core Count","type":"select","options":["6-core","12-core","24-core","48-core","96-core","Empty spare duct","Copper multipair"]},
        {"key":"fibreMode","label":"Cable Mode","type":"select","options":["Single-mode (OS2)","Multi-mode","Armoured direct-buried","HDPE sub-duct"]},
        {"key":"linkRouteName","label":"Backbone Link (From → To)","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'underground', 'drainage_sewer', 'DRAINAGE_PIPE', 'Drainage Pipe / Culvert',
      'Subsurface stormwater pipe, box culvert, or covered drainage line.',
      'DRN', array['Point','LineString','MultiLineString'], '#ea580c', 'waves', 'solid',
      '[
        {"key":"conduitShape","label":"Conduit Profile","type":"select","options":["Circular pipe","Box culvert","Covered rectangular channel"]},
        {"key":"outfallTarget","label":"Outfall / Discharge Point","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'underground', 'drainage_sewer', 'SEWER_LINE', 'Sewer Line',
      'Buried foul-water gravity sewer or pumped rising main.',
      'SWR', array['Point','LineString','MultiLineString'], '#ea580c', 'waves', 'dashed',
      '[
        {"key":"flowRegime","label":"Flow Regime","type":"select","options":["Gravity sewer","Pumped rising main","Septic connection"]},
        {"key":"destinationFacility","label":"Treatment / Septic Destination","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'underground', 'other_utility', 'UNDERGROUND_CHAMBER', 'Underground Chamber / Vault',
      'Buried utility vault, septic tank, soakaway, joint box, or splice chamber.',
      'UCH', array['Point','Polygon'], '#64748b', 'layers', 'dotted',
      '[
        {"key":"chamberPurpose","label":"Chamber Purpose","type":"select","options":["Fibre splice chamber","Cable joint bay","Valve vault","Septic tank / Soakaway","Inspection chamber"],"required":true},
        {"key":"dimensionsText","label":"Internal Dimensions (L × W × D)","type":"text"}
      ]'::jsonb,
      false
    ),
    (
      p_institution_id, 'underground', 'critical_hazard', 'GAS_LINE', 'Gas Pipeline / Facility',
      'Authorised laboratory, kitchen, or plant buried gas pipe (high-hazard utility).',
      'GAS', array['Point','LineString','MultiLineString'], '#dc2626', 'triangle-alert', 'solid',
      '[
        {"key":"gasType","label":"Gas Medium","type":"select","options":["LPG","Natural gas","Laboratory specialty gas","Compressed air"],"required":true},
        {"key":"operatingPressureBar","label":"Max Operating Pressure (bar)","type":"number","unit":"bar","min":0,"max":100},
        {"key":"isolationValveRef","label":"Nearest Isolation Valve Reference","type":"text","required":true}
      ]'::jsonb,
      false
    ),

    -- C. Survey & Reference Features
    (
      p_institution_id, 'survey_reference', 'survey_benchmark', 'SURVEY_BENCHMARK', 'Survey Benchmark',
      'Permanent vertical/horizontal survey benchmark monument for campus control.',
      'BM', array['Point'], '#0891b2', 'crosshair', 'solid',
      '[]'::jsonb,
      false
    ),
    (
      p_institution_id, 'survey_reference', 'survey_benchmark', 'GEODETIC_CONTROL', 'Geodetic Control Point',
      'High-precision geodetic traverse or triangulation control monument.',
      'GCP', array['Point'], '#0891b2', 'crosshair', 'solid',
      '[]'::jsonb,
      false
    ),
    (
      p_institution_id, 'survey_reference', 'survey_benchmark', 'GNSS_REF_STATION', 'GNSS / CORS Reference Marker',
      'Continuous or occupied base-station reference point for RTK/differential surveys.',
      'CORS', array['Point'], '#0891b2', 'crosshair', 'solid',
      '[]'::jsonb,
      false
    )
  on conflict (institution_id, code) do nothing;
end;
$$;

-- Automatically seed asset types whenever a new institution is provisioned
create or replace function public.auto_seed_institution_asset_types()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_asset_types(new.id);
  return new;
end;
$$;

drop trigger if exists trg_institutions_auto_asset_types on public.institutions;
create trigger trg_institutions_auto_asset_types
  after insert on public.institutions
  for each row execute function public.auto_seed_institution_asset_types();

-- Backfill any institution already created in Phase 1
do $$
declare
  r record;
begin
  for r in select id from public.institutions loop
    perform public.seed_default_asset_types(r.id);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Core Institutional Asset Registry (`public.assets`)
-- -----------------------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  campus_id uuid not null,
  department_id uuid,
  asset_type_id uuid not null,
  asset_code text not null check (asset_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  category public.asset_category not null,
  utility_group public.utility_group not null,
  description text check (description is null or char_length(description) <= 2000),

  -- Canonical WGS84 (EPSG:4326) spatial geometry (Point, LineString, MultiLineString, Polygon, MultiPolygon)
  geom geometry(Geometry, 4326) not null
    check (
      ST_SRID(geom) = 4326
      and not ST_IsEmpty(geom)
      and ST_IsValid(geom)
      and GeometryType(geom) in (
        'POINT',
        'LINESTRING',
        'MULTILINESTRING',
        'POLYGON',
        'MULTIPOLYGON'
      )
    ),

  installation_date date,
  operational_status public.operational_status not null default 'operational',
  physical_condition public.physical_condition not null default 'good',
  verification_status public.verification_status not null default 'draft',
  data_quality public.data_quality not null default 'unverified',
  is_critical_hazard boolean not null default false,

  -- Underground utility specifications (burial depth is NEVER inferred from GPS altitude;
  -- multi-point variable depths along routes are recorded in asset_observations & Phase 3 utility_depth_observations)
  material text check (material is null or char_length(material) <= 100),
  diameter_mm numeric(8, 2) check (diameter_mm is null or diameter_mm > 0),
  cable_specification text check (cable_specification is null or char_length(cable_specification) <= 160),
  recorded_depth_m numeric(6, 2) check (recorded_depth_m is null or (recorded_depth_m >= 0 and recorded_depth_m <= 100)),
  depth_is_variable boolean not null default true,
  depth_measurement_method public.depth_measurement_method,
  documented_before_covering boolean not null default false,
  direction_description text check (direction_description is null or char_length(direction_description) <= 240),
  construction_record_ref text check (construction_record_ref is null or char_length(construction_record_ref) <= 160),

  -- Dynamic type-specific attributes (validated against asset_types.field_schema)
  custom_attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(custom_attributes) = 'object'),

  -- Benchmark & location reference
  reference_benchmark_id uuid,
  location_reference_text text check (location_reference_text is null or char_length(location_reference_text) <= 300),
  notes text check (notes is null or char_length(notes) <= 2000),

  -- GNSS & Survey-Grade Positioning Readiness (Section 16)
  position_source public.position_source not null default 'smartphone_gps',
  capture_method public.capture_method not null default 'gps_point',
  receiver_model text check (receiver_model is null or char_length(receiver_model) <= 120),
  horizontal_accuracy_m numeric(8, 3) check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  vertical_accuracy_m numeric(8, 3) check (vertical_accuracy_m is null or vertical_accuracy_m >= 0),
  fix_quality public.gnss_fix_quality not null default 'unknown',
  correction_source text check (correction_source is null or char_length(correction_source) <= 120),
  source_crs text not null default 'EPSG:4326' check (char_length(btrim(source_crs)) between 4 and 40),
  measured_at timestamptz not null default now(),
  is_manually_adjusted boolean not null default false,

  -- Offline capture time, verification trace, optimistic concurrency & soft archival
  captured_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_verified_by uuid references public.profiles(id) on delete set null,
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (institution_id, asset_code),
  unique (id, institution_id),

  -- Composite foreign keys guarantee same-institution relational integrity
  constraint assets_campus_same_inst_fk
    foreign key (campus_id, institution_id)
    references public.campuses (id, institution_id)
    on delete restrict,

  constraint assets_department_same_inst_fk
    foreign key (department_id, institution_id)
    references public.departments (id, institution_id)
    on delete set null (department_id),

  constraint assets_type_same_inst_fk
    foreign key (asset_type_id, institution_id)
    references public.asset_types (id, institution_id)
    on delete restrict,

  constraint assets_benchmark_same_inst_fk
    foreign key (reference_benchmark_id, institution_id)
    references public.assets (id, institution_id)
    on delete set null (reference_benchmark_id)
);

create index if not exists idx_assets_inst_campus_active
  on public.assets (institution_id, campus_id)
  where archived_at is null;
create index if not exists idx_assets_inst_category_active
  on public.assets (institution_id, category, utility_group)
  where archived_at is null;
create index if not exists idx_assets_inst_verification_active
  on public.assets (institution_id, verification_status)
  where archived_at is null;
create index if not exists idx_assets_geom_gist
  on public.assets using gist (geom)
  where archived_at is null;
create index if not exists idx_assets_geog_gist
  on public.assets using gist ((geom::geography))
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- 4. Survey & Reference Features (`public.survey_benchmarks` — 1:1 on assets)
-- -----------------------------------------------------------------------------
create table if not exists public.survey_benchmarks (
  asset_id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  reference_code text not null check (reference_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  monument_type text not null check (char_length(btrim(monument_type)) between 2 and 100),
  elevation_m numeric(10, 4),
  vertical_datum text not null check (char_length(btrim(vertical_datum)) between 2 and 80),
  horizontal_crs text not null default 'EPSG:4326'
    check (char_length(btrim(horizontal_crs)) between 4 and 40),
  survey_method text not null check (char_length(btrim(survey_method)) between 2 and 100),
  horizontal_accuracy_m numeric(8, 4) check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  vertical_accuracy_m numeric(8, 4) check (vertical_accuracy_m is null or vertical_accuracy_m >= 0),
  survey_date date,
  surveyor_name text check (surveyor_name is null or char_length(surveyor_name) <= 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, reference_code),
  constraint survey_benchmarks_asset_same_inst_fk
    foreign key (asset_id, institution_id)
    references public.assets (id, institution_id)
    on delete cascade
);

create index if not exists idx_survey_benchmarks_inst_ref
  on public.survey_benchmarks (institution_id, reference_code);

-- -----------------------------------------------------------------------------
-- 5. Asset Field Observations & Immutable Verification History
-- -----------------------------------------------------------------------------
create table if not exists public.asset_observations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  asset_id uuid not null,
  geom geometry(Point, 4326) not null
    check (ST_SRID(geom) = 4326 and ST_IsValid(geom)),
  depth_m numeric(6, 2) check (depth_m is null or (depth_m >= 0 and depth_m <= 100)),
  depth_measurement_method public.depth_measurement_method,
  elevation_m numeric(10, 4),
  position_source public.position_source not null default 'smartphone_gps',
  receiver_model text check (receiver_model is null or char_length(receiver_model) <= 120),
  horizontal_accuracy_m numeric(8, 3) check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  vertical_accuracy_m numeric(8, 3) check (vertical_accuracy_m is null or vertical_accuracy_m >= 0),
  fix_quality public.gnss_fix_quality not null default 'unknown',
  correction_source text check (correction_source is null or char_length(correction_source) <= 120),
  source_crs text not null default 'EPSG:4326',
  measured_at timestamptz not null default now(),
  notes text check (notes is null or char_length(notes) <= 1000),
  observed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, institution_id),
  constraint asset_observations_asset_same_inst_fk
    foreign key (asset_id, institution_id)
    references public.assets (id, institution_id)
    on delete cascade
);

create index if not exists idx_asset_observations_asset
  on public.asset_observations (institution_id, asset_id, measured_at desc);
create index if not exists idx_asset_observations_geog
  on public.asset_observations using gist ((geom::geography));

create table if not exists public.asset_verification_history (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  asset_id uuid not null,
  from_status public.verification_status,
  to_status public.verification_status not null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewer_role public.app_role,
  remarks text not null default '' check (char_length(remarks) <= 1000),
  created_at timestamptz not null default now(),
  constraint asset_verification_history_asset_same_inst_fk
    foreign key (asset_id, institution_id)
    references public.assets (id, institution_id)
    on delete cascade
);

create index if not exists idx_asset_verification_history_asset
  on public.asset_verification_history (institution_id, asset_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 6. Photographs & Technical Documents Metadata (Section 19)
-- -----------------------------------------------------------------------------
create table if not exists public.asset_photos (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  asset_id uuid not null,
  observation_id uuid,
  storage_path text not null unique check (char_length(btrim(storage_path)) between 5 and 512),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  width_px integer check (width_px is null or width_px > 0),
  height_px integer check (height_px is null or height_px > 0),
  photo_kind text not null default 'overview'
    check (photo_kind in (
      'overview',
      'exposed_trench',
      'installation',
      'equipment_label',
      'benchmark_monument',
      'maintenance',
      'other'
    )),
  caption text check (caption is null or char_length(caption) <= 500),
  captured_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint asset_photos_asset_same_inst_fk
    foreign key (asset_id, institution_id)
    references public.assets (id, institution_id)
    on delete cascade,
  constraint asset_photos_observation_same_inst_fk
    foreign key (observation_id, institution_id)
    references public.asset_observations (id, institution_id)
    on delete set null (observation_id)
);

create index if not exists idx_asset_photos_asset
  on public.asset_photos (institution_id, asset_id, created_at desc);

create table if not exists public.asset_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  asset_id uuid not null,
  storage_path text not null unique check (char_length(btrim(storage_path)) between 5 and 512),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'text/csv',
    'application/geo+json',
    'application/json',
    'text/plain'
  )),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 15728640),
  document_kind text not null default 'technical_report'
    check (document_kind in (
      'technical_report',
      'borehole_log',
      'lab_report',
      'as_built_drawing',
      'geojson_dataset',
      'csv_register',
      'other'
    )),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  description text check (description is null or char_length(description) <= 500),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint asset_documents_asset_same_inst_fk
    foreign key (asset_id, institution_id)
    references public.assets (id, institution_id)
    on delete cascade
);

create index if not exists idx_asset_documents_asset
  on public.asset_documents (institution_id, asset_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 7. Governance, Verification & Audit Triggers
-- -----------------------------------------------------------------------------

create or replace function public.enforce_asset_governance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
begin
  -- Server-side/seed migrations run without auth.uid(); enforce role checks for authenticated clients
  if v_actor is not null then
    v_role := public.current_user_role(new.institution_id);
    if v_role is null then
      raise exception 'Active institutional membership is required.'
        using errcode = '42501';
    end if;

    -- Benchmark creation/modification requires admin or surveyor_gis
    if new.category = 'survey_reference'
       and v_role not in ('admin', 'surveyor_gis') then
      raise exception 'Only Administrators and Surveyor/GIS Officers may create or edit survey reference features.'
        using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      -- Newly captured assets must never start as verified/rejected/under_review/needs_resurvey
      if new.verification_status not in ('draft', 'submitted') then
        raise exception 'Newly registered assets must begin as draft or submitted, not %.', new.verification_status
          using errcode = '23514';
      end if;
      new.created_by := v_actor;
      new.updated_by := v_actor;
      new.last_verified_at := null;
      new.last_verified_by := null;
      new.archived_at := null;
      new.archived_by := null;
      new.version := 1;
    else
      -- Preserve immutable ownership/audit fields
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      new.updated_by := v_actor;
      new.version := old.version + 1;

      -- Guard verification status transitions
      if new.verification_status is distinct from old.verification_status then
        if new.verification_status in ('verified', 'rejected') then
          if v_role not in ('admin', 'supervisor') then
            raise exception 'Only Administrators and Supervisors can mark an asset as %.', new.verification_status
              using errcode = '42501';
          end if;
        elsif new.verification_status in ('under_review', 'needs_resurvey') then
          if v_role not in ('admin', 'supervisor', 'surveyor_gis') then
            raise exception 'Insufficient permissions to change verification status to %.', new.verification_status
              using errcode = '42501';
          end if;
        end if;
      end if;

      -- Guard soft archival
      if new.archived_at is distinct from old.archived_at then
        if v_role not in ('admin', 'supervisor') then
          raise exception 'Only Administrators and Supervisors can archive or restore assets.'
            using errcode = '42501';
        end if;
        new.archived_by := case when new.archived_at is not null then v_actor else null end;
      end if;
    end if;
  end if;

  -- Synchronise data_quality and verification timestamps consistently
  if new.verification_status = 'verified' then
    new.data_quality := 'verified';
    if tg_op = 'INSERT' or old.verification_status is distinct from 'verified' then
      new.last_verified_at := coalesce(new.last_verified_at, now());
      new.last_verified_by := coalesce(v_actor, new.last_verified_by);
    end if;
  elsif new.verification_status = 'needs_resurvey' then
    new.data_quality := 'needs_resurvey';
  elsif new.data_quality = 'verified' then
    new.data_quality := 'unverified';
  end if;

  return new;
end;
$$;

create or replace function public.log_asset_verification_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
begin
  if tg_op = 'INSERT' or new.verification_status is distinct from old.verification_status then
    if v_actor is not null then
      v_role := public.current_user_role(new.institution_id);
    end if;

    insert into public.asset_verification_history (
      institution_id,
      asset_id,
      from_status,
      to_status,
      reviewer_id,
      reviewer_role,
      remarks
    )
    values (
      new.institution_id,
      new.id,
      case when tg_op = 'UPDATE' then old.verification_status else null end,
      new.verification_status,
      coalesce(v_actor, new.updated_by, new.created_by),
      v_role,
      case
        when tg_op = 'INSERT' then format('Initial registration as %s.', new.verification_status)
        else format('Status changed from %s to %s.', old.verification_status, new.verification_status)
      end
    );
  end if;
  return new;
end;
$$;

-- Attach triggers
drop trigger if exists trg_asset_types_updated_at on public.asset_types;
create trigger trg_asset_types_updated_at
  before update on public.asset_types
  for each row execute function public.set_updated_at();

drop trigger if exists trg_asset_types_immutable_institution on public.asset_types;
create trigger trg_asset_types_immutable_institution
  before update on public.asset_types
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_assets_updated_at on public.assets;
create trigger trg_assets_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_assets_immutable_institution on public.assets;
create trigger trg_assets_immutable_institution
  before update on public.assets
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_assets_governance on public.assets;
create trigger trg_assets_governance
  before insert or update on public.assets
  for each row execute function public.enforce_asset_governance();

drop trigger if exists trg_assets_verification_history on public.assets;
create trigger trg_assets_verification_history
  after insert or update on public.assets
  for each row execute function public.log_asset_verification_transition();

drop trigger if exists trg_survey_benchmarks_updated_at on public.survey_benchmarks;
create trigger trg_survey_benchmarks_updated_at
  before update on public.survey_benchmarks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_survey_benchmarks_immutable_institution on public.survey_benchmarks;
create trigger trg_survey_benchmarks_immutable_institution
  before update on public.survey_benchmarks
  for each row execute function public.prevent_institution_reassignment();

drop trigger if exists trg_verification_history_immutable on public.asset_verification_history;
create trigger trg_verification_history_immutable
  before update or delete on public.asset_verification_history
  for each row execute function public.prevent_audit_log_mutation();

-- Attach institutional audit triggers
drop trigger if exists trg_audit_asset_types on public.asset_types;
create trigger trg_audit_asset_types
  after insert or update on public.asset_types
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_assets on public.assets;
create trigger trg_audit_assets
  after insert or update or delete on public.assets
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_asset_photos on public.asset_photos;
create trigger trg_audit_asset_photos
  after insert or delete on public.asset_photos
  for each row execute function public.record_institutional_audit();

drop trigger if exists trg_audit_asset_documents on public.asset_documents;
create trigger trg_audit_asset_documents
  after insert or delete on public.asset_documents
  for each row execute function public.record_institutional_audit();

-- RPC for verification review so reviewer remarks are captured atomically
create or replace function public.review_asset_verification(
  p_institution_id uuid,
  p_asset_id uuid,
  p_to_status public.verification_status,
  p_remarks text default ''
)
returns public.assets
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_asset public.assets;
  v_clean_remarks text := btrim(coalesce(p_remarks, ''));
begin
  if p_to_status in ('rejected', 'needs_resurvey') and char_length(v_clean_remarks) < 4 then
    raise exception 'Please provide clear review remarks (at least 4 characters) when marking an asset as %.', p_to_status
      using errcode = '22023';
  end if;

  update public.assets
  set verification_status = p_to_status
  where id = p_asset_id
    and institution_id = p_institution_id
    and archived_at is null
  returning * into v_asset;

  if v_asset.id is null then
    raise exception 'Asset not found or you lack permission to review it.'
      using errcode = '42501';
  end if;

  -- Attach explicit reviewer remarks to the latest history entry when provided
  if char_length(v_clean_remarks) > 0 then
    insert into public.asset_verification_history (
      institution_id,
      asset_id,
      from_status,
      to_status,
      reviewer_id,
      reviewer_role,
      remarks
    )
    values (
      p_institution_id,
      p_asset_id,
      p_to_status,
      p_to_status,
      auth.uid(),
      public.current_user_role(p_institution_id),
      v_clean_remarks
    );
  end if;

  return v_asset;
end;
$$;

grant execute on function public.review_asset_verification(
  uuid, uuid, public.verification_status, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Forced Row Level Security (RLS) on All Phase 2 Tables
-- -----------------------------------------------------------------------------
alter table public.asset_types enable row level security;
alter table public.asset_types force row level security;

alter table public.assets enable row level security;
alter table public.assets force row level security;

alter table public.survey_benchmarks enable row level security;
alter table public.survey_benchmarks force row level security;

alter table public.asset_observations enable row level security;
alter table public.asset_observations force row level security;

alter table public.asset_verification_history enable row level security;
alter table public.asset_verification_history force row level security;

alter table public.asset_photos enable row level security;
alter table public.asset_photos force row level security;

alter table public.asset_documents enable row level security;
alter table public.asset_documents force row level security;

-- 8.1 asset_types: institutional members read; admins configure
create policy asset_types_select_member
  on public.asset_types for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy asset_types_insert_admin
  on public.asset_types for insert
  to authenticated
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

create policy asset_types_update_admin
  on public.asset_types for update
  to authenticated
  using (public.has_institution_role(institution_id, array['admin'::public.app_role]))
  with check (public.has_institution_role(institution_id, array['admin'::public.app_role]));

-- 8.2 assets: permitted campus members view non-archived (read_only hides other users' raw drafts)
create policy assets_select_permitted
  on public.assets for select
  to authenticated
  using (
    archived_at is null
    and institution_id in (select public.current_user_institution_ids())
    and public.has_campus_access(institution_id, campus_id)
    and (
      verification_status <> 'draft'
      or created_by = auth.uid()
      or public.has_institution_role(
        institution_id,
        array['admin'::public.app_role, 'supervisor'::public.app_role]
      )
    )
  );

create policy assets_insert_operator
  on public.assets for insert
  to authenticated
  with check (
    public.has_campus_access(institution_id, campus_id)
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

create policy assets_update_permitted
  on public.assets for update
  to authenticated
  using (
    public.has_campus_access(institution_id, campus_id)
    and (
      public.has_institution_role(
        institution_id,
        array[
          'admin'::public.app_role,
          'supervisor'::public.app_role,
          'surveyor_gis'::public.app_role
        ]
      )
      or (
        public.has_institution_role(institution_id, array['field_technician'::public.app_role])
        and created_by = auth.uid()
        and verification_status in ('draft', 'rejected', 'needs_resurvey')
      )
    )
  )
  with check (public.has_campus_access(institution_id, campus_id));

-- 8.3 survey_benchmarks: institutional members read; admins & surveyors manage
create policy survey_benchmarks_select_member
  on public.survey_benchmarks for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy survey_benchmarks_insert_surveyor
  on public.survey_benchmarks for insert
  to authenticated
  with check (
    public.has_institution_role(
      institution_id,
      array['admin'::public.app_role, 'surveyor_gis'::public.app_role]
    )
  );

create policy survey_benchmarks_update_surveyor
  on public.survey_benchmarks for update
  to authenticated
  using (
    public.has_institution_role(
      institution_id,
      array['admin'::public.app_role, 'surveyor_gis'::public.app_role]
    )
  )
  with check (
    public.has_institution_role(
      institution_id,
      array['admin'::public.app_role, 'surveyor_gis'::public.app_role]
    )
  );

-- 8.4 asset_observations: members read; field/survey/supervision staff insert
create policy asset_observations_select_member
  on public.asset_observations for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy asset_observations_insert_operator
  on public.asset_observations for insert
  to authenticated
  with check (
    public.has_institution_role(
      institution_id,
      array[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'field_technician'::public.app_role,
        'surveyor_gis'::public.app_role
      ]
    )
  );

-- 8.5 asset_verification_history: institutional members read; reviewers append notes
create policy verification_history_select_member
  on public.asset_verification_history for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy verification_history_insert_reviewer
  on public.asset_verification_history for insert
  to authenticated
  with check (
    public.has_institution_role(
      institution_id,
      array[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'surveyor_gis'::public.app_role
      ]
    )
  );

-- 8.6 asset_photos & asset_documents: members read; operational staff upload
create policy asset_photos_select_member
  on public.asset_photos for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy asset_photos_insert_operator
  on public.asset_photos for insert
  to authenticated
  with check (
    public.has_institution_role(
      institution_id,
      array[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'field_technician'::public.app_role,
        'surveyor_gis'::public.app_role
      ]
    )
  );

create policy asset_documents_select_member
  on public.asset_documents for select
  to authenticated
  using (institution_id in (select public.current_user_institution_ids()));

create policy asset_documents_insert_operator
  on public.asset_documents for insert
  to authenticated
  with check (
    public.has_institution_role(
      institution_id,
      array[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'field_technician'::public.app_role,
        'surveyor_gis'::public.app_role
      ]
    )
  );

-- -----------------------------------------------------------------------------
-- 9. Private Supabase Storage Buckets & Path-Scoped RLS (`{institution_id}/...`)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'asset-photos',
    'asset-photos',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'asset-documents',
    'asset-documents',
    false,
    15728640,
    array[
      'application/pdf',
      'text/csv',
      'application/geo+json',
      'application/json',
      'text/plain'
    ]
  )
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy storage_asset_media_select_member
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('asset-photos', 'asset-documents')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and ((storage.foldername(name))[1])::uuid in (select public.current_user_institution_ids())
  );

create policy storage_asset_media_insert_operator
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('asset-photos', 'asset-documents')
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and public.has_institution_role(
      ((storage.foldername(name))[1])::uuid,
      array[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'field_technician'::public.app_role,
        'surveyor_gis'::public.app_role
      ]
    )
  );

commit;
