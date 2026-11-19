import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/app/AppLayout';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { SignInPage } from '@/features/auth/SignInPage';
import { SignUpPage } from '@/features/auth/SignUpPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PlannedModulePage } from '@/features/shared/PlannedModulePage';
import type { FoundationDataGateway } from '@/lib/data';

const AssetListPage = lazy(() =>
  import('@/features/assets/AssetListPage').then((m) => ({
    default: m.AssetListPage,
  })),
);
const AssetRegistrationPage = lazy(() =>
  import('@/features/assets/AssetRegistrationPage').then((m) => ({
    default: m.AssetRegistrationPage,
  })),
);
const AssetDetailPage = lazy(() =>
  import('@/features/assets/AssetDetailPage').then((m) => ({
    default: m.AssetDetailPage,
  })),
);
const AdminPage = lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const SyncQueuePage = lazy(() =>
  import('@/features/sync/SyncQueuePage').then((m) => ({
    default: m.SyncQueuePage,
  })),
);

const InfrastructureMapPage = lazy(() => import('@/features/map/InfrastructureMapPage').then(m => ({ default: m.InfrastructureMapPage })));
const LinearRoutePage = lazy(() => import('@/features/routes/LinearRoutePage').then(m => ({ default: m.LinearRoutePage })));

function RouteLoadingFallback() {
  return (
    <div role="status" className="py-12 text-center text-sm text-slate-600">
      Loading module…
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route
          path="assets"
          element={
            <ProtectedRoute requiredPermission="infrastructure:view">
              <Suspense fallback={<RouteLoadingFallback />}>
                <AssetListPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route
          path="assets/new"
          element={
            <ProtectedRoute requiredPermission="assets:create">
              <Suspense fallback={<RouteLoadingFallback />}>
                <AssetRegistrationPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route
          path="assets/:assetId"
          element={
            <ProtectedRoute requiredPermission="infrastructure:view">
              <Suspense fallback={<RouteLoadingFallback />}>
                <AssetDetailPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route path="map" element={<ProtectedRoute requiredPermission="infrastructure:view"><Suspense fallback={<RouteLoadingFallback />}><InfrastructureMapPage /></Suspense></ProtectedRoute>} />
        <Route path="routes/new" element={<ProtectedRoute requiredPermission="routes:record"><Suspense fallback={<RouteLoadingFallback />}><LinearRoutePage /></Suspense></ProtectedRoute>} />
        <Route path="routes/:assetId/edit" element={<ProtectedRoute requiredPermission="routes:edit_geometry"><Suspense fallback={<RouteLoadingFallback />}><LinearRoutePage /></Suspense></ProtectedRoute>} />

        <Route
          path="dig-check"
          element={
            <ProtectedRoute requiredPermission="dig_check:run">
              <PlannedModulePage
                title="Check Before You Dig"
                phaseLabel="Phase 4"
                summary="Spatial intersection and awareness-buffer analysis for proposed excavation sites."
                showExcavationNotice
                plannedCapabilities={[
                  'Select a point or draw a proposed excavation polygon with a configurable awareness buffer.',
                  'PostGIS geography queries measuring distance against actual pipeline and cable route geometries.',
                  'Structured proximity report showing utility type, recorded depths, verification status, last update, and photos.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="live"
          element={
            <ProtectedRoute requiredPermission="live_mode:use">
              <PlannedModulePage
                title="BADO Live"
                phaseLabel="Phase 5"
                summary="Foreground GPS proximity awareness relative to documented campus infrastructure."
                showExcavationNotice
                plannedCapabilities={[
                  'Explicit Start / Stop foreground location watcher with unmount cleanup and zero location-history storage.',
                  'Live user marker, GPS accuracy pairing, and configurable Nearby / Approaching / Close awareness alerts with cooldowns.',
                  'Offline cached infrastructure awareness showing exact cache age and explicit completeness warnings.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="passports"
          element={
            <ProtectedRoute requiredPermission="passports:view">
              <PlannedModulePage
                title="Borehole Passports"
                phaseLabel="Phase 6"
                summary="Specialised digital asset passports linked directly to the institutional asset registry."
                plannedCapabilities={[
                  'Drilling and construction specifications, casing/screen intervals, lithological logs, and hydrogeological test data.',
                  'Installed pump/equipment records, dated laboratory water-quality reports, and chronological maintenance logs.',
                  'Stable QR code generation, printable asset labels, and extensible architecture for future facility passports.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="scan"
          element={
            <ProtectedRoute requiredPermission="passports:view">
              <PlannedModulePage
                title="Scan Asset QR Code"
                phaseLabel="Phase 6"
                summary="Camera QR scanner and manual identifier lookup for Borehole Passports."
                plannedCapabilities={[
                  'Mobile camera QR scanning opening the linked digital passport with role-based permissions.',
                  'Manual QR code / Borehole ID lookup fallback for low-light or damaged labels.',
                  'Quick inspection and maintenance logging for authorised field personnel.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="operations"
          element={
            <ProtectedRoute requiredPermission="infrastructure:view">
              <PlannedModulePage
                title="Inspections & Maintenance"
                phaseLabel="Phase 6"
                summary="Chronological field inspection reports, servicing, repairs, faults, and downtime logs."
                plannedCapabilities={[
                  'Unified inspection and maintenance logging across boreholes, surface facilities, and utility routes.',
                  'Offline-capable report submission with inspection photographs and technician remarks.',
                  'Supervisor review queue and auditable operational change history.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="reports"
          element={
            <ProtectedRoute requiredPermission="reports:view">
              <PlannedModulePage
                title="Reports & GIS Exports"
                phaseLabel="Phase 8"
                summary="Permission-aware institutional infrastructure inventories and desktop GIS data exchange."
                plannedCapabilities={[
                  'Surface asset, underground utility, borehole, maintenance, and pending-verification registers.',
                  'CSV, RFC 7946 GeoJSON, and printable PDF report generation respecting user permissions.',
                  'Documented authorised PostGIS connection workflow for QGIS spatial analysis.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="sync"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <SyncQueuePage />
            </Suspense>
          }
        />

        <Route
          path="admin"
          element={
            <ProtectedRoute requiredPermission="admin:access">
              <Suspense fallback={<RouteLoadingFallback />}>
                <AdminPage />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App({ gateway }: { gateway?: FoundationDataGateway }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider gateway={gateway}>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
