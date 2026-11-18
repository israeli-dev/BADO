import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { institutionalKeys } from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import type {
  CreateAssetInput,
  ReviewVerificationInput,
} from '@/lib/assets/validation';
import type {
  UploadAssetDocumentInput,
  UploadAssetPhotoInput,
} from '@/lib/data';
import type { AssetCategory, AssetListFilters } from '@/types/domain';

export const assetKeys = {
  types: (institutionId: string, category?: AssetCategory) =>
    ['institution', institutionId, 'assetTypes', category ?? 'all'] as const,
  benchmarks: (institutionId: string, campusId?: string | null) =>
    [
      'institution',
      institutionId,
      'benchmarkRefs',
      campusId ?? 'all',
    ] as const,
  list: (institutionId: string, filters: AssetListFilters) =>
    ['institution', institutionId, 'assets', 'list', filters] as const,
  detail: (institutionId: string, assetId: string) =>
    ['institution', institutionId, 'assets', 'detail', assetId] as const,
};

export function useAssetTypes(category?: AssetCategory) {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: assetKeys.types(institutionId, category),
    queryFn: () => gateway.listAssetTypes(institutionId, category),
    enabled: Boolean(institutionId),
  });
}

export function useBenchmarkReferences(campusId?: string | null) {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: assetKeys.benchmarks(institutionId, campusId),
    queryFn: () => gateway.listBenchmarkReferences(institutionId, campusId),
    enabled: Boolean(institutionId),
  });
}

export function useAssets(filters: Omit<AssetListFilters, 'campusId'> = {}) {
  const { gateway, activeInstitution, activeCampusId } = useAuth();
  const institutionId = activeInstitution?.id ?? '';
  const merged: AssetListFilters = {
    ...filters,
    campusId: activeCampusId,
  };

  return useQuery({
    queryKey: assetKeys.list(institutionId, merged),
    queryFn: () => gateway.listAssets(institutionId, merged),
    enabled: Boolean(institutionId),
  });
}

export function useAssetDetail(assetId: string | undefined) {
  const { gateway, activeInstitution } = useAuth();
  const institutionId = activeInstitution?.id ?? '';

  return useQuery({
    queryKey: assetKeys.detail(institutionId, assetId ?? ''),
    queryFn: () => gateway.getAssetDetail(institutionId, assetId ?? ''),
    enabled: Boolean(institutionId) && Boolean(assetId),
  });
}

export function useCreateAsset() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAssetInput) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.createAsset(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useSubmitDraftAsset() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assetId: string) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.submitDraftAsset(activeInstitution.id, assetId);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useReviewAssetVerification() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReviewVerificationInput) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.reviewAssetVerification(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useArchiveAsset() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { assetId: string; reason: string }) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.archiveAsset(
        activeInstitution.id,
        params.assetId,
        params.reason,
      );
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useUploadAssetPhoto() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UploadAssetPhotoInput) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.uploadAssetPhoto(activeInstitution.id, input);
    },
    onSuccess: (_, variables) => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: assetKeys.detail(activeInstitution.id, variables.assetId),
      });
      void queryClient.invalidateQueries({
        queryKey: ['institution', activeInstitution.id, 'assets', 'list'],
      });
    },
  });
}

export function useUploadAssetDocument() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UploadAssetDocumentInput) => {
      if (!activeInstitution) throw new Error('No active institution selected.');
      return gateway.uploadAssetDocument(activeInstitution.id, input);
    },
    onSuccess: (_, variables) => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: assetKeys.detail(activeInstitution.id, variables.assetId),
      });
      void queryClient.invalidateQueries({
        queryKey: ['institution', activeInstitution.id, 'assets', 'list'],
      });
    },
  });
}
