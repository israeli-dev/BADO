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

commit;
