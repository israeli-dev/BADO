# Linear mapping (work in progress)

The route editor supports foreground GPS capture, manual points and GeoJSON import in EPSG:4326. It displays geodesic length and supports moving, deleting and inserting vertices. GPS capture is explicitly started and is stopped on exit; accuracy does not imply survey-grade positioning. Burial depth must be measured independently, never inferred from GPS elevation.

The route editor does not yet provide the planned multi-point depth and junction editing forms, dynamic route attributes, or trench-photo attachment. Offline operations may be queued, but end-to-end replay of the new route payloads and transactional remote writes still require implementation and verification. Do not use this work-in-progress for production field records.
