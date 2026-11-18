import {
  Building2,
  Cable,
  Crosshair,
  Droplets,
  Factory,
  Layers,
  MapPin,
  TriangleAlert,
  Waves,
  Zap,
  type LucideProps,
} from 'lucide-react';

const ICON_MAP: Record<string, typeof MapPin> = {
  'building-2': Building2,
  droplets: Droplets,
  zap: Zap,
  cable: Cable,
  waves: Waves,
  layers: Layers,
  'triangle-alert': TriangleAlert,
  crosshair: Crosshair,
  factory: Factory,
  'map-pin': MapPin,
};

export const AVAILABLE_LEGEND_ICONS = Object.keys(ICON_MAP);

export function LegendIcon({
  iconKey,
  ...props
}: { iconKey: string } & LucideProps) {
  const Icon = ICON_MAP[iconKey] ?? MapPin;
  return <Icon aria-hidden="true" {...props} />;
}
