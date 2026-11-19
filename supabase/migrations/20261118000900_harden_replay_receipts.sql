-- Replay receipts must only be writable by the replay code, not by API clients.
-- The non-login owner inherits authenticated so existing caller RLS policies and
-- governance triggers continue to run with auth.uid() from the request. It must
-- not own application tables and must not have BYPASSRLS.
begin;
create role bado_sync_replay nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant authenticated to bado_sync_replay;
revoke insert, update, delete, truncate, references, trigger on public.sync_idempotency_ledger from public, anon, authenticated;
drop policy if exists sync_ledger_insert_operator on public.sync_idempotency_ledger;

create table public.sync_replay_receipts (
  mutation_id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('linear_routes', 'point_assets')),
  entity_id uuid not null,
  operation text not null check (operation in ('create', 'update')),
  applied_at timestamptz not null default now(),
  response_snapshot jsonb not null
);
alter table public.sync_replay_receipts enable row level security;
alter table public.sync_replay_receipts force row level security;
revoke all on public.sync_replay_receipts from public, anon, authenticated;
grant select, insert on public.sync_replay_receipts to bado_sync_replay;
create policy replay_receipts_select_own on public.sync_replay_receipts for select to bado_sync_replay
  using (user_id = auth.uid() and institution_id in (select public.current_user_institution_ids()));
create policy replay_receipts_insert_operator on public.sync_replay_receipts for insert to bado_sync_replay
  with check (user_id = auth.uid() and public.has_institution_role(institution_id, array['admin','supervisor','field_technician','surveyor_gis']::public.app_role[]));

create or replace function public.replay_linear_route_mutation(
  p_mutation_id uuid,
  p_institution_id uuid,
  p_actor_id uuid,
  p_asset_id uuid,
  p_operation text,
  p_payload jsonb,
  p_base_version integer default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_inserted uuid;
  v_previous public.sync_replay_receipts;
  v_fingerprint text;
  v_depth public.utility_depth_observations;
begin
  if auth.uid() is null or p_actor_id is distinct from auth.uid() then
    raise exception 'The signed-in user must match the original capture user.' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_institution_id is null or p_asset_id is null or p_operation is null or p_operation not in ('create', 'update', 'depth') or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid route replay request.' using errcode = '22023';
  end if;
  -- Previously client-writable keys are untrusted, even if they match. Never
  -- acknowledge or reapply them automatically; they need reconciliation.
  if exists (select 1 from public.sync_idempotency_ledger
      where mutation_id = p_mutation_id and user_id = auth.uid() and institution_id = p_institution_id) then
    raise exception 'Legacy replay key requires manual reconciliation.' using errcode = '40001';
  end if;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('asset_id', p_asset_id, 'operation', p_operation, 'payload', p_payload, 'base_version', p_base_version)::text, 'UTF8')), 'hex');
  insert into public.sync_replay_receipts (mutation_id, institution_id, user_id, entity_type, entity_id, operation, response_snapshot)
    values (p_mutation_id, p_institution_id, p_actor_id, 'linear_routes', p_asset_id,
      case when p_operation = 'update' then 'update' else 'create' end,
      jsonb_build_object('fingerprint', v_fingerprint))
    on conflict (mutation_id) do nothing returning mutation_id into v_inserted;
  if v_inserted is null then
    select * into v_previous from public.sync_replay_receipts where mutation_id = p_mutation_id;
    if not found or v_previous.institution_id <> p_institution_id or v_previous.user_id <> p_actor_id or v_previous.entity_id <> p_asset_id or v_previous.entity_type <> 'linear_routes' or v_previous.operation <> (case when p_operation = 'update' then 'update' else 'create' end) or v_previous.response_snapshot->>'fingerprint' is distinct from v_fingerprint then
      raise exception 'Mutation ID is already in use for another operation.' using errcode = '23505';
    end if;
    -- Do not disclose prior results to a user whose campus access has since changed.
    if not public.can_access_asset_record(p_institution_id, p_asset_id) then
      raise exception 'Route is no longer accessible.' using errcode = '42501';
    end if;
    return jsonb_build_object('applied', true, 'duplicate', true);
  end if;

  if p_operation = 'create' then
    if p_payload->'assetInsert'->>'id' is distinct from p_asset_id::text then
      raise exception 'Route ID does not match replay payload.' using errcode = '22023';
    end if;
    perform public.create_linear_route_atomic(p_institution_id, p_payload->'assetInsert', p_payload->'routeVertexInserts', p_payload->'depthObservationInserts', p_payload->'junctionInserts');
  elsif p_operation = 'update' then
    if p_base_version is null or p_base_version < 1 then
      raise exception 'Route updates require an expected server version.' using errcode = '22023';
    end if;
    perform public.update_linear_route_atomic(p_institution_id, p_asset_id, p_payload->'assetUpdate', p_payload->'routeVertexInserts', p_payload->'junctionInserts', p_base_version);
  else
    if p_payload->'depthObservationInsert'->>'asset_id' is distinct from p_asset_id::text or p_payload->'depthObservationInsert'->>'institution_id' is distinct from p_institution_id::text then
      raise exception 'Depth observation does not match route.' using errcode = '22023';
    end if;
    v_depth := jsonb_populate_record(null::public.utility_depth_observations, p_payload->'depthObservationInsert');
    insert into public.utility_depth_observations (id, institution_id, asset_id, geom, depth_m, measurement_method, documented_before_covering, chainage_m, horizontal_accuracy_m, notes, observed_at)
    values (v_depth.id, v_depth.institution_id, v_depth.asset_id, v_depth.geom, v_depth.depth_m, v_depth.measurement_method, v_depth.documented_before_covering, v_depth.chainage_m, v_depth.horizontal_accuracy_m, v_depth.notes, v_depth.observed_at);
  end if;
  return jsonb_build_object('applied', true, 'duplicate', false);
