-- =============================================================================
-- BADO University Edition — Demonstration Seed Data (Phase 1)
-- IMPORTANT: All records below belong to a clearly labelled DEMONSTRATION
-- institution using fictional / simulated coordinates and metadata.
-- They do NOT represent verified infrastructure of FUTA or any real university.
-- =============================================================================

begin;

-- 1. Fictional Demonstration University (safe training & testing sandbox)
insert into public.institutions (
  id,
  name,
  slug,
  short_code,
  country_code,
  is_demo,
  is_active
)
values (
  '11111111-1111-4111-8111-111111111101',
  'BADO Demonstration University (Simulated)',
  'bado-demo-university',
  'BDU-DEMO',
  'NG',
  true,
  true
)
on conflict (id) do nothing;

-- 2. Demonstration Campuses (fictional campus boxes — NOT real utility surveys)
insert into public.campuses (
  id,
  institution_id,
  name,
  code,
  description,
  is_demo,
  center_geom,
  default_zoom,
  is_active
)
values
  (
    '22222222-2222-4222-8222-222222222201',
    '11111111-1111-4111-8111-111111111101',
    'Main Demonstration Campus (Simulated)',
    'MAIN_DEMO',
    'Clearly labelled simulated campus used for staff training, workflow verification, and GIS testing. Contains no real underground utility surveys.',
    true,
    ST_SetSRID(ST_MakePoint(5.1385, 7.3042), 4326),
    16,
    true
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    '11111111-1111-4111-8111-111111111101',
    'South Engineering Annex (Simulated)',
    'ANNEX_DEMO',
    'Secondary simulated campus demonstrating multi-campus filtering and campus-scoped permissions.',
    true,
    ST_SetSRID(ST_MakePoint(5.1480, 7.2965), 4326),
    16,
    true
  )
on conflict (id) do nothing;

-- 3. Standard University Works & Infrastructure Departments
insert into public.departments (
  id,
  institution_id,
  name,
  code,
  description,
  is_active
)
values
  (
    '33333333-3333-4333-8333-333333333301',
    '11111111-1111-4111-8111-111111111101',
    'Directorate of Works & Services',
    'WORKS',
    'Central institutional works, civil construction oversight, and infrastructure maintenance.',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    '11111111-1111-4111-8111-111111111101',
    'Water Supply & Sanitation Unit',
    'WATER',
    'Boreholes, pumping stations, elevated storage tanks, water mains, and drainage systems.',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '11111111-1111-4111-8111-111111111101',
    'Electrical & Power Distribution Unit',
    'ELECTRICAL',
    'Power houses, transformers, standby generators, HV/LV underground feeders, and campus lighting.',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    '11111111-1111-4111-8111-111111111101',
    'Campus ICT & Fibre Network Unit',
    'ICT_FIBRE',
    'Campus backbone fibre-optic ducts, distribution cabinets, and telecommunications conduits.',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333305',
    '11111111-1111-4111-8111-111111111101',
    'Physical Planning, Survey & GIS Unit',
    'SURVEY_GIS',
    'Survey benchmarks, geodetic control network, campus base mapping, and spatial QA/QC.',
    true
  )
on conflict (id) do nothing;

