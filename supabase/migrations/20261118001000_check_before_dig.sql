-- An awareness query, not excavation clearance. Runs as the caller under RLS.
begin;
create or replace function public.check_before_dig(
  p_institution_id uuid, p_campus_id uuid, p_geometry jsonb, p_buffer_m double precision
) returns jsonb language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
declare v_geom geometry; v_results jsonb; v_truncated boolean;
begin
  if auth.uid() is null or not public.has_campus_access(p_institution_id, p_campus_id) or not exists
      (select 1 from public.campuses c where c.institution_id = p_institution_id and c.id = p_campus_id and c.is_active) then
    raise exception 'Campus is not accessible.' using errcode = '42501';
  end if;
  if p_buffer_m is null or p_buffer_m < 0 or p_buffer_m > 500 or p_geometry is null or octet_length(p_geometry::text) > 20000 then
    raise exception 'Invalid site or awareness buffer (0–500 m).' using errcode = '22023';
  end if;
  begin
    v_geom := st_setsrid(st_geomfromgeojson(p_geometry), 4326);
  exception when others then
    raise exception 'Invalid GeoJSON site geometry.' using errcode = '22023';
  end;
  if v_geom is null or st_isempty(v_geom) or st_ndims(v_geom) <> 2 or geometrytype(v_geom) not in ('POINT', 'POLYGON')
     or st_npoints(v_geom) > 101 or not st_isvalid(v_geom)
     or st_xmin(box2d(v_geom)) < -180 or st_xmax(box2d(v_geom)) > 180
     or st_ymin(box2d(v_geom)) < -90 or st_ymax(box2d(v_geom)) > 90
     or st_xmax(box2d(v_geom)) - st_xmin(box2d(v_geom)) > 180 then
    raise exception 'Site must be a valid WGS84 point or non-crossing polygon with at most 100 vertices.' using errcode = '22023';
  end if;
  if geometrytype(v_geom) = 'POLYGON' and (st_numinteriorrings(v_geom) <> 0 or st_area(v_geom::geography) <= 0 or st_area(v_geom::geography) > 25000000) then
    raise exception 'Area must have no holes and be no larger than 25 square kilometres.' using errcode = '22023';
  end if;

  -- Use geography for actual asset geometry, not centroids. Fetch one extra row
  -- and report truncation explicitly rather than implying a complete result.
  with nearby as (
    select a.*, st_distance(a.geom::geography, v_geom::geography) as distance_m
    from public.assets a
    where a.institution_id = p_institution_id and a.campus_id = p_campus_id and a.archived_at is null
      and st_dwithin(a.geom::geography, v_geom::geography, p_buffer_m)
    order by distance_m, a.id
    limit 201
  ), numbered as (
    select nearby.*, row_number() over (order by distance_m, id) as row_no from nearby
  ), entries as (
    select n.row_no, jsonb_build_object(
      'id', n.id, 'name', n.name, 'assetCode', n.asset_code, 'category', n.category,
      'utilityGroup', n.utility_group, 'geometry', st_asgeojson(n.geom)::jsonb, 'distanceM', n.distance_m,
      'verificationStatus', n.verification_status, 'operationalStatus', n.operational_status,
      'dataQuality', n.data_quality, 'isCriticalHazard', n.is_critical_hazard,
      'recordedDepthM', n.recorded_depth_m, 'depthMeasurementMethod', n.depth_measurement_method,
      'depthIsVariable', n.depth_is_variable, 'updatedAt', n.updated_at, 'lastVerifiedAt', n.last_verified_at,
      'horizontalAccuracyM', n.horizontal_accuracy_m,
      'minDepthM', d.min_depth, 'maxDepthM', d.max_depth, 'depthObservationCount', d.depth_count,
      'photoCount', (select count(*) from public.asset_photos p where p.institution_id = n.institution_id and p.asset_id = n.id)
    ) as entry
    from numbered n
    cross join lateral (select min(depth_m) min_depth, max(depth_m) max_depth, count(*) depth_count
      from public.utility_depth_observations d where d.institution_id = n.institution_id and d.asset_id = n.id) d
  )
  select coalesce(jsonb_agg(entry order by row_no) filter (where row_no <= 200), '[]'::jsonb), coalesce(bool_or(row_no > 200), false)
  into v_results, v_truncated from entries;
  return jsonb_build_object('results', v_results, 'truncated', v_truncated, 'checkedAt', statement_timestamp());
end;
$$;
revoke all on function public.check_before_dig(uuid,uuid,jsonb,double precision) from public, anon;
grant execute on function public.check_before_dig(uuid,uuid,jsonb,double precision) to authenticated;
commit;
