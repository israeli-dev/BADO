import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  dataGateway as defaultDataGateway,
  type FoundationDataGateway,
  type SignInInput,
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
  activeMembership: UserInstitutionMembership | null;
  activeInstitution: Institution | null;
  activeRole: AppRole | null;
  activeCampusId: string | null;
  selectInstitution: (institutionId: string) => void;
  selectCampus: (campusId: string | null) => void;
  can: (permission: Permission) => boolean;
  signInWithPassword: (input: SignInInput) => Promise<void>;
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
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(
    () => readStorage(ACTIVE_INST_KEY),
  );
  const [activeCampusId, setActiveCampusId] = useState<string | null>(() =>
    readStorage(ACTIVE_CAMPUS_KEY),
  );

  const refreshSession = useCallback(async () => {
    try {
      const next = await gateway.getSession();
      setSession(next);
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    void refreshSession();
    return gateway.onAuthStateChange(() => {
      void refreshSession();
    });
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

  const signInAsDemoUser = useCallback(
    async (userId: string) => {
      const next = await gateway.signInAsDemoUser(userId);
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
      activeMembership,
      activeInstitution,
      activeRole,
      activeCampusId,
      selectInstitution,
      selectCampus,
      can,
      signInWithPassword,
      signInAsDemoUser,
      signOut,
      refreshSession,
    }),
    [
      gateway,
      session,
      isLoading,
      activeMembership,
      activeInstitution,
      activeRole,
      activeCampusId,
      selectInstitution,
      selectCampus,
      can,
      signInWithPassword,
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
