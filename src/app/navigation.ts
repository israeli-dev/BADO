import {
  ClipboardCheck,
  Database,
  Droplets,
  FileBarChart2,
  LayoutDashboard,
  Map,
  Radio,
  Settings,
  Shovel,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@/lib/permissions/rbac';

export interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  permission?: Permission;
  mobileBottomBar?: boolean;
  end?: boolean;
}

export const MAIN_NAVIGATION: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    shortLabel: 'Home',
    icon: LayoutDashboard,
    mobileBottomBar: true,
    end: true,
  },
  {
    to: '/map',
    label: 'Infrastructure Map',
    shortLabel: 'Map',
    icon: Map,
    permission: 'infrastructure:view',
    mobileBottomBar: true,
  },
  {
    to: '/assets',
    label: 'Assets',
    shortLabel: 'Assets',
    icon: Database,
    permission: 'infrastructure:view',
    mobileBottomBar: true,
  },
  {
    to: '/live',
    label: 'BADO Live',
    shortLabel: 'Live',
    icon: Radio,
    permission: 'live_mode:use',
    mobileBottomBar: true,
  },
  {
    to: '/dig-check',
    label: 'Check Before You Dig',
    shortLabel: 'Dig Check',
    icon: Shovel,
    permission: 'dig_check:run',
    mobileBottomBar: true,
  },
  {
    to: '/passports',
    label: 'Borehole Passports',
    shortLabel: 'Passports',
    icon: Droplets,
    permission: 'passports:view',
  },
  {
    to: '/operations',
    label: 'Inspections & Maintenance',
    shortLabel: 'Inspections',
    icon: ClipboardCheck,
    permission: 'infrastructure:view',
  },
  {
    to: '/reports',
    label: 'Reports',
    shortLabel: 'Reports',
    icon: FileBarChart2,
    permission: 'reports:view',
  },
  {
    to: '/admin',
    label: 'Administration',
    shortLabel: 'Admin',
    icon: Settings,
    permission: 'admin:access',
  },
];
