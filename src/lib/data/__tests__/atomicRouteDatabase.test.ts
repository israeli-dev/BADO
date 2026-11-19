// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import foundation from '../../../../supabase/migrations/20261118000100_phase1_institutional_foundation.sql?raw';
import assets from '../../../../supabase/migrations/20261118000200_phase2_core_asset_registry.sql?raw';
import gis from '../../../../supabase/migrations/20261118000300_phase3_gis_and_linear_routes.sql?raw';
import atomic from '../../../../supabase/migrations/20261118000400_atomic_route_writes.sql?raw';
import replay from '../../../../supabase/migrations/20261118000500_idempotent_route_replay.sql?raw';
import point from '../../../../supabase/migrations/20261118000600_atomic_point_assets.sql?raw';
import assignment from '../../../../supabase/migrations/20261118000700_assign_confirmed_member.sql?raw';
import childScope from '../../../../supabase/migrations/20261118000800_asset_child_media_scope.sql?raw';
import hardened from '../../../../supabase/migrations/20261118000900_harden_replay_receipts.sql?raw';
import digCheck from '../../../../supabase/migrations/20261118001000_check_before_dig.sql?raw';
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { BadoLocalDatabase } from '@/lib/db/badoDb';
import { enqueueSyncOperation, retrySyncOperation } from '@/lib/sync/syncQueue';
import { processRouteQueue } from '@/lib/sync/routeReplay';

// PGlite exercises real PostgreSQL and PostGIS in-process. Minimal Supabase auth
// and storage shims are used; a live Supabase integration test is still required.
const inst = '10000000-0000-4000-8000-000000000001';
const campus = '10000000-0000-4000-8000-000000000002';
const type = '10000000-0000-4000-8000-000000000003';
const admin = '10000000-0000-4000-8000-000000000004';
const reader = '10000000-0000-4000-8000-000000000005';
const asset = '10000000-0000-4000-8000-000000000006';
const vertex1 = '10000000-0000-4000-8000-000000000007';
const vertex2 = '10000000-0000-4000-8000-000000000008';
const assetPayload = {
  id: asset, institution_id: inst, campus_id: campus, asset_type_id: type, asset_code: 'WP-TEST', name: 'Test Route',
  category: 'underground', utility_group: 'water', geom: 'SRID=4326;LINESTRING(5.138 7.304,5.139 7.304)',
  operational_status: 'operational', physical_condition: 'good', verification_status: 'draft', data_quality: 'incomplete',
  is_critical_hazard: false, depth_is_variable: true, documented_before_covering: false, custom_attributes: {},
  position_source: 'manual_map', capture_method: 'manual_draw', fix_quality: 'unknown', source_crs: 'EPSG:4326',
  measured_at: '2026-01-01T00:00:00Z', is_manually_adjusted: true, captured_at: '2026-01-01T00:00:00Z',
};
const vertices = [vertex1, vertex2].map((id, i) => ({ id, institution_id: inst, asset_id: asset, part_index: 0, sequence_index: i, vertex_kind: 'track_point', geom: `SRID=4326;POINT(${5.138 + i * .001} 7.304)`, fix_quality: 'unknown', recorded_at: '2026-01-01T00:00:00Z' }));
let db: PGlite;