end;
$$;

create or replace function public.replay_point_asset_mutation(p_mutation_id uuid, p_institution_id uuid, p_actor_id uuid, p_asset_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_inserted uuid; v_previous public.sync_replay_receipts; v_fingerprint text;
begin
  if auth.uid() is null or p_actor_id is distinct from auth.uid() then
    raise exception 'The signed-in user must match the original capture user.' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_institution_id is null or p_asset_id is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload->'assetInsert'->>'id' is distinct from p_asset_id::text then
    raise exception 'Invalid asset replay request.' using errcode = '22023';
  end if;
  -- Previously client-writable keys are untrusted, even if they match. Never
  -- acknowledge or reapply them automatically; they need reconciliation.
  if exists (select 1 from public.sync_idempotency_ledger
      where mutation_id = p_mutation_id and user_id = auth.uid() and institution_id = p_institution_id) then
    raise exception 'Legacy replay key requires manual reconciliation.' using errcode = '40001';
  end if;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('asset_id', p_asset_id, 'payload', p_payload)::text, 'UTF8')), 'hex');
  insert into public.sync_replay_receipts (mutation_id, institution_id, user_id, entity_type, entity_id, operation, response_snapshot)
    values (p_mutation_id, p_institution_id, p_actor_id, 'point_assets', p_asset_id, 'create', jsonb_build_object('fingerprint', v_fingerprint))
    on conflict (mutation_id) do nothing returning mutation_id into v_inserted;
  if v_inserted is null then
    select * into v_previous from public.sync_replay_receipts where mutation_id = p_mutation_id;
    if not found or v_previous.institution_id <> p_institution_id or v_previous.user_id <> p_actor_id or v_previous.entity_id <> p_asset_id or v_previous.entity_type <> 'point_assets' or v_previous.response_snapshot->>'fingerprint' is distinct from v_fingerprint then
      raise exception 'Mutation ID is already in use for another operation.' using errcode = '23505';
    end if;
    if not public.can_access_asset_record(p_institution_id, p_asset_id) then
      raise exception 'Asset is no longer accessible.' using errcode = '42501';
    end if;
    return jsonb_build_object('applied', true, 'duplicate', true);
  end if;
  perform public.create_point_asset_atomic(p_institution_id, p_payload->'assetInsert', p_payload->'benchmarkInsert');
  return jsonb_build_object('applied', true, 'duplicate', false);
end;
$$;

-- Ownership is changed only for replay entry points. The role is non-login,
-- inherits caller-facing table privileges, and remains subject to forced RLS.
grant usage, create on schema public to bado_sync_replay;
alter function public.replay_linear_route_mutation(uuid,uuid,uuid,uuid,text,jsonb,integer) owner to bado_sync_replay;
alter function public.replay_point_asset_mutation(uuid,uuid,uuid,uuid,jsonb) owner to bado_sync_replay;
revoke create on schema public from bado_sync_replay;
revoke all on function public.replay_linear_route_mutation(uuid,uuid,uuid,uuid,text,jsonb,integer) from public, anon;
revoke all on function public.replay_point_asset_mutation(uuid,uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.replay_linear_route_mutation(uuid,uuid,uuid,uuid,text,jsonb,integer) to authenticated;
grant execute on function public.replay_point_asset_mutation(uuid,uuid,uuid,uuid,jsonb) to authenticated;
commit;
