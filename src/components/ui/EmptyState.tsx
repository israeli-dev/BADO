import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center">
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-bado-navy-50 text-bado-navy-800">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{title}</h3>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-600 sm:text-sm">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
