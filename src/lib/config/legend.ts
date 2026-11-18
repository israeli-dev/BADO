import { z } from 'zod';
import type { LegendEntry } from '@/types/domain';

/**
 * Default BADO map legend configuration (matches `public.default_legend_config()` in SQL).
 * IMPORTANT: These colours are BADO interface conventions and are NOT represented as
 * statutory or legally certified excavation utility-marking codes.
 */
export const DEFAULT_LEGEND_CONFIG: LegendEntry[] = [
  {
    key: 'surface_facility',
    label: 'Surface Assets',
    colorHex: '#16a34a',
    iconKey: 'building-2',
    lineStyle: 'solid',
    defaultVisible: true,
  },
  {
    key: 'water',
    label: 'Water Infrastructure',
    colorHex: '#2563eb',
    iconKey: 'droplets',
    lineStyle: 'solid',
    defaultVisible: true,
  },
  {
    key: 'electrical',
    label: 'Electrical Infrastructure',
    colorHex: '#ca8a04',
    iconKey: 'zap',
    lineStyle: 'solid',
    defaultVisible: true,
  },
  {
    key: 'telecom',
    label: 'Telecommunications & Fibre',
    colorHex: '#9333ea',
    iconKey: 'cable',
    lineStyle: 'dashed',
    defaultVisible: true,
  },
  {
    key: 'drainage_sewer',
    label: 'Drainage & Sewer',
    colorHex: '#ea580c',
    iconKey: 'waves',
    lineStyle: 'solid',
    defaultVisible: true,
  },
  {
    key: 'other_utility',
    label: 'Other Utilities',
    colorHex: '#64748b',
    iconKey: 'layers',
    lineStyle: 'dotted',
    defaultVisible: true,
  },
  {
    key: 'critical_hazard',
    label: 'Critical Hazards',
    colorHex: '#dc2626',
    iconKey: 'triangle-alert',
    lineStyle: 'solid',
    defaultVisible: true,
  },
  {
    key: 'survey_benchmark',
    label: 'Survey Benchmarks & Control',
    colorHex: '#0891b2',
    iconKey: 'crosshair',
    lineStyle: 'solid',
    defaultVisible: true,
  },
];

export const legendEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/, 'Key must be lowercase letters, numbers, or underscores.'),
  label: z
    .string()
    .trim()
    .min(2, 'Label must be at least 2 characters.')
    .max(60, 'Label must be 60 characters or fewer.'),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a 6-digit hex code (e.g. #2563eb).'),
  iconKey: z.string().trim().min(2).max(40),
  lineStyle: z.enum(['solid', 'dashed', 'dotted']),
  defaultVisible: z.boolean(),
});

export const institutionThresholdsSchema = z
  .object({
    defaultDigBufferM: z.number().min(1).max(500),
    liveNearbyM: z.number().min(3).max(500),
    liveApproachingM: z.number().min(2).max(499),
    liveCloseM: z.number().min(1).max(498),
    requireVerificationApproval: z.boolean(),
    allowPublicPassports: z.boolean(),
  })
  .refine(
    (v) => v.liveCloseM < v.liveApproachingM && v.liveApproachingM < v.liveNearbyM,
    {
      message:
        'Live proximity thresholds must satisfy: Close < Approaching < Nearby (in metres).',
      path: ['liveCloseM'],
    },
  );

export function cloneDefaultLegend(): LegendEntry[] {
  return DEFAULT_LEGEND_CONFIG.map((item) => ({ ...item }));
}
