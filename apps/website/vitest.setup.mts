import { vi } from "vitest";

// "server-only" resolves to a throwing module outside Next's "react-server"
// build condition (which Vitest doesn't set) — no-op it for tests. Real
// production builds still enforce the guard via Next's own bundler.
vi.mock("server-only", () => ({}));

// jsdom implements the HTMLDialogElement interface's `open` attribute
// reflection but not the imperative showModal()/close() methods @stayw/ui's
// Dialog (and therefore every consumer, e.g. NotionDetailView,
// OwnerRezMatchReportPreview) calls in a useEffect — any test that actually
// renders a Dialog with `open: true` (not just mounts it closed) throws
// "node.showModal is not a function" without this. Minimal, spec-shaped:
// toggles the reflected `open` attribute and fires the real `close` event
// consumers listen for via the dialog's native `onClose`.
if (
  typeof HTMLDialogElement !== "undefined" &&
  typeof HTMLDialogElement.prototype.showModal !== "function"
) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
