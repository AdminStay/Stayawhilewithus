import type {
  NotionCalloutContentBlock,
  NotionContentBlock,
  NotionRichTextRun,
  NotionTextContentBlock,
} from "@stayw/integrations/notion";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";

import type {
  NotionPageContentActionState,
  UpdateNotionBlockActionInput,
  UpdateNotionBlockActionState,
} from "../actions";

import { NotionBlockEditor } from "./NotionBlockEditor";
import { isSafeHttpUrl } from "./notion-link.utils";

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
  onOpenChildPage,
}: {
  blocks: NotionContentBlock[];
  editContext: NotionBlockEditContext | null | undefined;
  onOpenChildPage: ((pageId: string, title: string) => void) | undefined;
}) {
  if (blocks.length === 0) return null;
  return (
    <div className="mt-1.5 pl-4">
      <NotionBlockList
        blocks={blocks}
        editContext={editContext}
        onOpenChildPage={onOpenChildPage}
      />
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
  onOpenChildPage,
}: {
  block: NotionContentBlock;
  editContext: NotionBlockEditContext | null | undefined;
  onOpenChildPage: ((pageId: string, title: string) => void) | undefined;
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
          <NestedChildren
            blocks={block.children}
            editContext={editContext}
            onOpenChildPage={onOpenChildPage}
          />
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
            <NestedChildren
              blocks={block.children}
              editContext={editContext}
              onOpenChildPage={onOpenChildPage}
            />
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
          <NestedChildren
            blocks={block.children}
            editContext={editContext}
            onOpenChildPage={onOpenChildPage}
          />
        </details>
      );
    case "child_page":
      // A link to a genuinely separate Notion page — its real content is
      // fetched on demand (via onOpenChildPage, the same
      // fetchNotionPageContentAction()-backed flow already used for search
      // results), never eagerly. When no handler is supplied (e.g. this
      // block appears inside a plain search-result preview with no "open a
      // nested page" context wired up), it renders as a plain, non-clickable
      // title instead of a dead click target.
      return onOpenChildPage ? (
        <button
          type="button"
          onClick={() => onOpenChildPage(block.id, block.title)}
          className="flex w-full items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
        >
          <FileText
            className="h-4 w-4 shrink-0 text-ink-faint"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm font-medium text-ink">
          <FileText
            className="h-4 w-4 shrink-0 text-ink-faint"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{block.title}</span>
        </div>
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
            <NestedChildren
              blocks={block.children}
              editContext={editContext}
              onOpenChildPage={onOpenChildPage}
            />
          </li>
        </ul>
      );
    case "numbered_list_item":
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
          <li>
            <RichText runs={block.text} />
            <NestedChildren
              blocks={block.children}
              editContext={editContext}
              onOpenChildPage={onOpenChildPage}
            />
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
  onOpenChildPage,
}: {
  blocks: NotionContentBlock[];
  /** Absent (or with an empty editableBlockIds) on every real render today — see NotionBlockEditContext's own doc comment. */
  editContext?: NotionBlockEditContext | null;
  /** Called with a `child_page` block's real id/title when clicked — the caller is expected to fetch that page's content on demand (e.g. via fetchNotionPageContentAction) and display it, the same way a search result is opened. Absent means every `child_page` block renders as a plain, non-clickable title instead of a dead click target. */
  onOpenChildPage?: (pageId: string, title: string) => void;
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
                    onOpenChildPage={onOpenChildPage}
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
                    onOpenChildPage={onOpenChildPage}
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
            onOpenChildPage={onOpenChildPage}
          />
        );
      })}
    </div>
  );
}

/** Client-side loading/idle states added on top of whatever fetchNotionPageContentAction() itself returns — "idle" (nothing opened yet) and "loading" (the fetch is in flight) never come from the server, only from the caller's own local state before/during that call. */
export type NotionFetchedPageContentState =
  { status: "idle" } | { status: "loading" } | NotionPageContentActionState;

/**
 * The shared "one Notion page's fetched content, rendered with its loading/
 * error/truncated states" body — used both by NotionSearch.tsx (opening a
 * search result) and NotionSopLibrary.tsx (opening a `child_page` block
 * from the SOP library tree). A loading indicator while the fetch is in
 * flight, a safe generic error message on a real failure (never the raw
 * error — see fetchNotionPageContentAction's own doc comment), the real
 * rendered blocks on success, and an honest "not everything shown" note
 * when the read was cut off by getPageContent()'s own safety caps. Renders
 * nothing before a page has been opened (`idle`) or when Notion isn't
 * configured (`not_configured` — the caller's own connection-status UI
 * already covers that case elsewhere).
 */
export function NotionFetchedPageContent({
  state,
  pageId,
  updateBlockAction,
  onOpenChildPage,
}: {
  state: NotionFetchedPageContentState;
  /** The real Notion page id this content was fetched from — used to build the block-edit context (never rendered). `null` disables editing entirely, regardless of `state`. */
  pageId: string | null;
  updateBlockAction: (
    prevState: UpdateNotionBlockActionState,
    input: UpdateNotionBlockActionInput,
  ) => Promise<UpdateNotionBlockActionState>;
  /** Forwarded to NotionBlockList — lets a `child_page` block nested inside this fetched content (e.g. a SOP page that itself links to another page) open the same way. */
  onOpenChildPage?: (pageId: string, title: string) => void;
}) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return <p className="text-sm text-ink-muted">Loading content…</p>;
  }

  if (state.status === "not_configured") {
    return null;
  }

  if (state.status === "error") {
    return (
      <p className="text-sm text-error-500">
        Couldn&apos;t load this page&apos;s content. You can still open it
        directly in Notion below.
      </p>
    );
  }

  const { content, editableBlockIds } = state;
  // Absent (not just an empty set) whenever there's no page id to submit an
  // edit against — NotionBlockList/NotionBlock/maybeEditableText already
  // treat a missing editContext as "render exactly as before block editing
  // existed", so this is never a behavior change on its own; it only
  // matters once editableBlockIds is actually non-empty for some page,
  // which requires an explicit NOTION_BLOCK_EDIT_ALLOWLIST entry.
  const editContext: NotionBlockEditContext | null = pageId
    ? {
        pageId,
        editableBlockIds: new Set(editableBlockIds),
        action: updateBlockAction,
      }
    : null;

  return (
    <div className="space-y-3 border-b border-border pb-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Content
      </h3>
      {content.blocks.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No readable content on this page yet.
        </p>
      ) : (
        <NotionBlockList
          blocks={content.blocks}
          editContext={editContext}
          onOpenChildPage={onOpenChildPage}
        />
      )}
      {content.truncated && (
        <p className="text-xs italic text-ink-faint">
          This page has more content than shown here — open it in Notion to see
          everything.
        </p>
      )}
    </div>
  );
}
