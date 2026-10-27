import type { NavLink, NavSection, Pager } from "../../shared/types/docs.js";

/** A page of the site and the Markdown file of the repository it renders. */
export interface CatalogEntry {
  /** Slug under `/docs/`; absent for the home page. */
  readonly slug?: string;
  readonly href: string;
  /** Path of the Markdown file, as `readRepositoryFile` takes it: `README.md` and `CHANGELOG.md` are the package's. */
  readonly source: string;
  /** Short label of the sidebar; the page title is the document's own heading. */
  readonly label: string;
  readonly section: string;
}

/**
 * The published documents in reading order. `docs/releasing.md` is internal and stays out; links
 * to it, and to any other file of the repository, go to GitHub.
 */
export const catalog: readonly CatalogEntry[] = [
  { href: "/", source: "README.md", label: "Inicio rápido", section: "Empezar" },
  { slug: "framework", href: "/docs/framework", source: "docs/framework.md", label: "Framework full-stack", section: "Guías" },
  { slug: "api", href: "/docs/api", source: "docs/api.md", label: "Componentes y API", section: "Guías" },
  { slug: "editors", href: "/docs/editors", source: "docs/editors.md", label: "Editores", section: "Herramientas" },
  { slug: "devtools", href: "/docs/devtools", source: "docs/devtools.md", label: "DevTools", section: "Herramientas" },
  { slug: "stability", href: "/docs/stability", source: "docs/stability.md", label: "Estabilidad 1.x", section: "Referencia" },
  { slug: "architecture", href: "/docs/architecture", source: "docs/architecture.md", label: "Arquitectura", section: "Referencia" },
  { slug: "migration-1.1", href: "/docs/migration-1.1", source: "docs/migration-1.1.md", label: "Actualizar a 1.1", section: "Referencia" },
  { slug: "migration-1.0", href: "/docs/migration-1.0", source: "docs/migration-1.0.md", label: "Migrar a 1.0", section: "Referencia" },
  { slug: "benchmarks", href: "/docs/benchmarks", source: "docs/benchmarks.md", label: "Rendimiento", section: "Referencia" },
  { slug: "roadmap", href: "/docs/roadmap", source: "docs/roadmap.md", label: "Plan de desarrollo", section: "Proyecto" },
  { slug: "changelog", href: "/docs/changelog", source: "CHANGELOG.md", label: "Cambios", section: "Proyecto" },
];

/** Slugs of the `/docs/[slug]` pages, for `prerenderEntries`. */
export const docSlugs: readonly string[] = catalog.flatMap((entry) => entry.slug === undefined ? [] : [entry.slug]);

/** The entry of a slug, or of the home page without one. */
export function catalogEntry(slug?: string): CatalogEntry | undefined {
  return catalog.find((entry) => entry.slug === slug);
}

/** Site URL of a repository file, if the site publishes it. */
export function pageOfSource(source: string): string | undefined {
  return catalog.find((entry) => entry.source === source)?.href;
}

/** The sidebar, grouped by section in reading order. */
export function navigation(): NavSection[] {
  const sections: Array<{ title: string; links: NavLink[] }> = [];
  for (const entry of catalog) {
    let section = sections.find((candidate) => candidate.title === entry.section);
    if (!section) sections.push(section = { title: entry.section, links: [] });
    section.links.push({ href: entry.href, label: entry.label });
  }
  return sections;
}

/** Previous and next pages of `href` in reading order. */
export function pager(href: string): Pager {
  const index = catalog.findIndex((entry) => entry.href === href);
  const link = (entry: CatalogEntry | undefined): NavLink | null => entry ? { href: entry.href, label: entry.label } : null;
  return { previous: link(catalog[index - 1]), next: link(catalog[index + 1]) };
}
