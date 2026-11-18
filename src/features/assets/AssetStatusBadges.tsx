import {
  CheckCircle2,
  Clock,
  CloudUpload,
  Crosshair,
  TriangleAlert,
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import {
  DATA_QUALITY_LABELS,
  OPERATIONAL_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/lib/assets/labels';
import type {
  DataQuality,
  GnssFixQuality,
  OperationalStatus,
  VerificationStatus,
} from '@/types/domain';

const VERIFICATION_TONE: Record<VerificationStatus, BadgeTone> = {
  draft: 'neutral',
  submitted: 'info',
  under_review: 'info',
  verified: 'success',
  rejected: 'danger',
  needs_resurvey: 'warning',
};

const OPERATIONAL_TONE: Record<OperationalStatus, BadgeTone> = {
  operational: 'success',
  standby: 'info',
  maintenance: 'warning',
  faulty: 'danger',
  decommissioned: 'neutral',
  unknown: 'neutral',
};

const QUALITY_TONE: Record<DataQuality, BadgeTone> = {
  verified: 'success',
  unverified: 'neutral',
  needs_resurvey: 'warning',
  incomplete: 'warning',
  outdated: 'danger',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return (
    <Badge tone={VERIFICATION_TONE[status]}>
      {status === 'verified' ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Clock className="h-3 w-3" aria-hidden="true" />
      )}
      {VERIFICATION_STATUS_LABELS[status]}
    </Badge>
  );
}

export function DataQualityBadge({ quality }: { quality: DataQuality }) {
  return (
    <Badge tone={QUALITY_TONE[quality]}>
      Quality: {DATA_QUALITY_LABELS[quality]}
    </Badge>
  );
}

export function OperationalBadge({ status }: { status: OperationalStatus }) {
  return (
    <Badge tone={OPERATIONAL_TONE[status]}>
      {OPERATIONAL_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CriticalHazardBadge() {
  return (
    <Badge tone="danger">
      <TriangleAlert className="h-3 w-3" aria-hidden="true" />
      Critical Hazard
    </Badge>
  );
}

export function PendingSyncBadge() {
  return (
    <Badge tone="warning">
      <CloudUpload className="h-3 w-3" aria-hidden="true" />
      Saved Offline · Pending Sync
    </Badge>
  );
}

export function AccuracyBadge({
  accuracyM,
  fixQuality,
}: {
  accuracyM: number | null;
  fixQuality: GnssFixQuality;
}) {
  if (accuracyM === null) {
    return <Badge tone="neutral">Accuracy unrecorded</Badge>;
  }

  const tone: BadgeTone =
    accuracyM <= 1
      ? 'success'
      : accuracyM <= 8
        ? 'neutral'
        : 'warning';

  const formatted =
    accuracyM < 1 ? `±${accuracyM.toFixed(2)} m` : `±${accuracyM.toFixed(1)} m`;

  const suffix =
    fixQuality === 'rtk_fixed'
      ? ' RTK'
      : fixQuality === 'rtk_float'
        ? ' Float'
        : fixQuality === 'differential'
          ? ' DGPS'
          : '';

  return (
    <Badge tone={tone}>
      <Crosshair className="h-3 w-3" aria-hidden="true" />
      {formatted}
      {suffix}
    </Badge>
  );
}
