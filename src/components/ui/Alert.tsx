import { clsx } from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const config: Record<
  AlertTone,
  { container: string; Icon: typeof Info }
> = {
  info: {
    container: 'border-sky-200 bg-sky-50 text-sky-950',
    Icon: Info,
  },
  success: {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    Icon: CheckCircle2,
  },
  warning: {
    container: 'border-amber-300 bg-amber-50 text-amber-950',
    Icon: AlertTriangle,
  },
  danger: {
    container: 'border-red-300 bg-red-50 text-red-950',
    Icon: ShieldAlert,
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: AlertProps) {
  const { container, Icon } = config[tone];

  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={clsx(
        'flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm',
        container,
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={clsx(title && 'mt-0.5', 'text-xs leading-relaxed sm:text-sm')}>
          {children}
        </div>
      </div>
    </div>
  );
}
