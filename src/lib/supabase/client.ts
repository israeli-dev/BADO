import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runtimeConfig } from '@/lib/config/env';
import type { Database } from '@/types/database';

let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Returns the browser Supabase client initialised strictly with the public
 * anonymous/publishable key. All data isolation and permissions are enforced
 * by PostgreSQL Row Level Security (RLS).
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!runtimeConfig.supabaseConfigured || !runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
    throw new Error(
      'Supabase client requested, but VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not configured.',
    );
  }

  if (!cachedClient) {
    cachedClient = createClient<Database>(
      runtimeConfig.supabaseUrl,
      runtimeConfig.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }

  return cachedClient;
}
