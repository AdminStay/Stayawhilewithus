"use client";

import { useState, type ReactNode } from "react";

/**
 * The three primary /notion sections (2026-09-24 redesign, Michelle's
 * "organized operations knowledge center" request) — replaces the previous
 * layout of stacking SOPs, Library, and Property Listings vertically on one
 * long page. Purely a client-side display switch: all three sections'
 * content is still fetched server-side exactly as before (see the /notion
 * page) and passed in fully rendered — switching tabs never triggers a new
 * fetch, it only changes which already-rendered section is visible. Global
 * "Search All Notion" stays outside this component entirely (rendered above
 * it on the page), since it's a cross-cutting feature, not one section's
 * content.
 */
const TABS = [
  { id: "sops", label: "SOPs" },
  { id: "library", label: "Library" },
  { id: "listings", label: "Property Listings" },
] as const;

type NotionTabId = (typeof TABS)[number]["id"];

export function NotionWorkspaceTabs({
  sopsContent,
  libraryContent,
  listingsContent,
}: {
  sopsContent: ReactNode;
  libraryContent: ReactNode;
  listingsContent: ReactNode;
}) {
  const [active, setActive] = useState<NotionTabId>("sops");

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Notion sections"
        className="flex gap-1 rounded-lg border border-border bg-surface-muted p-1"
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={
                isActive
                  ? "flex-1 rounded-md bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-sm"
                  : "flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {active === "sops" && sopsContent}
        {active === "library" && libraryContent}
        {active === "listings" && listingsContent}
      </div>
    </div>
  );
}
