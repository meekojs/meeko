import type { TrustedHtml } from "@meekojs/meeko";

/** A heading of a page, for its table of contents. */
export interface TocEntry {
  readonly id: string;
  readonly text: string;
  /** 2 for `##`, 3 for `###`. */
  readonly level: number;
}

/** A page of the sidebar: its URL and short label. */
export interface NavLink {
  readonly href: string;
  readonly label: string;
  /** The label is the name of a symbol (`useForm`, `<MeekoLink>`), shown as code. */
  readonly code?: boolean;
}

/** A group of the sidebar. */
export interface NavSection {
  readonly title: string;
  readonly links: readonly NavLink[];
  /** `d` of the 16 px stroke icon of a group of the API reference, drawn before its title. */
  readonly icon?: string;
}

/** A rendered Markdown document of the repository. */
export interface RenderedDoc {
  /** Text of its `#` heading. */
  readonly title: string;
  /** Plain text of its first paragraph, for `<meta name="description">`. */
  readonly description: string;
  /** HTML of the whole document, highlighted in the build: Markdown of the repository, so trusted. */
  readonly html: TrustedHtml;
  readonly toc: readonly TocEntry[];
  /** Path of the source in the repository, such as `docs/api.md`. */
  readonly source: string;
  /** "Edit on GitHub" link of the source. */
  readonly editUrl: string;
}

/** Previous and next pages in the order of the sidebar. */
export interface Pager {
  readonly previous: NavLink | null;
  readonly next: NavLink | null;
}
