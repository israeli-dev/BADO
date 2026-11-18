import { z } from 'zod';

export type DataMode = 'supabase' | 'demo';

export interface BadoRuntimeConfig {
  dataMode: DataMode;
  supabaseConfigured: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  mapTileUrl: string;
  mapTileAttribution: string;
}

const rawEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().trim().optional().default(''),
  VITE_SUPABASE_ANON_KEY: z.string().trim().optional().default(''),
  VITE_BADO_DATA_MODE: z
    .enum(['auto', 'supabase', 'demo'])
    .optional()
    .default('auto'),
  VITE_MAP_TILE_URL: z
    .string()
    .trim()
    .optional()
    .default('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
  VITE_MAP_TILE_ATTRIBUTION: z
    .string()
    .trim()
    .optional()
    .default(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ),
});

/**
 * Defensive security check: rejects accidental placement of a Supabase
 * `service_role` JWT or `sb_secret_*` key into browser-exposed VITE_ variables.
 */
export function assertNotServiceRoleKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('sb_secret_')) {
    throw new Error(
      'SECURITY ERROR: Detected a Supabase secret key (sb_secret_*) in VITE_SUPABASE_ANON_KEY. Only publishable/anon keys may be used in frontend code.',
    );
  }

  const parts = trimmed.split('.');
  if (parts.length === 3) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const decoded = JSON.parse(atob(padded)) as { role?: unknown };
      if (decoded.role === 'service_role') {
        throw new Error(
          'SECURITY ERROR: Detected a Supabase service_role JWT in VITE_SUPABASE_ANON_KEY. Service-role keys bypass Row Level Security and must NEVER be exposed in frontend code.',
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('SECURITY ERROR:')) {
        throw error;
      }
      // Non-JSON or opaque token format; allow through.
    }
  }
}

export function parseRuntimeConfig(
  rawEnv: Record<string, unknown>,
): BadoRuntimeConfig {
  const normalized: Record<string, unknown> = { ...rawEnv };
  if (normalized.VITE_BADO_DATA_MODE === '') {
    delete normalized.VITE_BADO_DATA_MODE;
  }
  if (normalized.VITE_MAP_TILE_URL === '') {
    delete normalized.VITE_MAP_TILE_URL;
  }
  if (normalized.VITE_MAP_TILE_ATTRIBUTION === '') {
    delete normalized.VITE_MAP_TILE_ATTRIBUTION;
  }

  const parsed = rawEnvSchema.parse(normalized);

  if (parsed.VITE_SUPABASE_ANON_KEY) {
    assertNotServiceRoleKey(parsed.VITE_SUPABASE_ANON_KEY);
  }

  const hasUrl = parsed.VITE_SUPABASE_URL.length > 0;
  const hasKey = parsed.VITE_SUPABASE_ANON_KEY.length > 0;

  if (hasUrl) {
    const urlCheck = z.url().safeParse(parsed.VITE_SUPABASE_URL);
    if (!urlCheck.success || !/^https?:\/\//i.test(parsed.VITE_SUPABASE_URL)) {
      throw new Error(
        'CONFIGURATION ERROR: VITE_SUPABASE_URL must be a valid HTTP(S) URL.',
      );
    }
  }

  const supabaseConfigured = hasUrl && hasKey;

  if (parsed.VITE_BADO_DATA_MODE === 'supabase' && !supabaseConfigured) {
    throw new Error(
      'CONFIGURATION ERROR: VITE_BADO_DATA_MODE is set to "supabase", but VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing.',
    );
  }

  const dataMode: DataMode =
    parsed.VITE_BADO_DATA_MODE === 'demo'
      ? 'demo'
      : supabaseConfigured
        ? 'supabase'
        : 'demo';

  return {
    dataMode,
    supabaseConfigured,
    supabaseUrl: supabaseConfigured ? parsed.VITE_SUPABASE_URL : null,
    supabaseAnonKey: supabaseConfigured ? parsed.VITE_SUPABASE_ANON_KEY : null,
    mapTileUrl: parsed.VITE_MAP_TILE_URL,
    mapTileAttribution: parsed.VITE_MAP_TILE_ATTRIBUTION,
  };
}

export const runtimeConfig: BadoRuntimeConfig = parseRuntimeConfig(
  import.meta.env as Record<string, unknown>,
);
