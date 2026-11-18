import { describe, expect, it } from 'vitest';
import {
  assertNotServiceRoleKey,
  parseRuntimeConfig,
} from '@/lib/config/env';

function buildFakeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('runtime environment configuration & secret guards', () => {
  it('defaults safely to demo mode when Supabase variables are absent', () => {
    const config = parseRuntimeConfig({});
    expect(config.dataMode).toBe('demo');
    expect(config.supabaseConfigured).toBe(false);
    expect(config.supabaseUrl).toBeNull();
    expect(config.supabaseAnonKey).toBeNull();
  });

  it('activates supabase mode when URL and anon JWT are provided', () => {
    const anonJwt = buildFakeJwt({ role: 'anon', iss: 'supabase' });
    const config = parseRuntimeConfig({
      VITE_SUPABASE_URL: 'https://example-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: anonJwt,
      VITE_BADO_DATA_MODE: 'auto',
    });

    expect(config.dataMode).toBe('supabase');
    expect(config.supabaseConfigured).toBe(true);
    expect(config.supabaseUrl).toBe('https://example-project.supabase.co');
  });

  it('fails fast if supabase mode is explicitly forced without credentials', () => {
    expect(() =>
      parseRuntimeConfig({ VITE_BADO_DATA_MODE: 'supabase' }),
    ).toThrow(/CONFIGURATION ERROR/);
  });

  it('rejects malformed VITE_SUPABASE_URL values', () => {
    expect(() =>
      parseRuntimeConfig({
        VITE_SUPABASE_URL: 'not-a-valid-url',
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_test',
      }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it('rejects accidental exposure of a Supabase service_role JWT', () => {
    const serviceRoleJwt = buildFakeJwt({ role: 'service_role', iss: 'supabase' });
    expect(() => assertNotServiceRoleKey(serviceRoleJwt)).toThrow(
      /SECURITY ERROR.*service_role/,
    );
  });

  it('rejects accidental exposure of an sb_secret_* key', () => {
    expect(() => assertNotServiceRoleKey('sb_secret_1234567890')).toThrow(
      /SECURITY ERROR.*sb_secret_/,
    );
  });
});
