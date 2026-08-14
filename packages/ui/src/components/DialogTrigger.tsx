"use client";

import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button, type ButtonVariant } from "./Button";
import { Dialog } from "./Dialog";

export interface DialogTriggerProps {
  label: string;
  title: string;
  children: ReactNode;
  variant?: ButtonVariant;
  /** Set false to omit the leading Plus icon, e.g. for non-"create" actions. */
  showIcon?: boolean;
}

/**
 * A Button that opens a Dialog containing `children` — owns its own
 * open/close state so a Server Component page can drop it in directly
 * (`<DialogTrigger label="Add Property" title="Add Property"><CreatePropertyForm /></DialogTrigger>`)
 * without needing its own client-state wrapper. `children` can itself be a
 * Server Component (e.g. a form bound to a Server Action) — it's rendered
 * server-side and passed through as an opaque slot.
 */
export function DialogTrigger({
  label,
  title,
  children,
  variant = "primary",
  showIcon = true,
}: DialogTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {showIcon && <Plus className="h-4 w-4" />}
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        {children}
      </Dialog>
    </>
  );
}
