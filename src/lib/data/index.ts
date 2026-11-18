import { runtimeConfig } from '@/lib/config/env';
import type { FoundationDataGateway } from '@/lib/data/gateway';
import { LocalDemoDataGateway } from '@/lib/data/localDemoGateway';
import { SupabaseDataGateway } from '@/lib/data/supabaseGateway';

export const dataGateway: FoundationDataGateway =
  runtimeConfig.dataMode === 'supabase'
    ? new SupabaseDataGateway()
    : new LocalDemoDataGateway();

export * from './gateway';
