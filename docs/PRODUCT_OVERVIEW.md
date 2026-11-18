# BADO — Product Overview

## Identity
- **Name:** BADO (*Buried Asset Documentation & Operations*) — University Edition
- **Tagline:** *Document Before Covering. Check Before Digging.*
- **Primary Target:** University Works & Maintenance Directorates, plumbers, electricians, civil engineers, surveyors, geologists, facility managers, infrastructure supervisors, administrators, and authorised contractors.
- **Initial Pilot Target:** Federal University of Technology, Akure (FUTA), Nigeria — modelled as a normal institutional database row so any university can onboard cleanly without code changes.

## Problem Statement
Universities maintain extensive buried and surface infrastructure — water mains, boreholes, electrical feeders, fibre-optic conduits, drainage channels, transformers, valves, and survey control benchmarks. When institutional knowledge lives only in paper sketches or retiring staff memory, routine excavation causes accidental utility strikes, service outages, and preventable repair expenditure.

## Core Principles
1. **Spatially Intelligent Register:** Infrastructure is documented with real coordinates, continuous `LINESTRING` utility routes, variable burial depth observations, and GNSS accuracy metadata — not isolated text spreadsheets.
2. **Honest Safety Communication:** Absence of recorded assets never proves absence of buried utilities. Awareness buffers and proximity thresholds are notification parameters, never certified safe digging clearances.
3. **Offline-First Field Usability:** Designed for small Android screens and intermittent campus connectivity, preserving capture timestamps and preventing duplicate uploads on retry.
4. **Institutional Data Isolation:** Every record belongs to an explicit `institution_id` (and `campus_id` where spatial) enforced by PostgreSQL Row Level Security.
5. **Clear Demonstration Separation:** Simulated demonstration records are always explicitly labelled and never presented as verified university infrastructure.
