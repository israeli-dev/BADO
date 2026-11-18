import { useMutation, useQueryClient } from '@tanstack/react-query';
import { institutionalKeys } from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import type {
  AddDepthObservationInput,
  CreateLinearRouteInput,
  UpdateRouteGeometryInput,
} from '@/lib/assets/validation';
import type { BadoGeoJsonFeatureCollection } from '@/lib/gis/geojsonIo';
import type { AssetListFilters } from '@/types/domain';

export function triggerGeoJsonDownload(
  collection: BadoGeoJsonFeatureCollection,
  filenamePrefix: string,
): string {
  const safePrefix = filenamePrefix
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${safePrefix || 'bado-export'}-${dateStamp}.geojson`;
  const json = JSON.stringify(collection, null, 2);
  const blob = new Blob([json], { type: 'application/geo+json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

export function useCreateLinearRoute() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateLinearRouteInput) => {
      if (!activeInstitution) {
        throw new Error('No active institution selected.');
      }
      return gateway.createLinearRoute(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useUpdateRouteGeometry() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateRouteGeometryInput) => {
      if (!activeInstitution) {
        throw new Error('No active institution selected.');
      }
      return gateway.updateRouteGeometry(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useAddDepthObservation() {
  const { gateway, activeInstitution } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddDepthObservationInput) => {
      if (!activeInstitution) {
        throw new Error('No active institution selected.');
      }
      return gateway.addDepthObservation(activeInstitution.id, input);
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.all(activeInstitution.id),
      });
    },
  });
}

export function useExportAssetsGeoJson() {
  const { gateway, activeInstitution, activeCampusId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filters: Omit<AssetListFilters, 'campusId'> = {}) => {
      if (!activeInstitution) {
        throw new Error('No active institution selected.');
      }
      return gateway.exportAssetsGeoJson(activeInstitution.id, {
        ...filters,
        campusId: activeCampusId,
      });
    },
    onSuccess: () => {
      if (!activeInstitution) return;
      void queryClient.invalidateQueries({
        queryKey: institutionalKeys.auditLogs(activeInstitution.id),
      });
    },
  });
}
