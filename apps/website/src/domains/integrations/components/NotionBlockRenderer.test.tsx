// @vitest-environment jsdom
import type { NotionContentBlock } from "@stayw/integrations/notion";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotionBlockList,
  type NotionBlockEditContext,
} from "./NotionBlockRenderer";

afterEach(cleanup);

const LAST_EDITED = "2026-09-22T00:00:00.000Z";

function run(text: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    text,
    href: null,
    bold: false,
    italic: false,
    code: false,
    ...overrides,
  };
}

describe("NotionBlockList", () => {
  it("renders nothing for an empty page's block list", () => {
    const { container } = render(<NotionBlockList blocks={[]} />);
    expect(container.textContent).toBe("");
  });

  it("renders a paragraph's real text", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "b1",
        lastEditedTime: LAST_EDITED,
        type: "paragraph",
        text: [run("Call the guest before arrival.")],
        children: [],
      },
    ];
    render(<NotionBlockList blocks={blocks} />);
    expect(screen.getByText("Call the guest before arrival.")).toBeTruthy();
  });

  it("renders heading_1/heading_2/heading_3 with real heading elements", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "h1",
        lastEditedTime: LAST_EDITED,
        type: "heading_1",
        text: [run("Title")],
        children: [],
      },
      {
        id: "h2",
        lastEditedTime: LAST_EDITED,
        type: "heading_2",
        text: [run("Section")],
        children: [],
      },
      {
        id: "h3",
        lastEditedTime: LAST_EDITED,
        type: "heading_3",
        text: [run("Subsection")],
        children: [],
      },
    ];
    render(<NotionBlockList blocks={blocks} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Title" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Section" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 4, name: "Subsection" }),
    ).toBeTruthy();
  });

  it("renders a callout's text and emoji icon", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "c1",
        lastEditedTime: LAST_EDITED,
        type: "callout",
        text: [run("Never share the door code by text.")],
        icon: "⚠️",
        children: [],
      },
    ];
    render(<NotionBlockList blocks={blocks} />);
    expect(screen.getByText("Never share the door code by text.")).toBeTruthy();
    expect(screen.getByText("⚠️")).toBeTruthy();
  });

  it("groups consecutive bulleted_list_item blocks into one real <ul>", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "l1",
        lastEditedTime: LAST_EDITED,
        type: "bulleted_list_item",
        text: [run("Lock the door")],
        children: [],
      },
      {
        id: "l2",
        lastEditedTime: LAST_EDITED,
        type: "bulleted_list_item",
        text: [run("Turn off lights")],
        children: [],
      },
    ];
    const { container } = render(<NotionBlockList blocks={blocks} />);
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(1);
    expect(lists[0]?.querySelectorAll("li")).toHaveLength(2);
  });

  it("groups consecutive numbered_list_item blocks into one real <ol>", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "n1",
        lastEditedTime: LAST_EDITED,
        type: "numbered_list_item",
        text: [run("Step one")],
        children: [],
      },
      {
        id: "n2",
        lastEditedTime: LAST_EDITED,
        type: "numbered_list_item",
        text: [run("Step two")],
        children: [],
      },
    ];
    const { container } = render(<NotionBlockList blocks={blocks} />);
    const lists = container.querySelectorAll("ol");
    expect(lists).toHaveLength(1);
    expect(lists[0]?.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders a toggle as a real <details>/<summary>, with its nested children inside", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "t1",
        lastEditedTime: LAST_EDITED,
        type: "toggle",
        text: [run("Advanced steps")],
        children: [
          {
            id: "child-1",
            lastEditedTime: LAST_EDITED,
            type: "paragraph",
            text: [run("Nested instruction")],
            children: [],
          },
        ],
      },
    ];
    const { container } = render(<NotionBlockList blocks={blocks} />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(screen.getByText("Advanced steps")).toBeTruthy();
    expect(screen.getByText("Nested instruction")).toBeTruthy();
  });

  it("renders a table's rows and cells, marking the header row/column as <th>", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "table-1",
        lastEditedTime: LAST_EDITED,
        type: "table",
        tableWidth: 2,
        hasColumnHeader: true,
        hasRowHeader: false,
        rows: [
          { id: "row-1", cells: [[run("Property")], [run("Lockbox code")]] },
          { id: "row-2", cells: [[run("Camingo")], [run("1234")]] },
        ],
      },
    ];
    const { container } = render(<NotionBlockList blocks={blocks} />);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(screen.getByText("Camingo")).toBeTruthy();
  });

  it("renders a safe fallback for an unsupported block, never crashing or inventing content", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "img-1",
        lastEditedTime: LAST_EDITED,
        type: "unsupported",
        originalType: "image",
      },
    ];
    render(<NotionBlockList blocks={blocks} />);
    expect(
      screen.getByText(/Additional content isn.t shown here/),
    ).toBeTruthy();
    expect(screen.queryByText("image")).toBeNull();
  });

  it("renders a real http(s) link for a rich text run's href, and never for an unsafe scheme", () => {
    const blocks: NotionContentBlock[] = [
      {
        id: "p1",
        lastEditedTime: LAST_EDITED,
        type: "paragraph",
        text: [run("Guidebook", { href: "https://example.com/guide" })],
        children: [],
      },
      {
        id: "p2",
        lastEditedTime: LAST_EDITED,
        type: "paragraph",
        text: [run("Unsafe", { href: "javascript:alert(1)" })],
        children: [],
      },
    ];
    render(<NotionBlockList blocks={blocks} />);
    const link = screen.getByRole("link", { name: "Guidebook" });
    expect(link.getAttribute("href")).toBe("https://example.com/guide");
    expect(screen.getByText("Unsafe").closest("a")).toBeNull();
  });

  describe("editing", () => {
    const editableParagraph: NotionContentBlock = {
      id: "p1",
      lastEditedTime: LAST_EDITED,
      type: "paragraph",
      text: [run("Call the guest before arrival.")],
      children: [],
    };

    it("renders no Edit affordance when editContext is absent — unchanged from before block editing existed", () => {
      render(<NotionBlockList blocks={[editableParagraph]} />);
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    });

    it("renders no Edit affordance when editContext is present but this block's id isn't in editableBlockIds", () => {
      const editContext: NotionBlockEditContext = {
        pageId: "page-1",
        editableBlockIds: new Set(["some-other-block"]),
        action: vi.fn(),
      };
      render(
        <NotionBlockList
          blocks={[editableParagraph]}
          editContext={editContext}
        />,
      );
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    });

    it("renders a real Edit affordance for a paragraph whose id IS in editableBlockIds, and opening it pre-fills the plain text", () => {
      const editContext: NotionBlockEditContext = {
        pageId: "page-1",
        editableBlockIds: new Set(["p1"]),
        action: vi.fn(),
      };
      render(
        <NotionBlockList
          blocks={[editableParagraph]}
          editContext={editContext}
        />,
      );

      const editButton = screen.getByRole("button", { name: "Edit" });
      fireEvent.click(editButton);

      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Call the guest before arrival.");
    });

    it("never renders an Edit affordance for a toggle's own summary, even when its id is in editableBlockIds — deliberately out of scope this pass", () => {
      const toggleBlock: NotionContentBlock = {
        id: "t1",
        lastEditedTime: LAST_EDITED,
        type: "toggle",
        text: [run("Advanced steps")],
        children: [],
      };
      const editContext: NotionBlockEditContext = {
        pageId: "page-1",
        editableBlockIds: new Set(["t1"]),
        action: vi.fn(),
      };
      render(
        <NotionBlockList blocks={[toggleBlock]} editContext={editContext} />,
      );

      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    });

    it("threads editContext into nested children, so a block inside a toggle can still be individually editable", () => {
      const nestedParagraph: NotionContentBlock = {
        id: "child-1",
        lastEditedTime: LAST_EDITED,
        type: "paragraph",
        text: [run("Nested instruction")],
        children: [],
      };
      const toggleBlock: NotionContentBlock = {
        id: "t1",
        lastEditedTime: LAST_EDITED,
        type: "toggle",
        text: [run("Advanced steps")],
        children: [nestedParagraph],
      };
      const editContext: NotionBlockEditContext = {
        pageId: "page-1",
        editableBlockIds: new Set(["child-1"]),
        action: vi.fn(),
      };
      render(
        <NotionBlockList blocks={[toggleBlock]} editContext={editContext} />,
      );

      expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    });
  });
});
