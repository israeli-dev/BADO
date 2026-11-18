import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/app/AppLayout';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { SignInPage } from '@/features/auth/SignInPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PlannedModulePage } from '@/features/shared/PlannedModulePage';
import type { FoundationDataGateway } from '@/lib/data';

const AdminPage = lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const SyncQueuePage = lazy(() =>
  import('@/features/sync/SyncQueuePage').then((m) => ({
    default: m.SyncQueuePage,
  })),
);

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
              <PlannedModulePage
                title="Institutional Asset Registry"
                phaseLabel="Phase 2"
                summary="Centralised register of surface facilities, underground utilities, and survey control benchmarks."
                plannedCapabilities={[
                  'Searchable, campus-scoped asset inventory with verification and data-quality badges.',
                  'Detailed asset views with GNSS accuracy metadata, photographs, documents, and approval history.',
                  'Supervisor review workflow (Draft, Submitted, Under Review, Verified, Rejected, Needs Re-survey).',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="assets/new"
          element={
            <ProtectedRoute requiredPermission="assets:create">
              <PlannedModulePage
                title="Log New Asset"
                phaseLabel="Phase 2"
                summary="Dynamic registration workflow for surface assets, underground infrastructure, and survey benchmarks."
                plannedCapabilities={[
                  'Category- and type-aware forms validated with Zod (boreholes, transformers, valves, cables, benchmarks).',
                  'Smartphone GPS & GNSS-ready metadata capture plus map pin placement/adjustment.',
                  'Compressed offline-ready photo attachments, burial depth entries, and benchmark references.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="map"
          element={
            <ProtectedRoute requiredPermission="infrastructure:view">
              <PlannedModulePage
                title="Infrastructure Map"
                phaseLabel="Phase 3"
                summary="Interactive Leaflet & PostGIS campus infrastructure map with configurable legend and layer filtering."
                plannedCapabilities={[
                  'Campus boundaries, surface asset markers, continuous utility polylines, and survey benchmarks.',
                  'Filtering by campus, category, utility group, operational condition, and verification status.',
                  'Slide-up asset and route detail panels with depth observations and photographs.',
                ]}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="routes/new"
          element={
            <ProtectedRoute requiredPermission="routes:record">
              <PlannedModulePage
                title="Trace Linear Infrastructure"
                phaseLabel="Phase 3"
                summary="Continuous LINESTRING route documentation for pipelines, electrical cables, fibre ducts, and drainage."
                plannedCapabilities={[
                  'GPS Walk-and-Record with explicit Start, Pause/Resume, accuracy readout, bends, junctions, and trench photos.',
                  'Manual interactive map vertex drawing and editing for authorised roles.',
                  'Validated GeoJSON import/export and multi-point burial depth observations along each route.',
                ]}
              />
            </ProtectedRoute>
          }
        />

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
