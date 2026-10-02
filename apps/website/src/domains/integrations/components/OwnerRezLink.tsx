import { ExternalLink } from "lucide-react";

/**
 * Navigation-only link to a page in OwnerRez, opened in a new tab
 * (Meeting #6). `href` must come from lib/ownerrez-links.ts — callers render
 * this only when that helper returned a URL.
 */
export function OwnerRezLink({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      className="ml-2 inline-flex items-center gap-0.5 text-xs font-normal text-forest-600 hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}