describe('atomic route writes with PostgreSQL RLS', () => {
  beforeAll(async () => {
    db = await PGlite.create({ extensions: { postgis } });
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid, bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;`);
    for (const migration of [foundation, assets, gis, atomic, replay, point, assignment, childScope, hardened, digCheck]) {
      // PGlite provides gen_random_uuid natively, but not the pgcrypto extension package.
      await db.exec(migration.replace('create extension if not exists pgcrypto;', ''));
    }
    await db.exec(`grant usage on schema public, auth, storage to authenticated;
      alter table storage.objects enable row level security;
      alter table storage.objects force row level security;
      grant select, insert on storage.objects to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      revoke insert, update, delete on public.sync_idempotency_ledger from authenticated;
      revoke all on public.sync_replay_receipts from authenticated;
      insert into auth.users (id,email) values ('${admin}','admin@test.example'), ('${reader}','reader@test.example');
      insert into public.institutions (id,name,slug,short_code) values ('${inst}','Test Institution','test-inst','TEST');
      insert into public.campuses (id,institution_id,name,code) values ('${campus}','${inst}','Main campus','MAIN');
      insert into public.asset_types (id,institution_id,category,utility_group,code,name,allowed_geom_types,color_hex,icon_key) values ('${type}','${inst}','underground','water','TEST_PIPE','Test Pipe',array['LineString'],'#000000','pipe');
      insert into public.user_institutions (user_id,institution_id,role) values ('${admin}','${inst}','admin'), ('${reader}','${inst}','read_only');
      set role authenticated; select set_config('test.uid','${admin}',false);`);
  }, 60000);
  afterAll(async () => { await db?.close(); });
  it('checks actual route geometry under caller RLS and validates inputs', async () => {
    const routeId = '10000000-0000-4000-8000-000000000099';
    await db.exec(`reset role;
      insert into public.assets(id,institution_id,campus_id,asset_type_id,asset_code,name,category,utility_group,geom,verification_status,created_by)
      values ('${routeId}','${inst}','${campus}','${type}','DIG-TEST','Dig test route','underground','water',st_geomfromtext('LINESTRING(5.138 7.304,5.139 7.304)',4326),'submitted','${admin}');
      set role authenticated; select set_config('test.uid','${reader}',false);`);
    const sql = 'select public.check_before_dig($1,$2,$3::jsonb,$4) as report';
    const pt = JSON.stringify({type:'Point',coordinates:[5.1385,7.304]});
    const result = await db.query<{report: {results: {id: string, distanceM: number}[], truncated: boolean}}>(sql, [inst,campus,pt,5]);
    expect(result.rows[0]!.report.results.some(r => r.id === routeId && r.distanceM < 1)).toBe(true);
    expect(result.rows[0]!.report.truncated).toBe(false);
    const polygon = JSON.stringify({type:'Polygon',coordinates:[[[5.1384,7.3039],[5.1386,7.3039],[5.1386,7.3041],[5.1384,7.3041],[5.1384,7.3039]]]});
    expect((await db.query<{report:{results:{id:string}[]}}>(sql,[inst,campus,polygon,0])).rows[0]!.report.results.some(r=>r.id===routeId)).toBe(true);
    await expect(db.query(sql,[inst,campus,pt,501])).rejects.toThrow(/Invalid/);
    await expect(db.query(sql,[inst,'10000000-0000-4000-8000-000000000123',pt,5])).rejects.toThrow(/accessible/);
    await db.exec(`reset role; select set_config('test.uid','${admin}',false); update public.assets set archived_at=now() where id='${routeId}'; set role authenticated;`);
  });
  it('allows only an institution admin to assign a confirmed account as campus-scoped read-only, without replacing existing membership', async () => {
    const target = '10000000-0000-4000-8000-000000000081';
    const unconfirmed = '10000000-0000-4000-8000-000000000082';
    const otherInstitution = '10000000-0000-4000-8000-000000000083';
    const otherCampus = '10000000-0000-4000-8000-000000000084';
    await db.exec(`reset role;
      insert into auth.users(id,email,email_confirmed_at) values ('${target}','new@test.example',now()), ('${unconfirmed}','unconfirmed@test.example',null);
      insert into public.institutions(id,name,slug,short_code) values ('${otherInstitution}','Other Institution','other-test','OTHER');
      insert into public.campuses(id,institution_id,name,code) values ('${otherCampus}','${otherInstitution}','Other campus','OTHER');
      set role authenticated; select set_config('test.uid','${reader}',false);`);
    const sql = 'select public.assign_confirmed_member($1,$2,$3) as id';
    await expect(db.query(sql, [inst, campus, 'new@test.example'])).rejects.toThrow(/administrator/);
    await db.exec(`select set_config('test.uid','${admin}',false)`);
    await expect(db.query(sql, [otherInstitution, otherCampus, 'new@test.example'])).rejects.toThrow(/administrator/);
    await expect(db.query(sql, [inst, otherCampus, 'new@test.example'])).rejects.toThrow(/active campus/);
    await expect(db.query(sql, [inst, campus, 'unconfirmed@test.example'])).rejects.toThrow(/confirmed account/);
    await expect(db.query(sql, [inst, campus, 'missing@test.example'])).rejects.toThrow(/confirmed account/);
    const result = await db.query<{ id: string }>(sql, [inst, campus, ' NEW@test.example ']);
    const member = await db.query<{ role: string; allowed_campus_ids: string[]; invited_by: string }>('select role, allowed_campus_ids, invited_by from public.user_institutions where id=$1', [result.rows[0]?.id]);
    expect(member.rows[0]).toMatchObject({ role: 'read_only', allowed_campus_ids: [campus], invited_by: admin });
    await expect(db.query(sql, [inst, campus, 'new@test.example'])).rejects.toThrow(/already has a membership/);
    const audit = await db.query<{ n: number }>("select count(*)::int n from public.audit_logs where entity_type='user_institutions' and entity_id=$1 and actor_user_id=$2 and action='insert'", [result.rows[0]?.id, admin]);
    expect(audit.rows[0]?.n).toBe(1);
  });
  it('enforces parent campus and draft visibility for child records and media paths', async () => {
    const campus2 = '10000000-0000-4000-8000-000000000101';
    const tech = '10000000-0000-4000-8000-000000000102';
    const visibleAsset = '10000000-0000-4000-8000-000000000103';
    const otherAsset = '10000000-0000-4000-8000-000000000104';
    const draftAsset = '10000000-0000-4000-8000-000000000105';
    await db.exec(`reset role;
      insert into auth.users(id,email) values ('${tech}','tech@test.example');
      insert into public.campuses(id,institution_id,name,code) values ('${campus2}','${inst}','Second campus','SECOND');
      update public.user_institutions set allowed_campus_ids=array['${campus}'::uuid] where user_id='${reader}';
      insert into public.user_institutions(user_id,institution_id,role,allowed_campus_ids) values ('${tech}','${inst}','field_technician',array['${campus}'::uuid]);
      set role authenticated; select set_config('test.uid','${admin}',false);`);
    for (const [assetId, campusId, status, code] of [[visibleAsset, campus, 'submitted', 'SCOPE-A'], [otherAsset, campus2, 'submitted', 'SCOPE-B'], [draftAsset, campus, 'draft', 'SCOPE-C']]) {
      const payload = { ...assetPayload, id: assetId, campus_id: campusId, asset_code: code, verification_status: status };
      const routeVertices = vertices.map((v) => ({ ...v, id: crypto.randomUUID(), asset_id: assetId }));
      await db.query('select public.create_linear_route_atomic($1,$2,$3,$4,$5)', [inst, payload, routeVertices, [], []]);
      const photoPath = `${inst}/${campusId}/${assetId}/photos/test.jpg`;
      const docPath = `${inst}/${campusId}/${assetId}/docs/test.pdf`;
      await db.query("insert into public.asset_photos(id,institution_id,asset_id,storage_path,file_name,mime_type,file_size_bytes,photo_kind) values ($1,$2,$3,$4,'test.jpg','image/jpeg',3,'other')", [crypto.randomUUID(), inst, assetId, photoPath]);
      await db.query("insert into public.asset_documents(id,institution_id,asset_id,storage_path,file_name,mime_type,file_size_bytes,title) values ($1,$2,$3,$4,'test.pdf','application/pdf',3,'Test')", [crypto.randomUUID(), inst, assetId, docPath]);
      await db.query("insert into public.asset_observations(id,institution_id,asset_id,geom) values ($1,$2,$3,'SRID=4326;POINT(5.138 7.304)')", [crypto.randomUUID(), inst, assetId]);
      await db.query("insert into public.survey_benchmarks(asset_id,institution_id,reference_code,monument_type,vertical_datum,horizontal_crs,survey_method) values ($1,$2,$3,'Concrete','Datum','EPSG:4326','Survey')", [assetId, inst, code]);
      await db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos',$2),($3,'asset-documents',$4)", [crypto.randomUUID(), photoPath, crypto.randomUUID(), docPath]);
    }
    await db.exec(`select set_config('test.uid','${reader}',false)`);
    for (const table of ['asset_photos', 'asset_documents', 'asset_observations', 'survey_benchmarks', 'asset_verification_history', 'utility_route_vertices']) {
      const result = await db.query<{ asset_id: string }>(`select distinct asset_id from public.${table} where asset_id = any($1::uuid[])`, [[visibleAsset, otherAsset, draftAsset]]);
      expect(result.rows.map(r => r.asset_id)).toEqual([visibleAsset]);
    }
    const media = await db.query<{ name: string }>('select name from storage.objects where name like $1 order by name', [`${inst}/%`]);
    expect(media.rows).toHaveLength(2);
    expect(media.rows.every(r => r.name.includes(visibleAsset))).toBe(true);
    await expect(db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos',$2)", [crypto.randomUUID(), `${inst}/${campus}/${visibleAsset}/photos/new.jpg`])).rejects.toThrow();
    await db.exec(`select set_config('test.uid','${tech}',false)`);
    await expect(db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos',$2)", [crypto.randomUUID(), `${inst}/${campus2}/${otherAsset}/photos/new.jpg`])).rejects.toThrow();
    await expect(db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos',$2)", [crypto.randomUUID(), `${inst}/${campus}/${draftAsset}/photos/new.jpg`])).rejects.toThrow();
    await expect(db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos',$2)", [crypto.randomUUID(), `${inst}/${campus}/${otherAsset}/photos/new.jpg`])).rejects.toThrow();
    await expect(db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos','bad/../../bad')", [crypto.randomUUID()])).rejects.toThrow();
    await expect(db.query("insert into public.asset_documents(id,institution_id,asset_id,storage_path,file_name,mime_type,file_size_bytes,title) values ($1,$2,$3,$4,'bad.pdf','application/pdf',3,'Test')", [crypto.randomUUID(), inst, visibleAsset, `${inst}/${campus2}/${otherAsset}/docs/bad.pdf`])).rejects.toThrow();
    await db.query("insert into storage.objects(id,bucket_id,name) values ($1,'asset-photos',$2)", [crypto.randomUUID(), `${inst}/${campus}/${visibleAsset}/photos/allowed.jpg`]);
    await db.exec(`select set_config('test.uid','${admin}',false)`);
  });
  it('prevents direct receipt fabrication and refuses to trust legacy keys', async () => {
    const legacyId = '40000000-0000-4000-8000-000000000001';
    const target = '40000000-0000-4000-8000-000000000002';
    const payload = { assetInsert: { ...assetPayload, id: target, asset_code: 'LEGACY-POINT', geom: 'SRID=4326;POINT(5.138 7.304)' }, benchmarkInsert: null };
    const insertSql = "insert into public.sync_idempotency_ledger(mutation_id,institution_id,user_id,entity_type,entity_id,operation,response_snapshot) values ($1,$2,$3,'point_assets',$4,'create', '{}')";
    await expect(db.query(insertSql, [legacyId, inst, admin, target])).rejects.toThrow();
    await expect(db.query("insert into public.sync_replay_receipts(mutation_id,institution_id,user_id,entity_type,entity_id,operation,response_snapshot) values ($1,$2,$3,'point_assets',$4,'create','{}')", [legacyId, inst, admin, target])).rejects.toThrow();
    await expect(db.query('select * from public.sync_replay_receipts')).rejects.toThrow();
    await expect(db.query("update public.sync_replay_receipts set response_snapshot='{}'" )).rejects.toThrow();
    await expect(db.query('select public.replay_linear_route_mutation($1,$2,$3,$4,$5,$6,$7)', [legacyId, inst, admin, target, null, {}, null])).rejects.toThrow(/Invalid route replay request/);
    const membership = await db.query<{ can_assume: boolean }>("select pg_has_role('authenticated', 'bado_sync_replay', 'MEMBER') as can_assume");
    expect(membership.rows[0]?.can_assume).toBe(false);
    await db.exec('reset role');
    const flags = await db.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>("select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname='bado_sync_replay'");
    expect(flags.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
    await db.query(insertSql, [legacyId, inst, admin, target]);
    await db.exec(`set role authenticated; select set_config('test.uid','${admin}',false);`);
    await expect(db.query('select public.replay_point_asset_mutation($1,$2,$3,$4,$5)', [legacyId, inst, admin, target, payload])).rejects.toMatchObject({ code: '40001' });
    expect((await db.query('select id from public.assets where id=$1', [target])).rows).toHaveLength(0);
    await db.exec('reset role');
    expect((await db.query('select mutation_id from public.sync_replay_receipts where mutation_id=$1', [legacyId])).rows).toHaveLength(0);
    await db.exec('set role authenticated');
  });
  it('enforces the original actor and campus RLS inside privileged replay entry points', async () => {
    const tech = '10000000-0000-4000-8000-000000000102';
    const campus2 = '10000000-0000-4000-8000-000000000101';
    const target = '40000000-0000-4000-8000-000000000003';
    const mutation = '40000000-0000-4000-8000-000000000004';
    const point = { ...assetPayload, id: target, campus_id: campus2, asset_code: 'CROSS-CAMPUS', geom: 'SRID=4326;POINT(5.138 7.304)' };
    const sql = 'select public.replay_point_asset_mutation($1,$2,$3,$4,$5) as result';
    await db.exec(`select set_config('test.uid','${tech}',false)`);
    await expect(db.query(sql, [mutation, inst, admin, target, { assetInsert: point, benchmarkInsert: null }])).rejects.toThrow(/original capture user/);
    await expect(db.query(sql, [mutation, inst, tech, target, { assetInsert: point, benchmarkInsert: null }])).rejects.toThrow();
    await db.exec('reset role');
    expect((await db.query('select mutation_id from public.sync_replay_receipts where mutation_id=$1', [mutation])).rows).toHaveLength(0);
    await db.exec('set role authenticated');
    const allowed = { ...point, campus_id: campus, asset_code: 'TECH-POINT' };
    expect((await db.query<{ result: { duplicate: boolean } }>(sql, [mutation, inst, tech, target, { assetInsert: allowed, benchmarkInsert: null }])).rows[0]?.result.duplicate).toBe(false);
    expect((await db.query<{ result: { duplicate: boolean } }>(sql, [mutation, inst, tech, target, { assetInsert: allowed, benchmarkInsert: null }])).rows[0]?.result.duplicate).toBe(true);
    await db.exec(`select set_config('test.uid','${admin}',false)`);
  });
  it('replays a point atomically and idempotently, including rollback on invalid benchmark', async () => {
    const pointId = '10000000-0000-4000-8000-000000000091';
    const mutation = '10000000-0000-4000-8000-000000000092';
    const pointPayload = { ...assetPayload, id: pointId, asset_code: 'POINT-ONE', geom: 'SRID=4326;POINT(5.138 7.304)' };
    const payload = { assetInsert: pointPayload, benchmarkInsert: null };
    const sql = 'select public.replay_point_asset_mutation($1,$2,$3,$4,$5) as result';
    const first = await db.query<{ result: { duplicate: boolean } }>(sql, [mutation, inst, admin, pointId, payload]);
    expect(first.rows[0]?.result.duplicate).toBe(false);
    const retry = await db.query<{ result: { duplicate: boolean } }>(sql, [mutation, inst, admin, pointId, payload]);
    expect(retry.rows[0]?.result.duplicate).toBe(true);
    await expect(db.query(sql, [mutation, inst, admin, pointId, { ...payload, assetInsert: { ...pointPayload, name: 'changed' } }])).rejects.toThrow();
    const invalidId = '10000000-0000-4000-8000-000000000093';
    const invalidMutation = '10000000-0000-4000-8000-000000000094';
    const invalid = { assetInsert: { ...pointPayload, id: invalidId, asset_code: 'POINT-TWO', category: 'survey_reference' }, benchmarkInsert: null };
    await expect(db.query(sql, [invalidMutation, inst, admin, invalidId, invalid])).rejects.toThrow();
    const rows = await db.query('select id from public.assets where id = $1', [invalidId]);
    expect(rows.rows).toHaveLength(0);
    await db.exec('reset role');
    const receipt = await db.query('select mutation_id from public.sync_replay_receipts where mutation_id = $1', [invalidMutation]);
    expect(receipt.rows).toHaveLength(0);
    await db.exec('set role authenticated');
    await db.exec(`select set_config('test.uid','${reader}',false)`);
    await expect(db.query(sql, ['10000000-0000-4000-8000-000000000095', inst, reader, invalidId, { assetInsert: { ...pointPayload, id: invalidId, asset_code: 'POINT-THREE' }, benchmarkInsert: null }])).rejects.toThrow();
    await db.exec(`select set_config('test.uid','${admin}',false)`);
  });
  it('rolls back the whole create when a child fails and preserves RLS', async () => {
    const invalid = [{ ...vertices[0], vertex_kind: 'invalid' }, vertices[1]];
    await expect(db.query('select public.create_linear_route_atomic($1,$2,$3,$4,$5)', [inst, assetPayload, invalid, [], []])).rejects.toThrow();
    const count = await db.query<{ count: number }>('select count(*)::int as count from public.assets where id=$1', [asset]);
    expect(count.rows[0]?.count).toBe(0);
    await db.exec(`select set_config('test.uid','${reader}',false)`);
    await expect(db.query('select public.create_linear_route_atomic($1,$2,$3,$4,$5)', [inst, assetPayload, vertices, [], []])).rejects.toThrow();
    await db.exec(`select set_config('test.uid','${admin}',false)`);
  });
  it('creates and updates atomically, rejects stale versions and cross-asset child rows', async () => {
    const depths = [{ id: '10000000-0000-4000-8000-000000000009', institution_id: inst, asset_id: asset, geom: 'SRID=4326;POINT(5.1385 7.304)', depth_m: 1.2, measurement_method: 'open_trench_tape', documented_before_covering: true, observed_at: '2026-01-01T00:00:00Z' }];
    const junctions = [{ id: '10000000-0000-4000-8000-000000000010', institution_id: inst, asset_id: asset, geom: 'SRID=4326;POINT(5.1385 7.304)', junction_kind: 'tee', recorded_at: '2026-01-01T00:00:00Z' }];
    const created = await db.query<{ result: { version: number; geom: { type: string } } }>('select public.create_linear_route_atomic($1,$2,$3,$4,$5) as result', [inst, assetPayload, vertices, depths, junctions]);
    expect((await db.query<{ n: number }>('select count(*)::int n from public.utility_depth_observations where asset_id=$1', [asset])).rows[0]?.n).toBe(1);
    expect((await db.query<{ n: number }>('select count(*)::int n from public.utility_junctions where asset_id=$1', [asset])).rows[0]?.n).toBe(1);
    expect(created.rows[0]?.result.geom.type).toBe('LineString');
    expect(created.rows[0]?.result.version).toBe(1);
    const update = { geom: 'SRID=4326;LINESTRING(5.138 7.304,5.14 7.304)', is_manually_adjusted: true };
    await expect(db.query('select public.update_linear_route_atomic($1,$2,$3,$4,$5,$6)', [inst, asset, update, [{ ...vertices[0], vertex_kind: 'invalid' }, vertices[1]], null, 1])).rejects.toThrow();
    let current = await db.query<{ version: number; n: number }>('select version, (select count(*)::int from public.utility_route_vertices where asset_id=$1) n from public.assets where id=$1', [asset]);
    expect(current.rows[0]).toMatchObject({ version: 1, n: 2 });
    await expect(db.query('select public.update_linear_route_atomic($1,$2,$3,$4,$5,$6)', [inst, asset, update, [{ ...vertices[0], asset_id: admin }, vertices[1]], null, 1])).rejects.toThrow();
    await db.exec(`select set_config('test.uid','${reader}',false)`);
    await expect(db.query('select public.update_linear_route_atomic($1,$2,$3,$4,$5,$6)', [inst, asset, update, vertices, null, 1])).rejects.toThrow();
    await db.exec(`select set_config('test.uid','${admin}',false)`);
    await db.query('select public.update_linear_route_atomic($1,$2,$3,$4,$5,$6)', [inst, asset, update, vertices, null, 1]);
    expect((await db.query<{ n: number }>('select count(*)::int n from public.utility_junctions where asset_id=$1', [asset])).rows[0]?.n).toBe(1);
    await expect(db.query('select public.update_linear_route_atomic($1,$2,$3,$4,$5,$6)', [inst, asset, update, vertices, null, 1])).rejects.toThrow(/changed or is no longer accessible/);
    current = await db.query('select version, (select count(*)::int from public.utility_route_vertices where asset_id=$1) n from public.assets where id=$1', [asset]);
    expect(current.rows[0]).toMatchObject({ version: 2, n: 2 });
  });
  it('replays a route once, even if its response is lost, and checks the original actor and payload', async () => {
    const routeId = '20000000-0000-4000-8000-000000000001';
    const mutationId = '20000000-0000-4000-8000-000000000002';
    const childVertices = vertices.map((v, i) => ({ ...v, asset_id: routeId, id: `20000000-0000-4000-8000-00000000000${i + 3}` }));
    const payload = { assetInsert: { ...assetPayload, id: routeId, asset_code: 'WP-REPLAY' }, routeVertexInserts: childVertices, depthObservationInserts: [], junctionInserts: [] };
    const execute = (actor = admin, value = payload) => db.query<{ result: { duplicate: boolean } }>('select public.replay_linear_route_mutation($1,$2,$3,$4,$5,$6,$7) result', [mutationId, inst, actor, routeId, 'create', value, null]);
    expect((await execute()).rows[0]?.result.duplicate).toBe(false);
    expect((await execute()).rows[0]?.result.duplicate).toBe(true);
    await expect(execute(reader)).rejects.toThrow(/original capture user/);
    await expect(execute(admin, { ...payload, assetInsert: { ...payload.assetInsert, name: 'Different' } })).rejects.toThrow(/already in use/);
    expect((await db.query<{ n: number }>('select count(*)::int n from public.utility_route_vertices where asset_id=$1', [routeId])).rows[0]?.n).toBe(2);
  });
  it('does not leave an idempotency entry for a failed or conflicting mutation', async () => {
    const mutationId = '20000000-0000-4000-8000-000000000006';
    const update = { assetUpdate: { geom: 'SRID=4326;LINESTRING(5.138 7.304,5.14 7.304)' }, routeVertexInserts: vertices, junctionInserts: null };
    await expect(db.query('select public.replay_linear_route_mutation($1,$2,$3,$4,$5,$6,$7)', [mutationId, inst, admin, asset, 'update', update, 1])).rejects.toThrow(/changed or is no longer accessible/);
    await db.exec('reset role');
    const result = await db.query<{ n: number }>('select count(*)::int n from public.sync_replay_receipts where mutation_id=$1', [mutationId]);
    expect(result.rows[0]?.n).toBe(0);
    await db.exec('set role authenticated');
  });

  it('retries a lost response end-to-end without duplicating the server route', async () => {
    const local = new BadoLocalDatabase('atomic-route-integration');
    await local.open();
    try {
      const routeId = '30000000-0000-4000-8000-000000000001';
      const payload = { assetInsert: { ...assetPayload, id: routeId, asset_code: 'WP-LOST' }, routeVertexInserts: vertices.map((v, i) => ({ ...v, asset_id: routeId, id: `30000000-0000-4000-8000-00000000000${i + 3}` })), depthObservationInserts: [], junctionInserts: [] };
      const item = await enqueueSyncOperation({ institutionId: inst, actorUserId: admin, recordType: 'linear_routes', recordId: routeId, operationType: 'create', payload }, local);
      let first = true;
      const replay = async () => {
        await db.query('select public.replay_linear_route_mutation($1,$2,$3,$4,$5,$6,$7)', [item.id, inst, admin, routeId, 'create', payload, null]);
        if (first) { first = false; throw new Error('response lost'); }
      };
      expect(await processRouteQueue(inst, admin, replay, local)).toBe(0);
      expect((await local.syncQueue.get(item.id))?.status).toBe('failed');
      await retrySyncOperation(item.id, inst, local);
      expect(await processRouteQueue(inst, admin, replay, local)).toBe(1);
      expect((await local.syncQueue.get(item.id))?.status).toBe('synced');
      const result = await db.query<{ n: number }>('select count(*)::int n from public.assets where id=$1', [routeId]);
      expect(result.rows[0]?.n).toBe(1);
    } finally { await local.delete(); }
  });

});