-- 4. Simulated Demonstration Assets (Phase 2 — fictional records only)
insert into public.assets (
  id, institution_id, campus_id, department_id, asset_type_id,
  asset_code, name, category, utility_group, description, geom,
  installation_date, operational_status, physical_condition,
  verification_status, data_quality, is_critical_hazard,
  material, diameter_mm, cable_specification, recorded_depth_m,
  depth_measurement_method, documented_before_covering,
  custom_attributes, position_source, capture_method,
  horizontal_accuracy_m, vertical_accuracy_m, fix_quality, source_crs
)
values
  (
    '77777777-7777-4777-8777-777777777701',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333305',
    (select id from public.asset_types where institution_id = '11111111-1111-4111-8111-111111111101' and code = 'SURVEY_BENCHMARK'),
    'BM-DEMO-001',
    'Demo North Gate Primary Benchmark (Simulated)',
    'survey_reference',
    'survey_benchmark',
    'Simulated reinforced concrete brass-cap benchmark monument for training exercises.',
    ST_SetSRID(ST_MakePoint(5.1378, 7.3051), 4326),
    '2022-03-14', 'operational', 'excellent', 'verified', 'verified', false,
    null, null, null, null, null, false,
    '{}'::jsonb, 'external_gnss', 'gps_point', 0.018, 0.025, 'rtk_fixed', 'EPSG:4326'
  ),
  (
    '77777777-7777-4777-8777-777777777702',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333302',
    (select id from public.asset_types where institution_id = '11111111-1111-4111-8111-111111111101' and code = 'BOREHOLE'),
    'BH-DEMO-001',
    'Demo Senate Quad Borehole No. 1 (Simulated)',
    'surface',
    'water',
    'Simulated campus production borehole feeding the elevated tank on Main Demo Campus.',
    ST_SetSRID(ST_MakePoint(5.1389, 7.3045), 4326),
    '2023-06-20', 'operational', 'good', 'verified', 'verified', false,
    null, null, null, null, null, false,
    '{"drilledDepthM":115,"casingDiameterMm":150,"pumpType":"Submersible electric","staticWaterLevelM":18.4,"yieldLps":2.8,"drillingContractor":"Demo Hydro Services (Simulated)"}'::jsonb,
    'smartphone_gps', 'gps_point', 4.2, null, 'autonomous', 'EPSG:4326'
  ),
  (
    '77777777-7777-4777-8777-777777777703',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333303',
    (select id from public.asset_types where institution_id = '11111111-1111-4111-8111-111111111101' and code = 'TRANSFORMER'),
    'TRF-DEMO-001',
    'Demo Science Block 500kVA Substation (Simulated)',
    'surface',
    'electrical',
    'Simulated 11kV/0.415kVA ground-mounted distribution transformer in fenced plinth.',
    ST_SetSRID(ST_MakePoint(5.1397, 7.3038), 4326),
    '2021-11-05', 'operational', 'good', 'submitted', 'unverified', true,
    null, null, null, null, null, false,
    '{"ratingKva":500,"voltageRatio":"11kV / 0.415kV","coolingType":"ONAN (Oil-immersed)","feederName":"Demo Ring Feeder A"}'::jsonb,
    'smartphone_gps', 'gps_point', 5.8, null, 'autonomous', 'EPSG:4326'
  ),
  (
    '77777777-7777-4777-8777-777777777704',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222201',
    '33333333-3333-4333-8333-333333333302',
    (select id from public.asset_types where institution_id = '11111111-1111-4111-8111-111111111101' and code = 'WATER_PIPELINE'),
    'WP-DEMO-001',
    'Demo Borehole-to-Hostel HDPE Rising Main (Simulated)',
    'underground',
    'water',
    'Simulated 110mm HDPE water pipeline documented prior to trench backfilling.',
    ST_SetSRID(ST_GeomFromText('LINESTRING(5.1389 7.3045, 5.1394 7.3042, 5.1402 7.3040)'), 4326),
    '2023-07-02', 'operational', 'good', 'verified', 'verified', false,
    'HDPE PE100', 110, null, 1.20, 'open_trench_tape', true,
    '{"serviceType":"Treated distribution main","pressureClass":"PN16","warningTapeInstalled":"Yes"}'::jsonb,
    'smartphone_gps', 'gps_walk_route', 4.5, null, 'autonomous', 'EPSG:4326'
  )
on conflict (id) do nothing;

insert into public.survey_benchmarks (
  asset_id, institution_id, reference_code, monument_type, elevation_m,
  vertical_datum, horizontal_crs, survey_method, horizontal_accuracy_m,
  vertical_accuracy_m, survey_date, surveyor_name
)
values (
  '77777777-7777-4777-8777-777777777701',
  '11111111-1111-4111-8111-111111111101',
  'BM-DEMO-001',
  'Concrete Pillar with Brass Cap',
  362.4150,
  'EGM2008 Orthometric',
  'EPSG:4326',
  'Dual-Frequency RTK GNSS',
  0.0180,
  0.0250,
  '2022-03-14',
  'Surv. Halima Ibrahim (Demo)'
)
on conflict (asset_id) do nothing;

commit;
