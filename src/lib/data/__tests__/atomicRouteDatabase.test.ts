// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import foundation from '../../../../supabase/migrations/20261118000100_phase1_institutional_foundation.sql?raw';
import assets from '../../../../supabase/migrations/20261118000200_phase2_core_asset_registry.sql?raw';
import gis from '../../../../supabase/migrations/20261118000300_phase3_gis_and_linear_routes.sql?raw';
import atomic from '../../../../supabase/migrations/20261118000400_atomic_route_writes.sql?raw';
import replay from '../../../../supabase/migrations/20261118000500_idempotent_route_replay.sql?raw';
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
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid, bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;`);
    for (const migration of [foundation, assets, gis, atomic, replay]) {
      // PGlite provides gen_random_uuid natively, but not the pgcrypto extension package.
      await db.exec(migration.replace('create extension if not exists pgcrypto;', ''));
    }
    await db.exec(`grant usage on schema public, auth to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into auth.users (id,email) values ('${admin}','admin@test.example'), ('${reader}','reader@test.example');
      insert into public.institutions (id,name,slug,short_code) values ('${inst}','Test Institution','test-inst','TEST');
      insert into public.campuses (id,institution_id,name,code) values ('${campus}','${inst}','Main campus','MAIN');
      insert into public.asset_types (id,institution_id,category,utility_group,code,name,allowed_geom_types,color_hex,icon_key) values ('${type}','${inst}','underground','water','TEST_PIPE','Test Pipe',array['LineString'],'#000000','pipe');
      insert into public.user_institutions (user_id,institution_id,role) values ('${admin}','${inst}','admin'), ('${reader}','${inst}','read_only');
      set role authenticated; select set_config('test.uid','${admin}',false);`);
  }, 60000);
  afterAll(async () => { await db?.close(); });
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
    const result = await db.query<{ n: number }>('select count(*)::int n from public.sync_idempotency_ledger where mutation_id=$1', [mutationId]);
    expect(result.rows[0]?.n).toBe(0);
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
