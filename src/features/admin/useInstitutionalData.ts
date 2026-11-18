import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthContext';
import type {
  CreateCampusInput,
  CreateDepartmentInput,
  UpdateSettingsInput,
} from '@/lib/data';
import type { AppRole, LegendEntry } from '@/types/domain';

export const institutionalKeys = {
  all: (institutionId: string) => ['institution', institutionId] as const,
  campuses: (institutionId: string) =>
    ['institution', institutionId, 'campuses'] as const,
  departments: (institutionId: string) =>
    ['institution', institutionId, 'departments'] as const,
  settings: (institutionId: string) =>
    ['institution', institutionId, 'settings'] as const,
  members: (institutionId: string) =>
    ['institution', institutionId, 'members'] as const,
  auditLogs: (institutionId: string) =>
    ['institution', institutionId, 'auditLogs'] as const,
  dashboard: (institutionId: string, campusId: string | null) =>
    ['institution', institutionId, 'dashboard', campusId ?? 'all'] as const,
};

export function useCampuses() {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: institutionalKeys.campuses(institutionId),
    queryFn: () => gateway.listCampuses(institutionId),
    enabled: Boolean(institutionId),
  });
}

export function useDepartments() {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: institutionalKeys.departments(institutionId),
    queryFn: () => gateway.listDepartments(institutionId),
    enabled: Boolean(institutionId),
  });
}

export function useInstitutionSettings() {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: institutionalKeys.settings(institutionId),
    queryFn: () => gateway.getInstitutionSettings(institutionId),
    enabled: Boolean(institutionId),
  });
}

export function useInstitutionMembers(enabled = true) {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: institutionalKeys.members(institutionId),
    queryFn: () => gateway.listInstitutionMembers(institutionId),
    enabled: Boolean(institutionId) && enabled,
  });
}

export function useAuditLogs(enabled = true) {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: institutionalKeys.auditLogs(institutionId),
    queryFn: () => gateway.listAuditLogs(institutionId, 50),
    enabled: Boolean(institutionId) && enabled,
  });
}

export function useDashboardSummary() {
  const { gateway, activeInstitution, activeCampusId } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: institutionalKeys.dashboard(institutionId, activeCampusId),
    queryFn: () => gateway.getDashboardSummary(institutionId, activeCampusId),
    enabled: Boolean(institutionId),
  });
}

export function useCreateCampus() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCampusInput) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.createCampus(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useCreateDepartment() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateDepartmentInput) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.createDepartment(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useUpdateThresholds() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<UpdateSettingsInput, 'legendConfig'>) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.updateInstitutionThresholds(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.settings(activeInstitution.id),
      });
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.auditLogs(activeInstitution.id),
      });
    },
  });
}

export function useUpdateLegend() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (legend: LegendEntry[]) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.updateLegendConfig(activeInstitution.id, legend);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.settings(activeInstitution.id),
      });
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.auditLogs(activeInstitution.id),
      });
    },
  });
}

export function useUpdateMemberRole() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      membershipId: string;
      role: AppRole;
      isActive: boolean;
    }) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.updateMemberRole(
        activeInstitution.id,
        params.membershipId,
        params.role,
        params.isActive,
      );
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.members(activeInstitution.id),
      });
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.auditLogs(activeInstitution.id),
      });
    },
  });
}
