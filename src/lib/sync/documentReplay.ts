import { badoDb, type BadoLocalDatabase } from '@/lib/db/badoDb';
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES } from '@/lib/media/fileValidation';
import { sameBytes } from '@/lib/sync/photoReplay';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/types/database';
import type { SyncQueueRecord } from '@/types/domain';

type DocumentInsert = Database['public']['Tables']['asset_documents']['Insert'];
type DocumentRow = Database['public']['Tables']['asset_documents']['Row'];
type Failure = { message: string; code?: string; status?: number; statusCode?: string };
export interface DocumentReplayTransport {
  upload(path: string, blob: Blob, mime: string): Promise<Failure | null>;
  download(path: string): Promise<Blob>;
  insert(meta: DocumentInsert): Promise<Failure | null>;
  find(institutionId: string, id: string): Promise<DocumentRow | null>;
}

/** Storage and metadata commit separately. Only acknowledge verified identical retries. */
export async function replayDocument(item: SyncQueueRecord, transport: DocumentReplayTransport, db: BadoLocalDatabase = badoDb): Promise<void> {
  if (item.recordType !== 'asset_documents' || item.operationType !== 'upload_document') throw new Error('Unsupported document mutation.');
  const document = await db.assetDocuments.get(item.recordId);
  if (!document || document.institutionId !== item.institutionId || !document.localBlobId) throw new Error('Document metadata or local blob reference is missing.');
  const queuedMeta = item.payload.meta;
  if (!queuedMeta || typeof queuedMeta !== 'object' || !('assetId' in queuedMeta) || queuedMeta.assetId !== document.assetId || item.payload.localBlobId !== document.localBlobId) throw new Error('Queued document references do not match local metadata.');
  const blob = await db.localMediaBlobs.get(document.localBlobId);
  if (!blob || blob.institutionId !== item.institutionId || blob.assetId !== document.assetId || blob.mediaKind !== 'document') throw new Error('Document bytes are unavailable on this device.');
  if (!item.campusId || !document.storagePath.startsWith(`${item.institutionId}/${item.campusId}/${document.assetId}/docs/`) || !(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(document.mimeType) || blob.blob.size !== document.fileSizeBytes || blob.blob.size <= 0 || blob.blob.size > MAX_DOCUMENT_BYTES || blob.mimeType !== document.mimeType) throw new Error('Document metadata does not match its original capture.');

  const uploadError = await transport.upload(document.storagePath, blob.blob, document.mimeType);
  if (uploadError) {
    if (uploadError.status !== 409 && uploadError.statusCode !== '409' && uploadError.code !== 'Duplicate') throw uploadError;
    if (!await sameBytes(blob.blob, await transport.download(document.storagePath))) throw new Error('A different file already exists at the document path; review is required.');
  }
  const meta: DocumentInsert = {
    id: document.id, institution_id: document.institutionId, asset_id: document.assetId,
    storage_path: document.storagePath, file_name: document.fileName, mime_type: document.mimeType,
    file_size_bytes: document.fileSizeBytes, document_kind: document.documentKind,
    title: document.title, description: document.description,
  };
  const insertError = await transport.insert(meta);
  if (insertError) {
    if (insertError.code !== '23505') throw insertError;
    const existing = await transport.find(document.institutionId, document.id);
    if (!existing || existing.asset_id !== meta.asset_id || existing.storage_path !== meta.storage_path || existing.file_name !== meta.file_name || existing.mime_type !== meta.mime_type || existing.file_size_bytes !== meta.file_size_bytes || existing.document_kind !== meta.document_kind || existing.title !== meta.title || existing.description !== meta.description) throw new Error('Document metadata conflicts with an existing record; review is required.');
  }
}

export function supabaseDocumentTransport(): DocumentReplayTransport {
  const client = getSupabaseClient();
  return {
    async upload(path, blob, mime) { return (await client.storage.from('asset-documents').upload(path, blob, { contentType: mime, upsert: false })).error; },
    async download(path) {
      const { data, error } = await client.storage.from('asset-documents').download(path);
      if (error || !data) throw error ?? new Error('Existing document could not be downloaded for verification.');
      return data;
    },
    async insert(meta) { return (await client.from('asset_documents').insert(meta)).error; },
    async find(inst, id) {
      const { data, error } = await client.from('asset_documents').select('*').eq('institution_id', inst).eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
