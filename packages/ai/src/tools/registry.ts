import type { ToolDefinition } from "./types";

/**
 * Pure tool catalog: register, look up, list. Deliberately knows nothing
 * about running a tool or the approval gate — that's the Tool Execution
 * Engine's job (./execution-engine.ts), kept separate so the Orchestrator
 * (or anything else) can inspect what's registered without being able to
 * accidentally bypass execution semantics.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased registry; callers get the real generic type back from registerTool/getTool at their own call sites.
const tools = new Map<string, ToolDefinition<any, any>>();

export function registerTool<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>,
): void {
  tools.set(def.name, def as ToolDefinition<unknown, unknown>);
}

export function getTool(name: string): ToolDefinition<unknown, unknown> {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`No tool registered named "${name}".`);
  }
  return tool;
}

export function listTools(): ToolDefinition<unknown, unknown>[] {
  return [...tools.values()];
}
