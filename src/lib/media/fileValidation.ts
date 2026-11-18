export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

export const MAX_RAW_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB raw camera input
export const MAX_STORED_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB after compression
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB (PDF, CSV, GeoJSON, TXT)

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'application/geo+json',
  'application/json',
  'text/plain',
] as const;

export interface PreparedPhotoFile {
  blob: Blob;
  fileName: string;
  mimeType: AllowedPhotoMimeType;
  fileSizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
}

export interface ValidatedDocumentFile {
  blob: Blob;
  fileName: string;
  mimeType: (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];
  fileSizeBytes: number;
}

export function sanitizeStorageFileName(fileName: string): string {
  const cleaned = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (cleaned || 'file').slice(0, 120);
}

export function validatePhotoFile(file: File): AllowedPhotoMimeType {
  if (
    !(ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)
  ) {
    throw new Error(
      `Unsupported image format "${file.type || 'unknown'}". Allowed formats: JPEG, PNG, and WebP.`,
    );
  }
  if (file.size <= 0) {
    throw new Error('Selected photo file is empty.');
  }
  if (file.size > MAX_RAW_PHOTO_BYTES) {
    throw new Error(
      'Photo exceeds the 15 MB maximum upload limit. Capture at standard camera resolution.',
    );
  }
  return file.type as AllowedPhotoMimeType;
}

/**
 * Normalises MIME types for technical field documents (browsers frequently
 * report `.geojson` or `.csv` files with an empty or generic MIME string).
 */
export function validateDocumentFile(file: File): ValidatedDocumentFile {
  if (file.size <= 0) {
    throw new Error('Selected document file is empty.');
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error('Document exceeds the 15 MB maximum size limit.');
  }

  const lowerName = file.name.toLowerCase();
  let resolvedMime = file.type;

  if (lowerName.endsWith('.geojson')) {
    resolvedMime = 'application/geo+json';
  } else if (lowerName.endsWith('.json') && !resolvedMime) {
    resolvedMime = 'application/json';
  } else if (lowerName.endsWith('.csv') && (!resolvedMime || resolvedMime === 'application/vnd.ms-excel')) {
    resolvedMime = 'text/csv';
  } else if (lowerName.endsWith('.pdf') && !resolvedMime) {
    resolvedMime = 'application/pdf';
  } else if ((lowerName.endsWith('.txt') || lowerName.endsWith('.log')) && !resolvedMime) {
    resolvedMime = 'text/plain';
  }

  if (
    !(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(resolvedMime)
  ) {
    throw new Error(
      `Unsupported document type "${file.type || lowerName}". Allowed formats: PDF, CSV, GeoJSON, JSON, and TXT.`,
    );
  }

  return {
    blob: file,
    fileName: sanitizeStorageFileName(file.name),
    mimeType: resolvedMime as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number],
    fileSizeBytes: file.size,
  };
}

/**
 * Compresses large field photographs client-side (max 1600 px edge, JPEG 0.82)
 * to conserve mobile data and IndexedDB offline quota on Android devices.
 * Falls back cleanly to the validated original file for small images or
 * non-canvas test environments.
 */
export async function preparePhotoForStorage(
  file: File,
  maxDimensionPx = 1600,
  quality = 0.82,
): Promise<PreparedPhotoFile> {
  const validatedMime = validatePhotoFile(file);
  const safeName = sanitizeStorageFileName(file.name);

  // Skip re-encoding already compact files (< 350 KB) or non-canvas environments
  if (
    file.size < 350 * 1024 ||
    typeof createImageBitmap !== 'function' ||
    typeof document === 'undefined'
  ) {
    if (file.size > MAX_STORED_PHOTO_BYTES) {
      throw new Error('Photo exceeds the 10 MB storage limit.');
    }
    return {
      blob: file,
      fileName: safeName,
      mimeType: validatedMime,
      fileSizeBytes: file.size,
      widthPx: null,
      heightPx: null,
    };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      maxDimensionPx / Math.max(bitmap.width, bitmap.height),
    );
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return {
        blob: file,
        fileName: safeName,
        mimeType: validatedMime,
        fileSizeBytes: file.size,
        widthPx: targetWidth,
        heightPx: targetHeight,
      };
    }

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });

    if (!compressed || compressed.size >= file.size) {
      if (file.size > MAX_STORED_PHOTO_BYTES) {
        throw new Error('Compressed photo still exceeds the 10 MB limit.');
      }
      return {
        blob: file,
        fileName: safeName,
        mimeType: validatedMime,
        fileSizeBytes: file.size,
        widthPx: targetWidth,
        heightPx: targetHeight,
      };
    }

    const jpgName = safeName.replace(/\.(png|webp|jpeg|jpg)$/i, '') + '.jpg';
    return {
      blob: compressed,
      fileName: jpgName,
      mimeType: 'image/jpeg',
      fileSizeBytes: compressed.size,
      widthPx: targetWidth,
      heightPx: targetHeight,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('10 MB')) {
      throw error;
    }
    return {
      blob: file,
      fileName: safeName,
      mimeType: validatedMime,
      fileSizeBytes: file.size,
      widthPx: null,
      heightPx: null,
    };
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
