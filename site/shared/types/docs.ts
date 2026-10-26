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
}

/** A group of the sidebar. */
export interface NavSection {
  readonly title: string;
  readonly links: readonly NavLink[];
}

/** A rendered Markdown document of the repository. */
export interface RenderedDoc {
  /** Text of its `#` heading. */
  readonly title: string;
  /** Plain text of its first paragraph, for `<meta name="description">`. */
  readonly description: string;
  /** HTML of the whole document, highlighted in the build. */
  readonly html: string;
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
