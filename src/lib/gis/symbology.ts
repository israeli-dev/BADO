import type {
  AssetRecord,
  AssetTypeDefinition,
  LegendEntry,
  LegendLineStyle,
} from '@/types/domain';

export interface ResolvedAssetSymbology {
  legendKey: string;
  colorHex: string;
  iconKey: string;
  lineStyle: LegendLineStyle;
  /** Leaflet SVG stroke-dasharray string or undefined for continuous solid. */
  dashArray: string | undefined;
  strokeWeight: number;
  isVerified: boolean;
  needsAttention: boolean;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safeHex(candidate: string | undefined, fallback: string): string {
  return candidate && HEX_COLOR_RE.test(candidate) ? candidate : fallback;
}

function lineStyleToDashArray(
  style: LegendLineStyle,
  isVerified: boolean,
): string | undefined {
  if (style === 'dashed') return '10 6';
  if (style === 'dotted') return '3 6';
  // Unverified linear utilities use a long cadence dash so operators distinguish
  // submitted/unverified routes from formally verified alignments without relying on colour alone.
  if (!isVerified) return '14 5';
  return undefined;
}

/**
 * Resolves map colour, icon glyph, and stroke styling for an asset using the
 * institution's configurable `legendConfig` (Master Specification Section 8).
 */
export function resolveAssetSymbology(
  asset: Pick<
    AssetRecord,
    | 'category'
    | 'utilityGroup'
    | 'isCriticalHazard'
    | 'verificationStatus'
    | 'operationalStatus'
  >,
  assetType: Pick<AssetTypeDefinition, 'colorHex' | 'iconKey' | 'lineStyle'>,
  legendConfig: readonly LegendEntry[],
): ResolvedAssetSymbology {
  const byKey = new Map(legendConfig.map((entry) => [entry.key, entry]));

  let legendKey: string = asset.utilityGroup;
  if (asset.isCriticalHazard) {
    legendKey = 'critical_hazard';
  } else if (asset.category === 'survey_reference') {
    legendKey = 'survey_benchmark';
  } else if (asset.utilityGroup === 'gas') {
    legendKey = byKey.has('gas') ? 'gas' : 'critical_hazard';
  } else if (
    asset.category === 'surface' &&
    asset.utilityGroup === 'surface_facility'
  ) {
    legendKey = 'surface_facility';
  }

  const matched = byKey.get(legendKey);
  const defaultColor = asset.isCriticalHazard
    ? '#dc2626'
    : asset.category === 'survey_reference'
      ? '#0891b2'
      : assetType.colorHex;

  const colorHex = safeHex(matched?.colorHex, safeHex(defaultColor, '#475569'));
  const iconKey = asset.isCriticalHazard
    ? 'triangle-alert'
    : assetType.iconKey || matched?.iconKey || 'map-pin';
  const lineStyle = matched?.lineStyle ?? assetType.lineStyle ?? 'solid';

  const isVerified = asset.verificationStatus === 'verified';
  const needsAttention =
    asset.verificationStatus === 'needs_resurvey' ||
    asset.verificationStatus === 'rejected' ||
    asset.operationalStatus === 'faulty';

  return {
    legendKey,
    colorHex,
    iconKey,
    lineStyle,
    dashArray: lineStyleToDashArray(lineStyle, isVerified),
    strokeWeight: asset.isCriticalHazard ? 5.5 : isVerified ? 4.5 : 4,
    isVerified,
    needsAttention,
  };
}

/**
 * Minimal static SVG paths for distinct field map glyphs (no user input interpolated;
 * colours are regex-validated 6-digit hex strings to eliminate XSS risk inside DivIcons).
 */
function glyphSvgPath(iconKey: string): string {
  switch (iconKey) {
    case 'droplets':
      return '<path d="M12 2.7l5.2 5.9a7.2 7.2 0 1 1-10.4 0L12 2.7z"/>';
    case 'zap':
      return '<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/>';
    case 'cable':
      return '<path d="M4 9h4V5H4v4zm12 10h4v-4h-4v4zM8 7h4a3 3 0 0 1 0 6h0a3 3 0 0 0 0 6h4"/>';
    case 'waves':
      return '<path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>';
    case 'crosshair':
      return '<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="2" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="22" y2="12"/>';
    case 'triangle-alert':
      return '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
    case 'building-2':
    case 'factory':
      return '<rect x="4" y="3" width="16" height="18" rx="1"/><line x1="9" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="15" y2="12"/><path d="M10 21v-4h4v4"/>';
    case 'circle-dot':
      return '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>';
    case 'gauge':
      return '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-4"/>';
    default:
      return '<path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>';
  }
}

/**
 * Generates safe, high-contrast HTML for a Leaflet `L.divIcon` combining category
 * colour, distinct shape (diamond for benchmarks, rounded square for surface,
 * circle for underground), vector icon glyph, and verification ring indicator.
 */
export function buildMarkerHtml(
  symbology: ResolvedAssetSymbology,
  category: AssetRecord['category'],
  isSelected = false,
): string {
  const bg = safeHex(symbology.colorHex, '#1e4d78');
  const size = isSelected ? 34 : 28;
  const borderStyle = symbology.isVerified ? 'solid' : 'dashed';
  const borderColor = isSelected
    ? '#0f172a'
    : symbology.needsAttention
      ? '#fef08a'
      : '#ffffff';
  const borderRadius =
    category === 'survey_reference'
      ? '6px'
      : category === 'surface'
        ? '8px'
        : '9999px';
  const rotateOuter =
    category === 'survey_reference' ? 'transform:rotate(45deg);' : '';
  const rotateInner =
    category === 'survey_reference' ? 'transform:rotate(-45deg);' : '';
  const shadow = isSelected
    ? '0 0 0 3px rgba(15,41,66,0.35), 0 3px 8px rgba(15,23,42,0.4)'
    : '0 2px 5px rgba(15,23,42,0.32)';

  return `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:${bg};color:#ffffff;border:2.5px ${borderStyle} ${borderColor};border-radius:${borderRadius};box-shadow:${shadow};${rotateOuter}"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="${rotateInner}" aria-hidden="true">${glyphSvgPath(symbology.iconKey)}</svg></span>`;
}
