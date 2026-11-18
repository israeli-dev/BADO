import { clsx } from 'clsx';
import { forwardRef, useId, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
  hideLabel?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    hint,
    error,
    hideLabel = false,
    id,
    className,
    required,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const hintId = `${selectId}-hint`;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={selectId}
        className={clsx(
          hideLabel ? 'sr-only' : 'block text-sm font-medium text-slate-800',
        )}
      >
        {label}
        {required && !hideLabel && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={clsx(
          'block w-full min-h-11 rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 transition-colors disabled:bg-slate-100 disabled:text-slate-500',
          error
            ? 'border-red-500 focus:border-red-600'
            : 'border-slate-300 focus:border-bado-navy-700',
          className,
        )}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
});
