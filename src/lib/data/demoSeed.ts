import { cloneDefaultLegend } from '@/lib/config/legend';
import type { BadoLocalDatabase } from '@/lib/db/badoDb';
import type {
  AppRole,
  AuditLogEntry,
  Campus,
  Department,
  Institution,
  InstitutionSettings,
  UserInstitutionMembership,
  UserProfile,
} from '@/types/domain';

/**
 * Clearly labelled simulated seed records for the local demonstration & automated
 * testing environment. NEVER represents verified infrastructure of FUTA or any
 * real university (Master Specification Section 26).
 *
 * Includes TWO distinct demonstration institutions so multi-institution data
 * isolation can be tested interactively and in Vitest.
 */
export const DEMO_IDS = {
  primaryInstitution: '11111111-1111-4111-8111-111111111101',
  secondaryInstitution: '11111111-1111-4111-8111-111111111102',
  mainCampus: '22222222-2222-4222-8222-222222222201',
  annexCampus: '22222222-2222-4222-8222-222222222202',
  secondaryCampus: '22222222-2222-4222-8222-222222222209',
  deptWorks: '33333333-3333-4333-8333-333333333301',
  deptWater: '33333333-3333-4333-8333-333333333302',
  deptElectrical: '33333333-3333-4333-8333-333333333303',
  deptIct: '33333333-3333-4333-8333-333333333304',
  deptSurvey: '33333333-3333-4333-8333-333333333305',
  deptSecondaryWorks: '33333333-3333-4333-8333-333333333309',
  userAdmin: '44444444-4444-4444-8444-444444444401',
  userSupervisor: '44444444-4444-4444-8444-444444444402',
  userTechnician: '44444444-4444-4444-8444-444444444403',
  userSurveyor: '44444444-4444-4444-8444-444444444404',
  userReadOnly: '44444444-4444-4444-8444-444444444405',
  userSecondaryAdmin: '44444444-4444-4444-8444-444444444409',
} as const;

export interface DemoPersona {
  userId: string;
  email: string;
  fullName: string;
  jobTitle: string;
  institutionName: string;
  role: AppRole;
  summary: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    userId: DEMO_IDS.userAdmin,
    email: 'admin@demo-university.bado.local',
    fullName: 'Engr. Adebayo Ogunleye',
    jobTitle: 'Director of Works & Infrastructure (Demo)',
    institutionName: 'BADO Demonstration University (Simulated)',
    role: 'admin',
    summary: 'Full institutional administration, campuses, roles, legend & audit logs.',
  },
  {
    userId: DEMO_IDS.userSupervisor,
    email: 'supervisor@demo-university.bado.local',
    fullName: 'Engr. Chioma Nwosu',
    jobTitle: 'Chief Maintenance Supervisor (Demo)',
    institutionName: 'BADO Demonstration University (Simulated)',
    role: 'supervisor',
    summary: 'Reviews/approves records, oversees maintenance, and exports reports.',
  },
  {
    userId: DEMO_IDS.userTechnician,
    email: 'technician@demo-university.bado.local',
    fullName: 'Tunde Akinwale',
    jobTitle: 'Senior Water & Electrical Technician (Demo)',
    institutionName: 'BADO Demonstration University (Simulated)',
    role: 'field_technician',
    summary: 'Logs field assets, GPS positions, trenches, QR scans & inspections.',
  },
  {
    userId: DEMO_IDS.userSurveyor,
    email: 'surveyor@demo-university.bado.local',
    fullName: 'Surv. Halima Ibrahim',
    jobTitle: 'Campus Surveyor & GIS Officer (Demo)',
    institutionName: 'BADO Demonstration University (Simulated)',
    role: 'surveyor_gis',
    summary: 'Manages benchmarks, edits spatial routes, and imports/exports GIS data.',
  },
  {
    userId: DEMO_IDS.userReadOnly,
    email: 'observer@demo-university.bado.local',
    fullName: 'Dr. Kunle Adeyemi',
    jobTitle: 'University Planning Committee Member (Demo)',
    institutionName: 'BADO Demonstration University (Simulated)',
    role: 'read_only',
    summary: 'Read-only map, asset register, Dig Check & passport viewer.',
  },
  {
    userId: DEMO_IDS.userSecondaryAdmin,
    email: 'admin@westridge-demo.bado.local',
    fullName: 'Engr. Musa Danjuma',
    jobTitle: 'Head of Estate & Works (Demo)',
    institutionName: 'Westridge College of Technology (Simulated)',
    role: 'admin',
    summary: 'Separate simulated institution — verifies strict cross-institution isolation.',
  },
];

