import { zodResolver } from '@hookform/resolvers/zod';
import {
  Building,
  History,
  MapPin,
  Palette,
  Plus,
  RotateCcw,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LegendIcon } from '@/components/ui/LegendIcon';
import { Select } from '@/components/ui/Select';
import {
  useAuditLogs,
  useAssignConfirmedMember,
  useCampuses,
  useCreateCampus,
  useCreateDepartment,
  useDepartments,
  useInstitutionMembers,
  useInstitutionSettings,
  useUpdateLegend,
  useUpdateMemberRole,
  useUpdateThresholds,
} from '@/features/admin/useInstitutionalData';
import { useAuth } from '@/features/auth/AuthContext';
import { cloneDefaultLegend, institutionThresholdsSchema } from '@/lib/config/legend';
import {
  createDepartmentSchema,
  type CreateDepartmentInput,
} from '@/lib/data';
import { ROLE_METADATA } from '@/lib/permissions/rbac';
import {
  APP_ROLES,
  type AppRole,
  type LegendEntry,
  type LegendLineStyle,
} from '@/types/domain';
import { z } from 'zod';

type AdminTab = 'campuses' | 'departments' | 'users' | 'legend' | 'audit';

const campusFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Campus name must be at least 2 characters.').max(140),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9][A-Z0-9_-]{1,23}$/,
        'Use 2–24 uppercase letters, digits, hyphens, or underscores.',
      ),
    description: z.string().trim().max(1000).optional(),
    centerLatText: z.string().trim().optional(),
    centerLngText: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    const hasLat = Boolean(val.centerLatText);
    const hasLng = Boolean(val.centerLngText);
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: 'custom',
        path: [hasLat ? 'centerLngText' : 'centerLatText'],
        message: 'Enter both latitude and longitude, or leave both empty.',
      });
      return;
    }
    if (hasLat && hasLng) {
      const lat = Number(val.centerLatText);
      const lng = Number(val.centerLngText);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        ctx.addIssue({
          code: 'custom',
          path: ['centerLatText'],
          message: 'Latitude must be between -90 and 90 (WGS84).',
        });
      }
      if (Number.isNaN(lng) || lng < -180 || lng > 180) {
        ctx.addIssue({
          code: 'custom',
          path: ['centerLngText'],
          message: 'Longitude must be between -180 and 180 (WGS84).',
        });
      }
    }
  });

type CampusFormValues = z.infer<typeof campusFormSchema>;
type ThresholdFormValues = z.infer<typeof institutionThresholdsSchema>;

export function AdminPage() {
  const { activeInstitution } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('campuses');

  const tabs: { id: AdminTab; label: string; icon: typeof MapPin }[] = [
    { id: 'campuses', label: 'Campuses', icon: MapPin },
    { id: 'departments', label: 'Departments', icon: Building },
    { id: 'users', label: 'Users & Roles', icon: Users },
    { id: 'legend', label: 'Legend & Thresholds', icon: Palette },
    { id: 'audit', label: 'Audit Logs', icon: History },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Institutional Administration
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Manage campuses, departments, role assignments, map legend conventions, and
          audit logs for{' '}
          <strong className="font-medium text-slate-900">
            {activeInstitution?.name}
          </strong>
          .
        </p>
      </div>

      {/* Accessible Tab Bar */}
      <div
        role="tablist"
        aria-label="Administration sections"
        className="flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer sm:text-sm ${
                selected
                  ? 'bg-bado-navy-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'campuses' && <CampusesSection />}
      {activeTab === 'departments' && <DepartmentsSection />}
      {activeTab === 'users' && <UsersSection />}
      {activeTab === 'legend' && <LegendAndThresholdsSection />}
      {activeTab === 'audit' && <AuditLogsSection />}
    </div>
  );
}

