import { vi } from "vitest";

// "server-only" resolves to a throwing module outside Next's "react-server"
// build condition (which Vitest doesn't set) — no-op it for tests. Real
// production builds still enforce the guard via Next's own bundler.
vi.mock("server-only", () => ({}));
