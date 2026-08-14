import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cx } from "../lib/cx";

const FIELD_CLASSES =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-forest-500 focus:outline-none focus:ring-2 focus:ring-forest-500/15 disabled:cursor-not-allowed disabled:opacity-60";

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD_CLASSES, className)} {...rest} />;
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD_CLASSES, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cx(FIELD_CLASSES, "min-h-24", className)} {...rest} />
  );
}

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  description?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {description && !error && (
        <p className="text-xs text-ink-muted">{description}</p>
      )}
      {error && <p className="text-xs text-error-500">{error}</p>}
    </div>
  );
}
