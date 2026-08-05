import type { PromptTemplate } from "./types";

const templates = new Map<string, PromptTemplate>();

function versionedKey(key: string, version: number): string {
  return `${key}@${version}`;
}

/**
 * Registers a prompt template under both its versioned key and its bare key
 * (which always tracks the most recently registered version — "latest").
 */
export function registerPrompt(template: PromptTemplate): void {
  templates.set(versionedKey(template.key, template.version), template);
  templates.set(template.key, template);
}

export function getPrompt(key: string, version?: number): PromptTemplate {
  const lookupKey = version === undefined ? key : versionedKey(key, version);
  const template = templates.get(lookupKey);
  if (!template) {
    throw new Error(
      `No prompt registered for "${key}"${version !== undefined ? `@${version}` : ""}.`,
    );
  }
  return template;
}

/** Renders a registered template, substituting {{var}} with vars[var]. An unresolved placeholder is left as-is rather than throwing. */
export function renderPrompt(
  key: string,
  vars: Record<string, string>,
  version?: number,
): string {
  const template = getPrompt(key, version);
  return template.template.replace(
    /{{\s*(\w+)\s*}}/g,
    (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : value;
    },
  );
}
