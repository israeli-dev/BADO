import { clsx } from 'clsx';
import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, id, className, required, rows = 3, ...rest },
    ref,
  ) {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const hintId = `${textareaId}-hint`;
    const errorId = `${textareaId}-error`;

    const describedBy = [error ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="space-y-1.5">
        <label
          htmlFor={textareaId}
          className="block text-sm font-medium text-slate-800"
        >
          {label}
          {required && (
            <span className="ml-1 text-red-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className={clsx(
            'block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors disabled:bg-slate-100 disabled:text-slate-500',
            error
              ? 'border-red-500 focus:border-red-600'
              : 'border-slate-300 focus:border-bado-navy-700',
            className,
          )}
          {...rest}
        />
        {hint && !error && (
          <p id={hintId} className="text-xs text-slate-500">
            {hint}
          </p>
        )}
        {error && (
          <p
            id={errorId}
            role="alert"
            className="text-xs font-medium text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);
