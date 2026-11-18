import { ArrowLeft, Construction } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export const EXCAVATION_DISCLAIMER =
  'BADO displays documented infrastructure available in the institutional register. Unrecorded or inaccurately mapped utilities may exist. Confirm underground services using appropriate professional utility detection and verification before excavation.';

export interface PlannedModulePageProps {
  title: string;
  phaseLabel: string;
  summary: string;
  plannedCapabilities: string[];
  showExcavationNotice?: boolean;
}

export function PlannedModulePage({
  title,
  phaseLabel,
  summary,
  plannedCapabilities,
  showExcavationNotice = false,
}: PlannedModulePageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {title}
          </h1>
          <Badge tone="info">Scheduled · {phaseLabel}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600">{summary}</p>
      </div>

      {showExcavationNotice && (
        <Alert tone="warning" title="Infrastructure Verification Notice">
          {EXCAVATION_DISCLAIMER}
        </Alert>
      )}

      <Card
        title="Module Scope (Incremental Rollout)"
        description="Route, institutional context, campus selector, and role-based permissions are active in Phase 1. Core feature implementation arrives in the scheduled phase below."
      >
        <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3.5 border border-slate-200 mb-4">
          <Construction
            className="mt-0.5 h-5 w-5 shrink-0 text-bado-navy-700"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed text-slate-700 sm:text-sm">
            Not yet active — BADO is being built phase-by-phase with verified
            database migrations and automated tests so no unbuilt workflow is
            misrepresented as operational.
          </p>
        </div>

        <ul className="space-y-2 text-sm text-slate-700 list-disc pl-5">
          {plannedCapabilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <div className="mt-5">
          <Link to="/">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
