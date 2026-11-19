import { useState, type FormEvent } from 'react';
import type { LineString, MultiLineString } from 'geojson';
import { MapPinPicker } from '@/components/map/MapPinPicker';
import { useAddDepthObservation } from '@/features/routes/useLinearRoutes';
import { snapPointToLinearRoute } from '@/lib/gis/geometry';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';
import { DEPTH_MEASUREMENT_METHODS, type DepthMeasurementMethod, type GeoCoordinates } from '@/types/domain';

export function DepthObservationForm({ assetId, geometry }: { assetId: string; geometry: LineString | MultiLineString }) {
  const add = useAddDepthObservation();
  const online = useOnlineStatus();
  const [point, setPoint] = useState<GeoCoordinates | null>(null);
  const [depth, setDepth] = useState('');
  const [method, setMethod] = useState<DepthMeasurementMethod>('open_trench_tape');
  const [documented, setDocumented] = useState(false);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const first = geometry.type === 'LineString' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  const snapPreview = point ? snapPointToLinearRoute(geometry, point) : null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!point || !depth.trim()) { setMessage('Choose a location and enter a measured depth.'); return; }
    try {
      const snap = snapPointToLinearRoute(geometry, point);
      await add.mutateAsync({ assetId, latitude: snap.snapped.lat, longitude: snap.snapped.lng, chainageM: snap.chainageM, depthM: Number(depth), measurementMethod: method, documentedBeforeCovering: documented, notes, saveOffline: !online });
      setMessage(`Depth observation saved at ${snap.chainageM.toFixed(1)} m chainage${online ? '.' : ' locally; queued for the same signed-in user.'}`);
      setPoint(null); setDepth(''); setNotes(''); setDocumented(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save observation.'); }
  }
  return <form className="mt-4 space-y-3 border-t pt-3" onSubmit={e => void submit(e)}>
    <h3 className="font-semibold">Add measured depth</h3>
    <p className="text-sm">Select the observation location. It will be snapped to the nearest point on the route. Never infer depth from GPS elevation.</p>
    <MapPinPicker latitude={point?.lat ?? null} longitude={point?.lng ?? null} campusCenter={first ? { lng: first[0]!, lat: first[1]! } : null} onSelectPosition={setPoint} />
    {snapPreview && <p className="text-sm">Nearest route point: {snapPreview.chainageM.toFixed(1)} m chainage, {snapPreview.offsetM.toFixed(1)} m from selected location. Confirm the snap is appropriate before saving.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Depth in metres<input required min="0" max="100" step="any" type="number" value={depth} onChange={e => setDepth(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label>Measurement method<select value={method} onChange={e => setMethod(e.target.value as DepthMeasurementMethod)} className="block w-full rounded border p-2">{DEPTH_MEASUREMENT_METHODS.map(m => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}</select></label>
      <label><input type="checkbox" checked={documented} onChange={e => setDocumented(e.target.checked)} /> Documented before covering</label>
      <label>Notes<input value={notes} onChange={e => setNotes(e.target.value)} className="block w-full rounded border p-2" /></label>
    </div>
    <button disabled={add.isPending} className="rounded bg-blue-800 px-3 py-2 text-white">Add depth observation</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