function CampusesSection() {
  const { data: campuses = [] } = useCampuses();
  const createCampus = useCreateCampus();
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    message: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CampusFormValues>({
    resolver: zodResolver(campusFormSchema),
    defaultValues: {
      name: '',
      code: '',
      description: '',
      centerLatText: '',
      centerLngText: '',
    },
  });

  const onSubmit = async (values: CampusFormValues) => {
    setFeedback(null);
    try {
      const created = await createCampus.mutateAsync({
        name: values.name,
        code: values.code.toUpperCase(),
        description: values.description ?? '',
        centerLat: values.centerLatText ? Number(values.centerLatText) : null,
        centerLng: values.centerLngText ? Number(values.centerLngText) : null,
        defaultZoom: 16,
      });
      reset();
      setFeedback({
        tone: 'success',
        message: `Campus "${created.name}" (${created.code}) registered and logged in audit trail.`,
      });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message:
          error instanceof Error ? error.message : 'Failed to create campus.',
      });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card
        className="lg:col-span-7"
        title={`Registered Campuses (${campuses.length})`}
        description="Every infrastructure asset belongs to both an institution_id and a campus_id."
      >
        <div className="divide-y divide-slate-100">
          {campuses.map((campus) => (
            <div
              key={campus.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {campus.name}
                  </p>
                  <Badge tone="neutral">{campus.code}</Badge>
                  {campus.isDemo && <Badge tone="demo">Demo</Badge>}
                </div>
                {campus.description && (
                  <p className="mt-1 text-xs text-slate-600">{campus.description}</p>
                )}
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  {campus.center
                    ? `WGS84 (EPSG:4326): ${campus.center.lat.toFixed(5)}°, ${campus.center.lng.toFixed(5)}°`
                    : 'Centre coordinates not set'}
                </p>
              </div>
              <Badge tone="success">Active</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card
        className="lg:col-span-5"
        title="Add Campus"
        description="Register an additional campus under this institution."
      >
        {feedback && (
          <Alert tone={feedback.tone} className="mb-4">
            {feedback.message}
          </Alert>
        )}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3.5">
          <Input
            label="Campus Name"
            placeholder="e.g. Health Sciences Campus"
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Campus Code"
            placeholder="e.g. HEALTH_SCI"
            hint="2–24 uppercase letters, numbers, hyphens, or underscores."
            required
            error={errors.code?.message}
            {...register('code')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Centre Latitude"
              inputMode="decimal"
              placeholder="7.3042"
              error={errors.centerLatText?.message}
              {...register('centerLatText')}
            />
            <Input
              label="Centre Longitude"
              inputMode="decimal"
              placeholder="5.1385"
              error={errors.centerLngText?.message}
              {...register('centerLngText')}
            />
          </div>
          <Input
            label="Description"
            placeholder="Optional scope or location description"
            error={errors.description?.message}
            {...register('description')}
          />
          <Button
            type="submit"
            fullWidth
            isLoading={isSubmitting}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Create Campus
          </Button>
        </form>
      </Card>
    </div>
  );
}

function DepartmentsSection() {
  const { data: departments = [] } = useDepartments();
  const createDepartment = useCreateDepartment();
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger';
    message: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateDepartmentInput>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: { name: '', code: '', description: '' },
  });

  const onSubmit = async (values: CreateDepartmentInput) => {
    setFeedback(null);
    try {
      const created = await createDepartment.mutateAsync(values);
      reset();
      setFeedback({
        tone: 'success',
        message: `Department "${created.name}" (${created.code}) created.`,
      });
    } catch (error) {
      setFeedback({
        tone: 'danger',
        message:
          error instanceof Error ? error.message : 'Failed to create department.',
      });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card
        className="lg:col-span-7"
        title={`Responsible Departments (${departments.length})`}
        description="Units responsible for owning, inspecting, and maintaining campus assets."
      >
        <div className="divide-y divide-slate-100">
          {departments.map((dept) => (
            <div key={dept.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">{dept.name}</p>
                <Badge tone="neutral">{dept.code}</Badge>
              </div>
              {dept.description && (
                <p className="mt-1 text-xs text-slate-600">{dept.description}</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card
        className="lg:col-span-5"
        title="Add Department"
        description="Create a works, engineering, or survey unit for this institution."
      >
        {feedback && (
          <Alert tone={feedback.tone} className="mb-4">
            {feedback.message}
          </Alert>
        )}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3.5">
          <Input
            label="Department Name"
            placeholder="e.g. Civil & Drainage Engineering Unit"
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Department Code"
            placeholder="e.g. CIVIL_DRAIN"
            required
            error={errors.code?.message}
            {...register('code')}
          />
          <Input
            label="Responsibilities"
            placeholder="Optional description"
            error={errors.description?.message}
            {...register('description')}
          />
          <Button
            type="submit"
            fullWidth
            isLoading={isSubmitting}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Create Department
          </Button>
        </form>
      </Card>
    </div>
  );
}

function UsersSection() {
  const { data: members = [] } = useInstitutionMembers();
  const updateRole = useUpdateMemberRole();
  const { gateway, can } = useAuth();
  const { data: campuses = [] } = useCampuses();
  const assignMember = useAssignConfirmedMember();
  const [accountEmail, setAccountEmail] = useState('');
  const [campusId, setCampusId] = useState('');
  const [understandsScope, setUnderstandsScope] = useState(false);

  const [message, setMessage] = useState<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);

  const roleOptions = APP_ROLES.map((role) => ({
    value: role,
    label: ROLE_METADATA[role].label,
  }));

  const handleRoleChange = async (
    membershipId: string,
    role: AppRole,
    isActive: boolean,
  ) => {
    setMessage(null);
    try {
      await updateRole.mutateAsync({ membershipId, role, isActive });
      setMessage({
        tone: 'success',
        text: `Updated role to ${ROLE_METADATA[role].label} and recorded audit log.`,
      });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Role update failed.',
      });
    }
  };

  const handleAssign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    try {
      await assignMember.mutateAsync({ email: accountEmail, campusId });
      setAccountEmail('');
      setUnderstandsScope(false);
      setMessage({ tone: 'success', text: 'Confirmed account assigned with a read-only role and selected campus. Ask the user to check their assignment.' });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Member assignment failed.' });
    }
  };

  return (
    <Card
      title={`Authorised Institutional Personnel (${members.length})`}
      description="Role assignments are enforced server-side via PostgreSQL Row Level Security. Database triggers prevent removing the last active administrator."
    >
      {message && (
        <Alert tone={message.tone} className="mb-4">
          {message.text}
        </Alert>
      )}
      {gateway.mode === 'supabase' && can('admin:manage_users') && (
        <form onSubmit={handleAssign} className="mb-6 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Assign a confirmed account</h3>
          <p className="text-xs text-slate-600">Verify the person and email independently before granting access. The account must already exist and have a confirmed email. Initial role is read-only; the selected campus restricts asset access, but other institution-wide records may be accessible. Only assign people trusted for the institution.</p>
          <Input label="Account email" type="email" required value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} />
          <Select label="Campus access" required value={campusId} onChange={(event) => setCampusId(event.target.value)} options={[{ value: '', label: 'Select a campus' }, ...campuses.filter(c => c.isActive).map(c => ({ value: c.id, label: c.name }))]} />
          <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={understandsScope} onChange={(event) => setUnderstandsScope(event.target.checked)} /> I have verified this person and understand institution-wide data may be accessible.</label>
          <Button type="submit" isLoading={assignMember.isPending} disabled={!campusId || !understandsScope}>Assign read-only access</Button>
        </form>
      )}
      <div className="divide-y divide-slate-100">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {member.profile?.fullName || member.userId}
                </p>
                {member.department && (
                  <Badge tone="neutral">{member.department.name}</Badge>
                )}
                {member.allowedCampusIds && (
                  <Badge tone="info">
                    Scoped to {member.allowedCampusIds.length} campus
                    {member.allowedCampusIds.length === 1 ? '' : 'es'}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {member.profile?.email}
                {member.profile?.jobTitle ? ` · ${member.profile.jobTitle}` : ''}
              </p>
            </div>
            <div className="w-full sm:w-60">
              <Select
                hideLabel
                label={`Role for ${member.profile?.fullName ?? member.userId}`}
                options={roleOptions}
                value={member.role}
                disabled={updateRole.isPending}
                onChange={(e) =>
                  void handleRoleChange(
                    member.id,
                    e.target.value as AppRole,
                    member.isActive,
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LegendAndThresholdsSection() {
  const { data: settings } = useInstitutionSettings();
  const updateLegend = useUpdateLegend();
  const updateThresholds = useUpdateThresholds();
  const [legendDraft, setLegendDraft] = useState<LegendEntry[]>([]);
  const [statusMsg, setStatusMsg] = useState<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ThresholdFormValues>({
    resolver: zodResolver(institutionThresholdsSchema),
    defaultValues: {
      defaultDigBufferM: 15,
      liveNearbyM: 20,
      liveApproachingM: 10,
      liveCloseM: 5,
      requireVerificationApproval: true,
      allowPublicPassports: false,
    },
  });

  useEffect(() => {
    if (!settings) return;
    setLegendDraft(settings.legendConfig.map((entry) => ({ ...entry })));
    reset({
      defaultDigBufferM: settings.defaultDigBufferM,
      liveNearbyM: settings.liveNearbyM,
      liveApproachingM: settings.liveApproachingM,
      liveCloseM: settings.liveCloseM,
      requireVerificationApproval: settings.requireVerificationApproval,
      allowPublicPassports: settings.allowPublicPassports,
    });
  }, [settings, reset]);

  const handleSaveThresholds = async (values: ThresholdFormValues) => {
    setStatusMsg(null);
    try {
      await updateThresholds.mutateAsync(values);
      setStatusMsg({
        tone: 'success',
        text: 'Saved awareness parameters and governance settings.',
      });
    } catch (error) {
      setStatusMsg({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Unable to save settings.',
      });
    }
  };

  const handleSaveLegend = async () => {
    setStatusMsg(null);
    try {
      await updateLegend.mutateAsync(legendDraft);
      setStatusMsg({
        tone: 'success',
        text: 'Saved configurable institutional map legend.',
      });
    } catch (error) {
      setStatusMsg({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Unable to save legend.',
      });
    }
  };

  return (
    <div className="space-y-5">
      {statusMsg && <Alert tone={statusMsg.tone}>{statusMsg.text}</Alert>}

      <Card
        title="Proximity Awareness & Verification Governance"
        description="Awareness distances are operational notification parameters — never certified safe digging clearances."
      >
        <form
          onSubmit={handleSubmit(handleSaveThresholds)}
          noValidate
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Default Dig Buffer (m)"
              type="number"
              step="1"
              error={errors.defaultDigBufferM?.message}
              {...register('defaultDigBufferM', { valueAsNumber: true })}
            />
            <Input
              label="Live Nearby (m)"
              type="number"
              step="1"
              error={errors.liveNearbyM?.message}
              {...register('liveNearbyM', { valueAsNumber: true })}
            />
            <Input
              label="Live Approaching (m)"
              type="number"
              step="1"
              error={errors.liveApproachingM?.message}
              {...register('liveApproachingM', { valueAsNumber: true })}
            />
            <Input
              label="Live Close (m)"
              type="number"
              step="1"
              error={errors.liveCloseM?.message}
              {...register('liveCloseM', { valueAsNumber: true })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                {...register('requireVerificationApproval')}
              />
              <span>
                <strong className="block font-medium text-slate-900">
                  Require Supervisor Verification
                </strong>
                <span className="text-xs text-slate-600">
                  Newly submitted field records remain unverified until reviewed.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                {...register('allowPublicPassports')}
              />
              <span>
                <strong className="block font-medium text-slate-900">
                  Allow Approved Public QR Passport Summaries
                </strong>
                <span className="text-xs text-slate-600">
                  Exposes only explicitly approved summary fields when scanned without sign-in.
                </span>
              </span>
            </label>
          </div>

          <Button type="submit" isLoading={isSubmitting}>
            Save Governance &amp; Thresholds
          </Button>
        </form>
      </Card>

      <Card
        title="Configurable Map Legend"
        description="Customise institutional layer labels, colours, and line styles. BADO colours are UI conventions, not statutory excavation marking codes."
        actions={
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => setLegendDraft(cloneDefaultLegend())}
          >
            Reset Defaults
          </Button>
        }
      >
        <div className="space-y-2.5">
          {legendDraft.map((entry, idx) => (
            <div
              key={entry.key}
              className="grid items-center gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-12"
            >
              <div className="flex items-center gap-2.5 sm:col-span-5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: entry.colorHex }}
                >
                  <LegendIcon iconKey={entry.iconKey} className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  aria-label={`Label for ${entry.key}`}
                  value={entry.label}
                  onChange={(e) => {
                    const next = [...legendDraft];
                    next[idx] = { ...entry, label: e.target.value };
                    setLegendDraft(next);
                  }}
                  className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="flex items-center gap-2 sm:col-span-3">
                <input
                  type="color"
                  aria-label={`Colour for ${entry.label}`}
                  value={entry.colorHex}
                  onChange={(e) => {
                    const next = [...legendDraft];
                    next[idx] = { ...entry, colorHex: e.target.value };
                    setLegendDraft(next);
                  }}
                  className="h-10 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
                />
                <span className="font-mono text-xs text-slate-600">
                  {entry.colorHex.toUpperCase()}
                </span>
              </div>

              <div className="sm:col-span-2">
                <select
                  aria-label={`Line style for ${entry.label}`}
                  value={entry.lineStyle}
                  onChange={(e) => {
                    const next = [...legendDraft];
                    next[idx] = {
                      ...entry,
                      lineStyle: e.target.value as LegendLineStyle,
                    };
                    setLegendDraft(next);
                  }}
                  className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                >
                  <option value="solid">Solid line</option>
                  <option value="dashed">Dashed line</option>
                  <option value="dotted">Dotted line</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={entry.defaultVisible}
                  onChange={(e) => {
                    const next = [...legendDraft];
                    next[idx] = { ...entry, defaultVisible: e.target.checked };
                    setLegendDraft(next);
                  }}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Default on
              </label>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Button
            onClick={() => void handleSaveLegend()}
            isLoading={updateLegend.isPending}
          >
            Save Legend Configuration
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AuditLogsSection() {
  const { data: logs = [] } = useAuditLogs();

  return (
    <Card
      title={`Institutional Audit Trail (${logs.length})`}
      description="Append-only log of institutional mutations, role updates, and governance changes."
    >
      <div className="divide-y divide-slate-100">
        {logs.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{entry.action.toUpperCase()}</Badge>
                <span className="font-mono text-xs text-slate-600">
                  {entry.entityType}
                </span>
                {entry.actorRole && (
                  <Badge tone="neutral">
                    {ROLE_METADATA[entry.actorRole].shortLabel}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-900">{entry.summary}</p>
              {entry.actorName && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Actor: {entry.actorName}
                </p>
              )}
            </div>
            <time
              dateTime={entry.createdAt}
              className="shrink-0 font-mono text-xs text-slate-500"
            >
              {new Date(entry.createdAt).toLocaleString()}
            </time>
          </div>
        ))}
      </div>
    </Card>
  );
}
