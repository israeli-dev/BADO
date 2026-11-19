-- One transaction couples an offline route mutation with its idempotency key.
-- SECURITY INVOKER preserves caller RLS and the existing route governance checks.
begin;
create or replace function public.replay_linear_route_mutation(
  p_mutation_id uuid,
  p_institution_id uuid,
  p_actor_id uuid,
  p_asset_id uuid,
  p_operation text,
  p_payload jsonb,
  p_base_version integer default null
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_inserted uuid;
  v_previous public.sync_idempotency_ledger;
  v_fingerprint text;
  v_depth public.utility_depth_observations;
begin
  if auth.uid() is null or p_actor_id is distinct from auth.uid() then
    raise exception 'The signed-in user must match the original capture user.' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_institution_id is null or p_asset_id is null or p_operation not in ('create', 'update', 'depth') or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid route replay request.' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object('asset_id', p_asset_id, 'operation', p_operation, 'payload', p_payload, 'base_version', p_base_version)::text);
  insert into public.sync_idempotency_ledger (mutation_id, institution_id, user_id, entity_type, entity_id, operation, response_snapshot)
    values (p_mutation_id, p_institution_id, p_actor_id, 'linear_routes', p_asset_id,
      case when p_operation = 'update' then 'update' else 'create' end,
      jsonb_build_object('fingerprint', v_fingerprint))
    on conflict (mutation_id) do nothing returning mutation_id into v_inserted;
  if v_inserted is null then
    select * into v_previous from public.sync_idempotency_ledger where mutation_id = p_mutation_id;
    if not found or v_previous.institution_id <> p_institution_id or v_previous.user_id <> p_actor_id or v_previous.entity_id <> p_asset_id or v_previous.response_snapshot->>'fingerprint' is distinct from v_fingerprint then
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
revoke all on function public.replay_linear_route_mutation(uuid,uuid,uuid,uuid,text,jsonb,integer) from public;
grant execute on function public.replay_linear_route_mutation(uuid,uuid,uuid,uuid,text,jsonb,integer) to authenticated;
commit;
