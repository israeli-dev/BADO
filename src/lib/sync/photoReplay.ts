import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database';
import type { SyncQueueRecord } from '@/types/domain';

type PhotoInsert = Database['public']['Tables']['asset_photos']['Insert'];
type PhotoRow = Database['public']['Tables']['asset_photos']['Row'];
type Failure = { message: string; code?: string; status?: number; statusCode?: string };
export interface PhotoReplayTransport {
  upload(path: string, blob: Blob, mime: string): Promise<Failure | null>;
  download(path: string): Promise<Blob>;
  insert(meta: PhotoInsert): Promise<Failure | null>;
  find(institutionId: string, id: string): Promise<PhotoRow | null>;
}

async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const first = new Uint8Array(await a.arrayBuffer());
  const second = new Uint8Array(await b.arrayBuffer());
  return first.every((byte, index) => byte === second[index]);
}

/** Storage and database cannot share a transaction. Verify existing bytes and metadata on retries. */
export async function replayPhoto(item: SyncQueueRecord, transport: PhotoReplayTransport, db: BadoLocalDatabase = badoDb): Promise<void> {
  if (item.recordType !== 'asset_photos' || item.operationType !== 'upload_photo') throw new Error('Unsupported media mutation.');
  const photo = await db.assetPhotos.get(item.recordId);
  if (!photo || photo.institutionId !== item.institutionId || !photo.localBlobId) throw new Error('Photo metadata or local blob reference is missing.');
  const queuedMeta = item.payload.meta;
  if (!queuedMeta || typeof queuedMeta !== 'object' || !('assetId' in queuedMeta) || queuedMeta.assetId !== photo.assetId || item.payload.localBlobId !== photo.localBlobId) throw new Error('Queued photo references do not match local metadata.');
  const blob = await db.localMediaBlobs.get(photo.localBlobId);
  if (!blob || blob.institutionId !== item.institutionId || blob.assetId !== photo.assetId || blob.mediaKind !== 'photo') throw new Error('Photo bytes are unavailable on this device.');
  if (!item.campusId || !photo.storagePath.startsWith(`${item.institutionId}/${item.campusId}/${photo.assetId}/photos/`) || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType) || blob.blob.size !== photo.fileSizeBytes || blob.mimeType !== photo.mimeType) throw new Error('Photo metadata does not match its original capture.');

  const uploadError = await transport.upload(photo.storagePath, blob.blob, photo.mimeType);
  if (uploadError) {
    if (uploadError.status !== 409 && uploadError.statusCode !== '409' && uploadError.code !== 'Duplicate') throw uploadError;
    const existing = await transport.download(photo.storagePath);
    if (!await sameBytes(blob.blob, existing)) throw new Error('A different file already exists at the photo path; review is required.');
  }
  const meta: PhotoInsert = {
    id: photo.id, institution_id: photo.institutionId, asset_id: photo.assetId,
    observation_id: photo.observationId, storage_path: photo.storagePath, file_name: photo.fileName,
    mime_type: photo.mimeType, file_size_bytes: photo.fileSizeBytes, width_px: photo.widthPx,
    height_px: photo.heightPx, photo_kind: photo.photoKind, caption: photo.caption, captured_at: photo.capturedAt,
  };
  const insertError = await transport.insert(meta);
  if (insertError) {
    if (insertError.code !== '23505') throw insertError;
    const existing = await transport.find(photo.institutionId, photo.id);
    if (!existing || existing.asset_id !== meta.asset_id || existing.storage_path !== meta.storage_path || existing.file_name !== meta.file_name || existing.mime_type !== meta.mime_type || existing.file_size_bytes !== meta.file_size_bytes || existing.photo_kind !== meta.photo_kind || existing.caption !== meta.caption || existing.observation_id !== meta.observation_id || existing.width_px !== meta.width_px || existing.height_px !== meta.height_px || Date.parse(existing.captured_at) !== Date.parse(photo.capturedAt)) {
      throw new Error('Photo metadata conflicts with an existing record; review is required.');
    }
  }
}

export function supabasePhotoTransport(): PhotoReplayTransport {
  const client = getSupabaseClient();
  return {
    async upload(path, blob, mime) { return (await client.storage.from('asset-photos').upload(path, blob, { contentType: mime, upsert: false })).error; },
    async download(path) {
      const { data, error } = await client.storage.from('asset-photos').download(path);
      if (error || !data) throw error ?? new Error('Existing photo could not be downloaded for verification.');
      return data;
    },
    async insert(meta) { return (await client.from('asset_photos').insert(meta)).error; },
    async find(inst, id) {
      const { data, error } = await client.from('asset_photos').select('*').eq('institution_id', inst).eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
