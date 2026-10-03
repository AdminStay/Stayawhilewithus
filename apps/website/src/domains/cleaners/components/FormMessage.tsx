import type { CleanerFormState } from "../actions";

export function FormMessage({ state }: { state: CleanerFormState }) {
  if (state.status === "idle") return null;
  const tone =
    state.status === "success"
      ? "text-success-600"
      : state.status === "validation_error"
        ? "text-warning-700"
        : "text-error-500";
  return (
    <p role="status" className={`text-xs ${tone}`}>
      {state.message}
    </p>
  );
}
