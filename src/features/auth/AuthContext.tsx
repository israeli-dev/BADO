import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  dataGateway as defaultDataGateway,
  type FoundationDataGateway,
  type SignInInput,
  type SignUpInput,
} from '@/lib/data';
import { roleHasPermission, type Permission } from '@/lib/permissions/rbac';
import type {
  AppRole,
  AuthSessionState,
  Institution,
  UserInstitutionMembership,
} from '@/types/domain';

export interface AuthContextValue {
  gateway: FoundationDataGateway;
  session: AuthSessionState | null;
  isLoading: boolean;
  sessionError: string | null;
  activeMembership: UserInstitutionMembership | null;
  activeInstitution: Institution | null;
  activeRole: AppRole | null;
  activeCampusId: string | null;
  selectInstitution: (institutionId: string) => void;
  selectCampus: (campusId: string | null) => void;
  can: (permission: Permission) => boolean;
  signInWithPassword: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<boolean>;
  signInAsDemoUser: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVE_INST_KEY = 'bado.ui.activeInstitutionId';
const ACTIVE_CAMPUS_KEY = 'bado.ui.activeCampusId';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors in private/restricted browsers.
  }
}

export function AuthProvider({
  children,
  gateway = defaultDataGateway,
}: {
  children: ReactNode;
  gateway?: FoundationDataGateway;
}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionRequest = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(
    () => readStorage(ACTIVE_INST_KEY),
  );
  const [activeCampusId, setActiveCampusId] = useState<string | null>(() =>
    readStorage(ACTIVE_CAMPUS_KEY),
  );

  const refreshSession = useCallback(async () => {
    const request = ++sessionRequest.current;
    try {
      const next = await gateway.getSession();
      if (request !== sessionRequest.current) return;
      const nextId = next?.user.id ?? null;
      if (sessionUserId.current !== nextId) queryClient.clear();
      sessionUserId.current = nextId;
      setSession(next);
      setSessionError(null);
    } catch (error) {
      if (request !== sessionRequest.current) return;
      sessionUserId.current = null;
      queryClient.clear();
      setSession(null);
      setSessionError(error instanceof Error ? error.message : 'Unable to load your session.');
    } finally {
      if (request === sessionRequest.current) setIsLoading(false);
    }
  }, [gateway, queryClient]);

  useEffect(() => {
    void refreshSession();
    const requestRef = sessionRequest;
    const unsubscribe = gateway.onAuthStateChange(() => {
      setIsLoading(true);
      void refreshSession();
    });
    return () => { requestRef.current++; unsubscribe(); };
  }, [gateway, refreshSession]);

  const activeMembership = useMemo<UserInstitutionMembership | null>(() => {
    if (!session || session.memberships.length === 0) return null;
    if (selectedInstitutionId) {
      const matched = session.memberships.find(
        (m) => m.institutionId === selectedInstitutionId && m.isActive,
      );
      if (matched) return matched;
    }
    return session.memberships[0] ?? null;
  }, [session, selectedInstitutionId]);

  const activeInstitution = activeMembership?.institution ?? null;
  const activeRole = activeMembership?.role ?? null;

  // Reset campus filter whenever user switches to an institution where the
  // stored campus isn't permitted, preventing stale cross-tenant campus filters.
  useEffect(() => {
    if (!activeMembership) {
      setActiveCampusId(null);
      writeStorage(ACTIVE_CAMPUS_KEY, null);
      return;
    }
    if (
      activeCampusId &&
      activeMembership.allowedCampusIds !== null &&
      !activeMembership.allowedCampusIds.includes(activeCampusId)
    ) {
      setActiveCampusId(null);
      writeStorage(ACTIVE_CAMPUS_KEY, null);
    }
  }, [activeMembership, activeCampusId]);

  const selectInstitution = useCallback(
    (institutionId: string) => {
      setSelectedInstitutionId(institutionId);
      writeStorage(ACTIVE_INST_KEY, institutionId);
      setActiveCampusId(null);
      writeStorage(ACTIVE_CAMPUS_KEY, null);
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const selectCampus = useCallback((campusId: string | null) => {
    setActiveCampusId(campusId);
    writeStorage(ACTIVE_CAMPUS_KEY, campusId);
  }, []);

  const can = useCallback(
    (permission: Permission) => roleHasPermission(activeRole, permission),
    [activeRole],
  );

  const signInWithPassword = useCallback(
    async (input: SignInInput) => {
      const next = await gateway.signInWithPassword(input);
      sessionRequest.current++;
      sessionUserId.current = next.user.id;
      setSessionError(null);
      setIsLoading(false);
      setSession(next);
      const primaryInst = next.memberships[0]?.institutionId ?? null;
      setSelectedInstitutionId(primaryInst);
      writeStorage(ACTIVE_INST_KEY, primaryInst);
      setActiveCampusId(null);
      writeStorage(ACTIVE_CAMPUS_KEY, null);
      queryClient.clear();
    },
    [gateway, queryClient],
  );

  const signUp = useCallback(async (input: SignUpInput) => {
    const next = await gateway.signUp(input);
    if (!next) return false;
    sessionRequest.current++;
    sessionUserId.current = next.user.id;
    setSessionError(null);
    setIsLoading(false);
    setSession(next);
    setSelectedInstitutionId(null);
    setActiveCampusId(null);
    writeStorage(ACTIVE_INST_KEY, null);
    writeStorage(ACTIVE_CAMPUS_KEY, null);
    queryClient.clear();
    return true;
  }, [gateway, queryClient]);

  const signInAsDemoUser = useCallback(
    async (userId: string) => {
      const next = await gateway.signInAsDemoUser(userId);
      sessionRequest.current++;
      sessionUserId.current = next.user.id;
      setSessionError(null);
      setIsLoading(false);
      setSession(next);
      const primaryInst = next.memberships[0]?.institutionId ?? null;
      setSelectedInstitutionId(primaryInst);
      writeStorage(ACTIVE_INST_KEY, primaryInst);
      setActiveCampusId(null);
      writeStorage(ACTIVE_CAMPUS_KEY, null);
      queryClient.clear();
    },
    [gateway, queryClient],
  );

  const signOut = useCallback(async () => {
    await gateway.signOut();
    sessionRequest.current++;
    sessionUserId.current = null;
    setSessionError(null);
    setIsLoading(false);
    setSession(null);
    setSelectedInstitutionId(null);
    setActiveCampusId(null);
    writeStorage(ACTIVE_INST_KEY, null);
    writeStorage(ACTIVE_CAMPUS_KEY, null);
    queryClient.clear();
  }, [gateway, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      gateway,
      session,
      isLoading,
      sessionError,
      activeMembership,
      activeInstitution,
      activeRole,
      activeCampusId,
      selectInstitution,
      selectCampus,
      can,
      signInWithPassword,
      signUp,
      signInAsDemoUser,
      signOut,
      refreshSession,
    }),
    [
      gateway,
      session,
      isLoading,
      sessionError,
      activeMembership,
      activeInstitution,
      activeRole,
      activeCampusId,
      selectInstitution,
      selectCampus,
      can,
      signInWithPassword,
      signUp,
      signInAsDemoUser,
      signOut,
      refreshSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
