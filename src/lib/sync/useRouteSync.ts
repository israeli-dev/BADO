import { useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { badoDb } from '@/lib/db/badoDb';
import { processRouteQueue, replayRouteToSupabase } from '@/lib/sync/routeReplay';
import { useOnlineStatus } from '@/lib/sync/useOnlineStatus';

/** Replay supported asset mutations for the active authenticated user. */
export function useRouteSync(): void {
  const { gateway, activeInstitution, session } = useAuth();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const runRef = useRef<() => void>(() => {});
  const institutionId = activeInstitution?.id;
  const actorId = session?.user.id;
  const pendingCount = useLiveQuery(async () => {
    if (!institutionId) return 0;
    return badoDb.syncQueue.where('institutionId').equals(institutionId).filter(row => row.status === 'pending').count();
  }, [institutionId]);

  useEffect(() => {
    if (gateway.mode !== 'supabase' || !online || !institutionId || !actorId) {
      runRef.current = () => {};
      return;
    }
    let active = true;
    const run = async () => {
      if (!active || running.current) return;
      running.current = true;
      try {
        const done = await processRouteQueue(institutionId, actorId, async (item, assetId, operation) => {
          if (!active) throw new Error('Session or institution changed; requeue to try again.');
          await replayRouteToSupabase(item, assetId, operation);
        });
        if (done && active) await queryClient.invalidateQueries({ queryKey: ['institution', institutionId] });
      } catch (error) {
        // Local IndexedDB failures are not remote acknowledgements; leave entries intact.
        console.error('Sync queue could not be processed:', error);
      } finally { running.current = false; }
    };
    runRef.current = () => void run();
    runRef.current();
    const timer = window.setInterval(() => runRef.current(), 30_000);
    return () => { active = false; runRef.current = () => {}; window.clearInterval(timer); };
  }, [gateway.mode, online, institutionId, actorId, queryClient]);
  useEffect(() => { if (pendingCount) runRef.current(); }, [pendingCount]);
}
