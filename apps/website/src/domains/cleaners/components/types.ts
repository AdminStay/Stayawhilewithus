import type { CleanerFormState } from "../actions";

/**
 * A cleaners server action, passed down from a Server Component as a prop
 * rather than imported by the client component — same reason as
 * CreateResourceLinkForm's own doc comment (a plain Vite/Vitest transform
 * doesn't do Next.js's "use server" rewrite).
 */
export type CleanerAction = (
  prevState: CleanerFormState,
  formData: FormData,
) => Promise<CleanerFormState>;

export const INITIAL_CLEANER_FORM_STATE: CleanerFormState = { status: "idle" };
