"use client";

import type { MouseEvent } from "react";

import { Button, type ButtonProps } from "./Button";

export interface ConfirmButtonProps extends ButtonProps {
  /** Shown in a native confirm() prompt before the click is allowed through — e.g. to a form's onSubmit. */
  confirmMessage: string;
}

/**
 * A submit Button that gates on window.confirm() before letting the click
 * (and the form submission it triggers) proceed. Purely a client-side UX
 * safeguard for destructive actions — never touches the server action or
 * what it does, only whether the click reaches it.
 */
export function ConfirmButton({
  confirmMessage,
  onClick,
  ...rest
}: ConfirmButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return <Button {...rest} onClick={handleClick} />;
}
