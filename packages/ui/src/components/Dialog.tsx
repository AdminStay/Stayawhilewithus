"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import { cx } from "../lib/cx";

export type DialogSize = "md" | "lg";

const SIZE_CLASSES: Record<DialogSize, string> = {
  md: "max-w-md",
  lg: "max-w-lg",
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** "md" (default, unchanged) or "lg" — for content that needs more room, e.g. a grouped detail panel. */
  size?: DialogSize;
}

/**
 * Built on the native <dialog> element — free focus trap, ESC-to-close, and
 * top-layer stacking without a separate headless-UI dependency.
 *
 * Width is `calc(100% - 2rem)` capped at `size`, not a bare `w-full` — on a
 * narrow/mobile viewport this leaves a consistent 1rem gutter on each side
 * instead of the dialog touching the screen edges; on any viewport wider
 * than `size` the cap takes over, so this is a strict improvement, not a
 * behavior change, for every existing caller. The body also caps its own
 * height and scrolls vertically, so a long detail view never grows the
 * dialog past the viewport — but never scrolls horizontally.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  size = "md",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={handleBackdropClick}
      className={cx(
        "w-[calc(100%-2rem)] rounded-card border border-border bg-surface p-0 shadow-panel backdrop:bg-ink/50 backdrop:backdrop-blur-sm",
        SIZE_CLASSES[size],
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-5 py-5">
        {children}
      </div>
    </dialog>
  );
}
