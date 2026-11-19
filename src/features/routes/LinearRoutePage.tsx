import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, Marker, Polyline, Tooltip } from 'react-leaflet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadoMapCanvas, createPlacementPinIcon } from '@/components/map/BadoMapCanvas';
import { useAssetDetail, useAssetTypes, useUploadAssetPhoto } from '@/features/assets/useAssets';
import { useCampuses } from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import { useCreateLinearRoute, useUpdateRouteGeometry } from '@/features/routes/useLinearRoutes';
import { createForegroundRouteTracker, type DraftRouteVertex, type RouteTrackingStatus } from '@/lib/geo/routeTracker';
import { computeGeometryLengthM, isLinearGeometry, snapPointToLinearRoute } from '@/lib/gis/geometry';
import { parseAndValidateLinearGeoJson, MAX_GEOJSON_IMPORT_BYTES } from '@/lib/gis/geojsonIo';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';
import { validatePhotoFile } from '@/lib/media/fileValidation';
import { DEPTH_MEASUREMENT_METHODS, JUNCTION_KINDS, type AssetDetailBundle, type GeoCoordinates, type VertexKind, type DepthMeasurementMethod, type JunctionKind, type CustomAttributeValue } from '@/types/domain';
import type { DepthObservationInput, UtilityJunctionInput } from '@/lib/assets/validation';

type Linear = { type: 'LineString'; coordinates: Pair[] } | { type: 'MultiLineString'; coordinates: Pair[][] };
type Pair = [number, number];
const field = 'w-full rounded border border-slate-300 p-2';

export function LinearRoutePage() {
  const { assetId } = useParams();
  const detail = useAssetDetail(assetId);
  if (assetId && detail.isLoading) return <p>Loading route…</p>;
  if (assetId && (!detail.data || !isLinearGeometry(detail.data.asset.geometry))) return <p>Route not found or not linear.</p>;
  return <RouteEditor key={assetId ?? 'new'} detail={detail.data ?? undefined} />;
}