const SEED_TIMESTAMP = '2026-11-18T08:00:00.000Z';

export async function ensureDemoSeedData(db: BadoLocalDatabase): Promise<void> {
  const existing = await db.institutions.get(DEMO_IDS.primaryInstitution);
  if (existing) return;

  const institutions: Institution[] = [
    {
      id: DEMO_IDS.primaryInstitution,
      name: 'BADO Demonstration University (Simulated)',
      slug: 'bado-demo-university',
      shortCode: 'BDU-DEMO',
      countryCode: 'NG',
      isDemo: true,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.secondaryInstitution,
      name: 'Westridge College of Technology (Simulated)',
      slug: 'westridge-demo-college',
      shortCode: 'WCT-DEMO',
      countryCode: 'NG',
      isDemo: true,
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
  ];

  const settings: InstitutionSettings[] = institutions.map((inst) => ({
    institutionId: inst.id,
    defaultDigBufferM: 15,
    liveNearbyM: 20,
    liveApproachingM: 10,
    liveCloseM: 5,
    requireVerificationApproval: true,
    allowPublicPassports: false,
    legendConfig: cloneDefaultLegend(),
    updatedBy: null,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  }));

  const campuses: Campus[] = [
    {
      id: DEMO_IDS.mainCampus,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'Main Demonstration Campus (Simulated)',
      code: 'MAIN_DEMO',
      description:
        'Simulated university campus for staff onboarding, GIS workflows, and field testing. Does not represent verified real-world infrastructure.',
      isDemo: true,
      center: { lat: 7.3042, lng: 5.1385 },
      defaultZoom: 16,
      isActive: true,
      createdBy: DEMO_IDS.userAdmin,
      updatedBy: DEMO_IDS.userAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.annexCampus,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'South Engineering Annex (Simulated)',
      code: 'ANNEX_DEMO',
      description:
        'Secondary simulated campus demonstrating multi-campus selection and spatial isolation.',
      isDemo: true,
      center: { lat: 7.2965, lng: 5.148 },
      defaultZoom: 16,
      isActive: true,
      createdBy: DEMO_IDS.userAdmin,
      updatedBy: DEMO_IDS.userAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.secondaryCampus,
      institutionId: DEMO_IDS.secondaryInstitution,
      name: 'Westridge Central Campus (Simulated)',
      code: 'WCT_CENTRAL',
      description:
        'Independent simulated campus belonging solely to Westridge College of Technology.',
      isDemo: true,
      center: { lat: 7.4412, lng: 3.8965 },
      defaultZoom: 16,
      isActive: true,
      createdBy: DEMO_IDS.userSecondaryAdmin,
      updatedBy: DEMO_IDS.userSecondaryAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
  ];

  const departments: Department[] = [
    {
      id: DEMO_IDS.deptWorks,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'Directorate of Works & Services',
      code: 'WORKS',
      description: 'Central civil works, building services, and infrastructure operations.',
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.deptWater,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'Water Supply & Sanitation Unit',
      code: 'WATER',
      description: 'Boreholes, elevated tanks, pumping houses, water mains, and drainage.',
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.deptElectrical,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'Electrical & Power Distribution Unit',
      code: 'ELECTRICAL',
      description: 'Transformers, power plants, generators, and underground power cables.',
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.deptIct,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'Campus ICT & Fibre Network Unit',
      code: 'ICT_FIBRE',
      description: 'Fibre-optic backbone conduits, ducts, and distribution cabinets.',
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.deptSurvey,
      institutionId: DEMO_IDS.primaryInstitution,
      name: 'Physical Planning, Survey & GIS Unit',
      code: 'SURVEY_GIS',
      description: 'Survey control benchmarks, campus base mapping, and spatial QA/QC.',
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: DEMO_IDS.deptSecondaryWorks,
      institutionId: DEMO_IDS.secondaryInstitution,
      name: 'Estate & Municipal Services',
      code: 'ESTATE',
      description: 'Westridge campus infrastructure maintenance department.',
      isActive: true,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
  ];

  const profiles: UserProfile[] = DEMO_PERSONAS.map((persona) => ({
    id: persona.userId,
    email: persona.email,
    fullName: persona.fullName,
    phone: null,
    jobTitle: persona.jobTitle,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  }));

  const memberships: UserInstitutionMembership[] = [
    {
      id: '55555555-5555-4555-8555-555555555501',
      userId: DEMO_IDS.userAdmin,
      institutionId: DEMO_IDS.primaryInstitution,
      departmentId: DEMO_IDS.deptWorks,
      role: 'admin',
      allowedCampusIds: null,
      isActive: true,
      invitedBy: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: '55555555-5555-4555-8555-555555555502',
      userId: DEMO_IDS.userSupervisor,
      institutionId: DEMO_IDS.primaryInstitution,
      departmentId: DEMO_IDS.deptWorks,
      role: 'supervisor',
      allowedCampusIds: null,
      isActive: true,
      invitedBy: DEMO_IDS.userAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: '55555555-5555-4555-8555-555555555503',
      userId: DEMO_IDS.userTechnician,
      institutionId: DEMO_IDS.primaryInstitution,
      departmentId: DEMO_IDS.deptWater,
      role: 'field_technician',
      allowedCampusIds: null,
      isActive: true,
      invitedBy: DEMO_IDS.userAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: '55555555-5555-4555-8555-555555555504',
      userId: DEMO_IDS.userSurveyor,
      institutionId: DEMO_IDS.primaryInstitution,
      departmentId: DEMO_IDS.deptSurvey,
      role: 'surveyor_gis',
      allowedCampusIds: null,
      isActive: true,
      invitedBy: DEMO_IDS.userAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: '55555555-5555-4555-8555-555555555505',
      userId: DEMO_IDS.userReadOnly,
      institutionId: DEMO_IDS.primaryInstitution,
      departmentId: null,
      role: 'read_only',
      allowedCampusIds: [DEMO_IDS.mainCampus],
      isActive: true,
      invitedBy: DEMO_IDS.userAdmin,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: '55555555-5555-4555-8555-555555555509',
      userId: DEMO_IDS.userSecondaryAdmin,
      institutionId: DEMO_IDS.secondaryInstitution,
      departmentId: DEMO_IDS.deptSecondaryWorks,
      role: 'admin',
      allowedCampusIds: null,
      isActive: true,
      invitedBy: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    },
  ];

  const auditLogs: AuditLogEntry[] = [
    {
      id: '66666666-6666-4666-8666-666666666601',
      institutionId: DEMO_IDS.primaryInstitution,
      actorUserId: DEMO_IDS.userAdmin,
      actorName: 'Engr. Adebayo Ogunleye',
      actorRole: 'admin',
      action: 'insert',
      entityType: 'institutions',
      entityId: DEMO_IDS.primaryInstitution,
      summary: 'Initialised BADO Demonstration University (Simulated) sandbox.',
      oldData: null,
      newData: { slug: 'bado-demo-university', isDemo: true },
      createdAt: SEED_TIMESTAMP,
    },
    {
      id: '66666666-6666-4666-8666-666666666602',
      institutionId: DEMO_IDS.secondaryInstitution,
      actorUserId: DEMO_IDS.userSecondaryAdmin,
      actorName: 'Engr. Musa Danjuma',
      actorRole: 'admin',
      action: 'insert',
      entityType: 'institutions',
      entityId: DEMO_IDS.secondaryInstitution,
      summary: 'Initialised Westridge College of Technology (Simulated) sandbox.',
      oldData: null,
      newData: { slug: 'westridge-demo-college', isDemo: true },
      createdAt: SEED_TIMESTAMP,
    },
  ];

  await db.transaction(
    'rw',
    [
      db.institutions,
      db.institutionSettings,
      db.campuses,
      db.departments,
      db.profiles,
      db.userInstitutions,
      db.auditLogs,
    ],
    async () => {
      await db.institutions.bulkPut(institutions);
      await db.institutionSettings.bulkPut(settings);
      await db.campuses.bulkPut(campuses);
      await db.departments.bulkPut(departments);
      await db.profiles.bulkPut(profiles);
      await db.userInstitutions.bulkPut(memberships);
      await db.auditLogs.bulkPut(auditLogs);
    },
  );
}
