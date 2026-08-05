export interface PromptTemplate {
  key: string;
  version: number;
  /** "{{variable}}" placeholders, substituted by renderPrompt. */
  template: string;
}
