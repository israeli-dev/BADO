# GIS architecture (Phase 3 work in progress)

The map uses Leaflet with configurable raster tiles, institutional legend settings, and WGS84 GeoJSON geometries. Turf provides geodesic distance and snapping. The PostGIS migration adds route vertices, depth observations, junctions, length calculation, RLS and QGIS-oriented views. Apply migrations and verify policies against a real Supabase environment before deployment; the migration has not been integration-tested here.

The map is an awareness tool, not an excavation clearance or proof that infrastructure is absent. Tile availability depends on the configured provider and network connectivity. Data may be incomplete, out of date, or inaccurate.
