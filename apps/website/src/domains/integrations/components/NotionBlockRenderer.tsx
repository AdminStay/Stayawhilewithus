import type {
  NotionCalloutContentBlock,
  NotionContentBlock,
  NotionRichTextRun,
  NotionTextContentBlock,
} from "@stayw/integrations/notion";
import type { ReactNode } from "react";

import type {
  UpdateNotionBlockActionInput,
  UpdateNotionBlockActionState,
} from "../actions";

import { isSafeHttpUrl } from "./notion-link.utils";
import { NotionBlockEditor } from "./NotionBlockEditor";

/**
 * Present only when this actor is authorized to edit at least one block on
 * this page — absent (or `editableBlockIds` empty, today's actual state
 * since NOTION_BLOCK_EDIT_ALLOWLIST is empty) means every block renders
 * exactly as it did before block editing existed. `editableBlockIds` is a
 * UX-only hint (see listEditableNotionBlockIds's own doc comment) — the
 * real security boundary is updateNotionBlockContent()'s own independent
 * allowlist/RBAC/page-membership check, unconditionally re-run regardless
 * of what this context claims.
 */
export interface NotionBlockEditContext {
  pageId: string;
  editableBlockIds: ReadonlySet<string>;
  action: (
    prevState: UpdateNotionBlockActionState,
    input: UpdateNotionBlockActionInput,
  ) => Promise<UpdateNotionBlockActionState>;
}

/**
 * Wraps a text-bearing block's normal display in `wrap`, or — only when
 * `editContext` is present AND this exact block id is in its
 * `editableBlockIds` — renders it through NotionBlockEditor instead. Scoped
 * to paragraph/heading_1/heading_2/heading_3/callout only, deliberately:
 * these are the block types that actually make up the real SOP content
 * confirmed by discovery (see HANDOFF.md), and rendering an inline edit
 * `<form>` inside a `<summary>` (toggle) or restructuring the shared
 * `<ul>`/`<ol>` grouping (list items) needs its own careful design, not
 * bundled into this pass — those two types remain server/write-path
 * capable (see NotionEditableBlockType/updateBlockContent()) but simply
 * never render an "Edit" affordance yet.
 */
function maybeEditableText(
  block: NotionTextContentBlock | NotionCalloutContentBlock,
  editContext: NotionBlockEditContext | null | undefined,
  wrap: (content: ReactNode) => ReactNode,
): ReactNode {
  if (!editContext?.editableBlockIds.has(block.id)) {
    return wrap(<RichText runs={block.text} />);
  }
  return (
    <NotionBlockEditor
      pageId={editContext.pageId}
      blockId={block.id}
      lastEditedTime={block.lastEditedTime}
      initialPlainText={block.text.map((run) => run.text).join("")}
      initialDisplay={<RichText runs={block.text} />}
      wrap={wrap}
      action={editContext.action}
    />
  );
}

/**
 * Renders one Notion rich-text run array inline — bold/italic/code
 * annotations and a real http(s) link (never an unsafe scheme, per the same
 * isSafeHttpUrl rule used everywhere else in this domain). Purely
 * presentational: every run's text is exactly what NotionClient.getPageContent()
 * already extracted, never re-fetched or re-interpreted here.
 */