function RouteEditor({ detail }: { detail?: AssetDetailBundle }) {
  const { activeCampusId, can } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { data: types } = useAssetTypes();
  const { data: campuses } = useCampuses();
  const create = useCreateLinearRoute();
  const update = useUpdateRouteGeometry();
  const uploadPhoto = useUploadAssetPhoto();
  const [photo, setPhoto] = useState<File | null>(null);
  const initial = detail?.asset.geometry;
  const [parts, setParts] = useState<Pair[][]>(() => initial && isLinearGeometry(initial) ? (initial.type === 'LineString' ? [initial.coordinates] : initial.coordinates).map(p => p.map(c => [c[0]!, c[1]!])) : [[]]);
  const [mode, setMode] = useState<'manual_draw' | 'gps_walk_route' | 'geojson_import'>('manual_draw');
  const [campusId, setCampusId] = useState(detail?.asset.campusId ?? activeCampusId ?? '');
  const [typeId, setTypeId] = useState(detail?.asset.assetTypeId ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [status, setStatus] = useState<RouteTrackingStatus>('idle');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [vertexNotes, setVertexNotes] = useState('');
  const [tracked, setTracked] = useState<(DraftRouteVertex | null)[][]>(() => (initial && isLinearGeometry(initial) ? (initial.type === 'LineString' ? [initial.coordinates] : initial.coordinates) : [[]]).map((part, pi) => part.map((_, index) => { const v = detail?.routeVertices.find(r => r.partIndex === pi && r.sequenceIndex === index); return v ? { id: v.id, location: v.location, vertexKind: v.vertexKind, horizontalAccuracyM: v.horizontalAccuracyM, verticalAccuracyM: v.verticalAccuracyM, fixQuality: v.fixQuality, notes: v.notes ?? '', recordedAt: v.recordedAt } : null; })));
  const [observationsStale, setObservationsStale] = useState(false);
  const [description, setDescription] = useState('');
  const [material, setMaterial] = useState('');
  const [customAttributes, setCustomAttributes] = useState<Record<string, CustomAttributeValue>>({});
  const [depths, setDepths] = useState<DepthObservationInput[]>([]);
  const [junctions, setJunctions] = useState<UtilityJunctionInput[]>([]);
  const [placement, setPlacement] = useState<'route' | 'depth' | 'junction'>('route');
  const [depth, setDepth] = useState('');
  const [method, setMethod] = useState<DepthMeasurementMethod>('open_trench_tape');
  const [beforeCovering, setBeforeCovering] = useState(false);
  const [observationNotes, setObservationNotes] = useState('');
  const [junctionKind, setJunctionKind] = useState<JunctionKind>('tee');
  const [junctionLabel, setJunctionLabel] = useState('');
  const [junctionDepth, setJunctionDepth] = useState('');
  const [connectedAssetId, setConnectedAssetId] = useState('');
  const [junctionNotes, setJunctionNotes] = useState('');
  const tracker = useMemo(() => createForegroundRouteTracker({
    onStatusChange: setStatus,
    onLiveFix: (fix, _accepted, reason) => { setAccuracy(fix.horizontalAccuracyM); if (reason) setInfo(reason); },
    onAppendVertex: vertex => { setObservationsStale(true); setTracked(v => v.map((part,i) => i === 0 ? [...part, vertex] : part)); setParts(p => p.map((part,i) => i === 0 ? [...part, [vertex.location.lng, vertex.location.lat]] : part)); },
    onError: setError,
  }), []);
  useEffect(() => () => tracker.stop(), [tracker]);
  const linearTypes = (types ?? []).filter(t => t.allowedGeomTypes.includes('LineString') || t.allowedGeomTypes.includes('MultiLineString'));
  const geometry: Linear = parts.length === 1 ? { type: 'LineString', coordinates: parts[0] ?? [] } : { type: 'MultiLineString', coordinates: parts };
  const count = parts.reduce((n, p) => n + p.length, 0);
  function append(c: GeoCoordinates) {
    if (placement !== 'route') {
      if (parts.some(p => p.length < 2)) { setError('Draw a complete route before placing observations.'); return; }
      const snapped = snapPointToLinearRoute(geometry, c);
      if (placement === 'depth') {
        const value = Number(depth);
        if (!depth.trim() || !Number.isFinite(value) || value < 0 || value > 100) { setError('Enter a depth between 0 and 100 metres before placing the observation.'); return; }
        setDepths(d => [...d, { latitude: snapped.snapped.lat, longitude: snapped.snapped.lng, depthM: value, measurementMethod: method, documentedBeforeCovering: beforeCovering, chainageM: snapped.chainageM, notes: observationNotes }]);
      } else {
        const value = junctionDepth.trim() ? Number(junctionDepth) : null;
        if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) { setError('Junction depth must be between 0 and 100 metres.'); return; }
        setJunctions(j => [...j, { latitude: snapped.snapped.lat, longitude: snapped.snapped.lng, junctionKind, label: junctionLabel, connectedAssetId: connectedAssetId.trim() || null, depthM: value, depthMeasurementMethod: value === null ? null : method, notes: junctionNotes }]);
      }
      if (depths.length === 0 && junctions.length === 0) setObservationsStale(false);
      setError(''); setInfo(`Point snapped to route at ${snapped.chainageM.toFixed(1)} m chainage, ${snapped.offsetM.toFixed(1)} m from selected location.`); setPlacement('route'); return;
    }
    if (mode !== 'manual_draw') return;
    setObservationsStale(true); setTracked(v => v.map((part,i) => i === 0 ? [...part, null] : part)); setParts(p => p.map((part, i) => i === 0 ? [...part, [c.lng, c.lat]] : part));
  }
  function modify(partIndex: number, index: number, value: Pair | null) { setObservationsStale(true); setTracked(v => v.map((part, pi) => pi !== partIndex ? part : value ? part.map((item, i) => i === index ? null : item) : part.filter((_, i) => i !== index))); setParts(p => p.map((part, i) => i !== partIndex ? part : value ? part.map((v, j) => j === index ? value : v) : part.filter((_, j) => j !== index))); }
  async function save(submissionMode: 'draft' | 'submitted') {
    setError('');
    if (parts.some(p => p.length < 2)) { setError('Each route segment needs at least two vertices.'); return; }
    if (observationsStale && (depths.length > 0 || junctions.length > 0)) { setError('The route changed after observations were placed. Remove and replace the observations to verify their location and chainage.'); return; }
    try {
      if (photo && !detail) validatePhotoFile(photo);
      const vertices = parts.flatMap((part, partIndex) => part.map(([longitude, latitude], sequenceIndex) => {
        const captured = tracked[partIndex]?.[sequenceIndex];
        return { partIndex, sequenceIndex, longitude, latitude, vertexKind: captured?.vertexKind ?? 'track_point' as VertexKind, horizontalAccuracyM: captured?.horizontalAccuracyM, verticalAccuracyM: captured?.verticalAccuracyM, recordedAt: captured?.recordedAt, notes: captured?.notes, fixQuality: captured?.fixQuality ?? 'unknown' as const };
      }));
      const result = detail ? await update.mutateAsync({ assetId: detail.asset.id, baseVersion: detail.asset.version, geometry, vertices, captureMethod: mode, saveOffline: !online }) : await create.mutateAsync({ campusId, assetTypeId: typeId, assetCode: code, name, description, material: material || null, customAttributes, depthObservations: depths, junctions, geometry, vertices, submissionMode, captureMethod: mode, positionSource: mode === 'gps_walk_route' ? 'smartphone_gps' : mode === 'geojson_import' ? 'gis_import' : 'manual_map', saveOffline: !online });
      tracker.stop();
      if (photo && !detail) {
        try { await uploadPhoto.mutateAsync({ assetId: result.id, file: photo, photoKind: 'exposed_trench', saveOffline: !online }); }
        catch (photoError) { window.alert(`Route was saved, but the trench photo was not attached: ${photoError instanceof Error ? photoError.message : 'Upload failed'}. Please add it from the asset page.`); }
      }
      navigate(`/assets/${result.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save route.'); }
  }
  return <div className="mx-auto max-w-5xl space-y-4">
    <Link className="text-blue-700 underline" to="/map">← Infrastructure map</Link>
    <h1 className="text-2xl font-bold">{detail ? 'Edit route geometry' : 'Record linear infrastructure'}</h1>
    <p className="text-sm text-amber-800">Mapped infrastructure may be incomplete. Never rely on this map alone for excavation decisions.</p>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {!detail && <div className="grid gap-3 sm:grid-cols-2">
      <label>Campus<select className={field} value={campusId} onChange={e => setCampusId(e.target.value)}><option value="">Select campus</option>{campuses?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Utility type<select className={field} value={typeId} onChange={e => { setTypeId(e.target.value); setCustomAttributes({}); }}><option value="">Select type</option>{linearTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Route ID<input className={field} value={code} onChange={e => setCode(e.target.value)} /></label>
      <label>Route name<input className={field} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Description<input className={field} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label>Exposed trench photo (optional)<input className={field} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></label>
      <label>Material<input className={field} value={material} onChange={e => setMaterial(e.target.value)} /></label>
      {linearTypes.find(t => t.id === typeId)?.fieldSchema.map(f => <label key={f.key}>{f.label}{f.required ? ' *' : ''}{f.unit ? ` (${f.unit})` : ''}{f.type === 'select' ? <select className={field} value={String(customAttributes[f.key] ?? '')} onChange={e => setCustomAttributes(a => ({ ...a, [f.key]: e.target.value }))}><option value="">Select</option>{f.options?.map(o => <option key={o} value={o}>{o}</option>)}</select> : f.type === 'boolean' ? <input type="checkbox" checked={customAttributes[f.key] === true} onChange={e => setCustomAttributes(a => ({ ...a, [f.key]: e.target.checked }))} /> : <input className={field} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={String(customAttributes[f.key] ?? '')} onChange={e => setCustomAttributes(a => ({ ...a, [f.key]: f.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value }))} />}</label>)}
    </div>}
    <div className="flex flex-wrap gap-2">{(['manual_draw','gps_walk_route', ...(can('gis:import') ? ['geojson_import'] as const : [])] as const).map(m => <button key={m} type="button" className={`rounded border px-3 py-2 ${mode === m ? 'bg-blue-800 text-white' : ''}`} onClick={() => { tracker.stop(); setMode(m); }}>{m === 'manual_draw' ? 'Manual draw' : m === 'gps_walk_route' ? 'GPS walk' : 'Import GeoJSON'}</button>)}</div>
    {mode === 'gps_walk_route' && <div className="space-y-2"><div className="flex flex-wrap gap-2">{(['start','pause','resume','stop'] as const).map(action => <button className="rounded border px-3 py-2 capitalize" key={action} disabled={(action === 'start' && (status === 'recording' || status === 'paused')) || (action === 'pause' && status !== 'recording') || (action === 'resume' && status !== 'paused') || (action === 'stop' && status !== 'recording' && status !== 'paused')} onClick={() => tracker[action]()}>{action}</button>)}</div><p>GPS: {status}{accuracy !== null && ` · ±${accuracy} m${accuracy > 15 ? ' (poor accuracy: use caution)' : ''}`}</p><div className="flex gap-2">{(['bend','junction','valve','note_point'] as const).map(k => <button key={k} className="rounded border px-2 py-1" onClick={() => tracker.markSpecialVertex(k, vertexNotes)}>{k.replace('_', ' ')}</button>)}</div><label>Special vertex notes <input className="rounded border p-1" value={vertexNotes} onChange={e => setVertexNotes(e.target.value)} /></label></div>}
    {mode === 'geojson_import' && <label>Choose WGS84 GeoJSON <input type="file" accept=".geojson,.json,application/geo+json" onChange={async e => { try { const file = e.target.files?.[0]; if (!file) return; if (file.size > MAX_GEOJSON_IMPORT_BYTES) throw new Error('File exceeds 5 MB.'); const parsed = parseAndValidateLinearGeoJson(await file.text()); setParts((parsed.geometry.type === 'LineString' ? [parsed.geometry.coordinates] : parsed.geometry.coordinates).map(p => p.map(c => [c[0]!, c[1]!] as Pair))); setObservationsStale(true); setTracked((parsed.geometry.type === 'LineString' ? [parsed.geometry.coordinates] : parsed.geometry.coordinates).map(p => p.map(() => null))); setInfo(`${parsed.partCount} parts, ${parsed.vertexCount} vertices, ${parsed.routeLengthM} m. ${parsed.warnings.join(' ')}`); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Invalid GeoJSON'); } }} /></label>}
    {!detail && <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Depth observations and junctions</h2>
      <p className="text-sm">Enter the details, choose placement, then tap the route map. Points are snapped to the route. Depth must be measured independently; GPS elevation is not burial depth.</p>
      <div className="grid gap-2 sm:grid-cols-2"><label>Depth (m)<input className={field} type="number" min="0" max="100" step="any" value={depth} onChange={e => setDepth(e.target.value)} /></label><label>Measurement method<select className={field} value={method} onChange={e => setMethod(e.target.value as DepthMeasurementMethod)}>{DEPTH_MEASUREMENT_METHODS.map(m => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}</select></label><label><input type="checkbox" checked={beforeCovering} onChange={e => setBeforeCovering(e.target.checked)} /> Documented before covering</label><label>Depth notes<input className={field} value={observationNotes} onChange={e => setObservationNotes(e.target.value)} /></label></div>
      <button className="rounded border px-3 py-2" onClick={() => setPlacement('depth')}>Place depth observation on map</button>
      <ul>{depths.map((d,i) => <li key={i}>{d.depthM} m · chainage {d.chainageM?.toFixed(1)} m <button className="text-red-700 underline" onClick={() => setDepths(v => v.filter((_,j) => j !== i))}>Remove depth {i + 1}</button></li>)}</ul>
      <div className="grid gap-2 sm:grid-cols-2"><label>Junction type<select className={field} value={junctionKind} onChange={e => setJunctionKind(e.target.value as JunctionKind)}>{JUNCTION_KINDS.map(k => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</select></label><label>Junction label<input className={field} value={junctionLabel} onChange={e => setJunctionLabel(e.target.value)} /></label><label>Connected asset ID (optional)<input className={field} value={connectedAssetId} onChange={e => setConnectedAssetId(e.target.value)} /></label><label>Junction depth (m, optional)<input className={field} type="number" min="0" max="100" step="any" value={junctionDepth} onChange={e => setJunctionDepth(e.target.value)} /></label><label>Junction notes<input className={field} value={junctionNotes} onChange={e => setJunctionNotes(e.target.value)} /></label></div>
      <button className="rounded border px-3 py-2" onClick={() => setPlacement('junction')}>Place junction on map</button>
      <ul>{junctions.map((j,i) => <li key={i}>{j.label || j.junctionKind} <button className="text-red-700 underline" onClick={() => setJunctions(v => v.filter((_,n) => n !== i))}>Remove junction {i + 1}</button></li>)}</ul>
      {placement !== 'route' && <p role="status">Tap the map to place the {placement}. <button className="underline" onClick={() => setPlacement('route')}>Cancel</button></p>}
    </section>}
    {info && <p className="text-sm text-slate-600">{info}</p>}
    {detail && (detail.depthObservations.length > 0 || detail.junctions.length > 0) && <p className="text-amber-800">This route has existing depth observations or junctions. After editing the geometry, verify their positions and chainages separately; they are not automatically moved.</p>}
    <p>{count} vertices · {computeGeometryLengthM(geometry)?.toFixed(1)} m. Tap map to add points in manual mode; drag a vertex to adjust it.</p>
    <BadoMapCanvas onMapClick={append} crosshairCursor={mode === 'manual_draw'} heightClassName="h-96">
      {parts.map((part, pi) => <Polyline key={pi} positions={part.map(([lng,lat]) => [lat,lng])} />)}
      {depths.map((d,i) => <CircleMarker key={`depth-${i}`} center={[d.latitude, d.longitude]} radius={6} pathOptions={{color: '#b45309'}}><Tooltip>Depth: {d.depthM} m</Tooltip></CircleMarker>)}
      {junctions.map((j,i) => <CircleMarker key={`junction-${i}`} center={[j.latitude, j.longitude]} radius={6} pathOptions={{color: '#7c3aed'}}><Tooltip>{j.label || j.junctionKind}</Tooltip></CircleMarker>)}
      {parts.flatMap((part, pi) => part.map(([lng,lat], i) => <Marker key={`${pi}-${i}`} position={[lat,lng]} icon={createPlacementPinIcon()} draggable eventHandlers={{ dragend: (e) => { const pos = e.target.getLatLng(); modify(pi, i, [pos.lng, pos.lat]); } }} />))}
    </BadoMapCanvas>
    <div className="space-y-2"><h2 className="font-semibold">Vertices (WGS84 longitude, latitude)</h2>{parts.flatMap((part, pi) => part.map(([lng,lat], i) => <div className="flex flex-wrap items-center gap-2" key={`${pi}-${i}`}><span>Part {pi + 1}, point {i + 1}</span><input aria-label={`Longitude ${pi + 1}-${i + 1}`} type="number" step="any" className="w-32 rounded border p-1" value={lng} onChange={e => modify(pi,i,[Number(e.target.value),lat])}/><input aria-label={`Latitude ${pi + 1}-${i + 1}`} type="number" step="any" className="w-32 rounded border p-1" value={lat} onChange={e => modify(pi,i,[lng,Number(e.target.value)])}/><button className="text-red-700 underline" onClick={() => modify(pi,i,null)}>Delete</button>{i < part.length - 1 && <button className="text-blue-700 underline" onClick={() => { setObservationsStale(true); setTracked(v => v.map((seg,j) => j === pi ? [...seg.slice(0,i+1), null, ...seg.slice(i+1)] : seg)); setParts(p => p.map((seg,j) => j === pi ? [...seg.slice(0,i+1), [(lng + seg[i+1]![0])/2,(lat + seg[i+1]![1])/2], ...seg.slice(i+1)] : seg)); }}>Insert midpoint</button>}</div>))}</div>
    <div className="flex gap-2"><button className="rounded bg-blue-800 px-4 py-2 text-white" disabled={create.isPending || update.isPending || uploadPhoto.isPending} onClick={() => void save('draft')}>{detail ? 'Save geometry' : 'Save draft'}</button>{!detail && <button className="rounded border px-4 py-2" disabled={create.isPending || uploadPhoto.isPending} onClick={() => void save('submitted')}>Submit for verification</button>}</div>
    {!online && <p>Offline: route changes are queued locally for the same signed-in user; photos are not automatically synchronised.</p>}
  </div>;
}