function RichText({ runs }: { runs: NotionRichTextRun[] }) {
  if (runs.length === 0) return null;
  return (
    <>
      {runs.map((run, index) => {
        let node: ReactNode = run.text;
        if (run.code) {
          node = (
            <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
              {node}
            </code>
          );
        }
        if (run.bold) node = <strong>{node}</strong>;
        if (run.italic) node = <em>{node}</em>;
        if (run.href && isSafeHttpUrl(run.href)) {
          node = (
            <a
              href={run.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              {node}
            </a>
          );
        }
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}

/**
 * Groups a flat block list into the visual units they actually render as —
 * Notion itself returns each list item as its own standalone block, never
 * pre-grouped into a single "list" block, so consecutive same-type list
 * items are collected here into one real `<ul>`/`<ol>`. Every other block
 * type renders individually, in its original order.
 */
type BlockGroup =
  | { kind: "single"; block: NotionContentBlock }
  | { kind: "bulleted_list"; items: NotionTextContentBlock[] }
  | { kind: "numbered_list"; items: NotionTextContentBlock[] };

function groupBlocks(blocks: NotionContentBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!block) {
      i++;
      continue;
    }
    if (
      block.type === "bulleted_list_item" ||
      block.type === "numbered_list_item"
    ) {
      const items: NotionTextContentBlock[] = [block];
      let j = i + 1;
      for (; j < blocks.length; j++) {
        const next = blocks[j];
        if (!next || next.type !== block.type) break;
        items.push(next);
      }
      groups.push({
        kind:
          block.type === "bulleted_list_item"
            ? "bulleted_list"
            : "numbered_list",
        items,
      });
      i = j;
    } else {
      groups.push({ kind: "single", block });
      i++;
    }
  }
  return groups;
}

function NestedChildren({
  blocks,
  editContext,
}: {
  blocks: NotionContentBlock[];
  editContext: NotionBlockEditContext | null | undefined;
}) {
  if (blocks.length === 0) return null;
  return (
    <div className="mt-1.5 pl-4">
      <NotionBlockList blocks={blocks} editContext={editContext} />
    </div>
  );
}

/**
 * One non-list-item block, mapped to the closed NotionContentBlock union
 * this V1 renders with real structure — see NotionSupportedBlockType's own
 * doc comment (types.ts) for exactly which real Notion block types that is.
 * "unsupported" (anything outside that set) renders a small, honest
 * fallback line — never dropped silently, never guessed at as some other
 * type. The exhaustiveness check below (`const exhaustive: never = block`)
 * means adding a new NotionContentBlock variant without a case here is a
 * compile error, not a silent gap.
 */
function NotionBlock({
  block,
  editContext,
}: {
  block: NotionContentBlock;
  editContext: NotionBlockEditContext | null | undefined;
}) {
  switch (block.type) {
    case "heading_1":
      return maybeEditableText(block, editContext, (content) => (
        <h2 className="text-lg font-semibold text-ink">{content}</h2>
      ));
    case "heading_2":
      return maybeEditableText(block, editContext, (content) => (
        <h3 className="text-base font-semibold text-ink">{content}</h3>
      ));
    case "heading_3":
      return maybeEditableText(block, editContext, (content) => (
        <h4 className="text-sm font-semibold text-ink">{content}</h4>
      ));
    case "paragraph":
      if (block.text.length === 0 && block.children.length === 0) return null;
      return maybeEditableText(block, editContext, (content) => (
        <div className="text-sm text-ink">
          <p>{content}</p>
          <NestedChildren blocks={block.children} editContext={editContext} />
        </div>
      ));
    case "callout":
      return maybeEditableText(block, editContext, (content) => (
        <div className="flex gap-2 rounded-lg bg-surface-muted p-3 text-sm text-ink">
          {block.icon && (
            <span aria-hidden="true" className="shrink-0">
              {block.icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {content}
            <NestedChildren blocks={block.children} editContext={editContext} />
          </div>
        </div>
      ));
    case "toggle":
      // Server/write-path capable (see NotionEditableBlockType), but
      // deliberately no edit affordance yet — see maybeEditableText's own
      // doc comment for why a toggle's summary isn't wired to an inline
      // edit form in this pass. Its children can still be individually
      // editable, so editContext is still threaded through.
      return (
        <details className="rounded-lg border border-border/70 p-2.5">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            <RichText runs={block.text} />
          </summary>
          <NestedChildren blocks={block.children} editContext={editContext} />
        </details>
      );
    case "table":
      if (block.rows.length === 0) return null;
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={row.id}>
                  {row.cells.map((cell, cellIndex) => {
                    const isHeaderRow = block.hasColumnHeader && rowIndex === 0;
                    const isHeaderCol = block.hasRowHeader && cellIndex === 0;
                    const CellTag = isHeaderRow || isHeaderCol ? "th" : "td";
                    return (
                      <CellTag
                        key={cellIndex}
                        className="border border-border/70 px-2 py-1 text-left align-top font-normal"
                      >
                        <RichText runs={cell} />
                      </CellTag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    // Defensive-only: groupBlocks() above always routes these two types into
    // a real <ul>/<ol> before NotionBlock is ever called, so this path isn't
    // reachable in practice — kept only so the union stays exhaustive.
    case "bulleted_list_item":
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          <li>
            <RichText runs={block.text} />
            <NestedChildren blocks={block.children} editContext={editContext} />
          </li>
        </ul>
      );
    case "numbered_list_item":
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>
            <RichText runs={block.text} />
            <NestedChildren blocks={block.children} editContext={editContext} />
          </li>
        </ol>
      );
    case "unsupported":
      return (
        <p className="text-xs italic text-ink-faint">
          Additional content isn&apos;t shown here — open in Notion to view it.
        </p>
      );
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/**
 * The real, read-only Notion page-body renderer — takes exactly the
 * NotionContentBlock[] NotionClient.getPageContent() returns and renders it
 * readably inside StayWhile. Never fetches anything itself (a pure
 * presentational component, safe to render from a client component without
 * pulling in any server-only module) and never invents content: a block
 * this V1 doesn't support renders its own explicit fallback (see
 * NotionBlock above) rather than being silently dropped or guessed at.
 */
export function NotionBlockList({
  blocks,
  editContext,
}: {
  blocks: NotionContentBlock[];
  /** Absent (or with an empty editableBlockIds) on every real render today — see NotionBlockEditContext's own doc comment. */
  editContext?: NotionBlockEditContext | null;
}) {
  if (blocks.length === 0) return null;
  const groups = groupBlocks(blocks);

  return (
    <div className="space-y-3">
      {groups.map((group, index) => {
        if (group.kind === "bulleted_list") {
          return (
            <ul
              key={index}
              className="list-disc space-y-1 pl-5 text-sm text-ink"
            >
              {group.items.map((item) => (
                <li key={item.id}>
                  <RichText runs={item.text} />
                  <NestedChildren
                    blocks={item.children}
                    editContext={editContext}
                  />
                </li>
              ))}
            </ul>
          );
        }
        if (group.kind === "numbered_list") {
          return (
            <ol
              key={index}
              className="list-decimal space-y-1 pl-5 text-sm text-ink"
            >
              {group.items.map((item) => (
                <li key={item.id}>
                  <RichText runs={item.text} />
                  <NestedChildren
                    blocks={item.children}
                    editContext={editContext}
                  />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <NotionBlock
            key={group.block.id}
            block={group.block}
            editContext={editContext}
          />
        );
      })}
    </div>
  );
}
