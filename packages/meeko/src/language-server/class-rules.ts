import postcss from "postcss";
import type { AtRule, Container, Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

// Class selectors of a stylesheet, read from its text: no PostCSS plugin runs, so reading a
// project's CSS never executes its code.

/** A class that a rule of a stylesheet selects: `.card` in `@media (…) { .card:hover > p {} }`. */
export interface ClassRule {
  /** The class name, unescaped: `md:flex` for `.md\:flex`. */
  readonly name: string;
  /** Offset of the `.` (or of the name of `@utility`) in the text the stylesheet came from. */
  readonly start: number;
  readonly end: number;
  /** Offsets of the whole rule, for its snippet. */
  readonly ruleStart: number;
  readonly ruleEnd: number;
  /** Inside `:global(…)`, so it styles markup outside a `<style scoped>`. */
  readonly global: boolean;
  /** Opening lines of the at-rules and rules around it, outermost first (`@media (…)`, `.card`). */
  readonly context: readonly string[];
}

const header = (node: Container): string | undefined => {
  if (node.type === "rule") return (node as Rule).selector;
  if (node.type === "atrule") {
    const atRule = node as AtRule;
    return `@${atRule.name}${atRule.params ? ` ${atRule.params}` : ""}`;
  }
  return undefined;
};

/**
 * The class selectors of `css`, with offsets shifted by `base` (where `css` starts in its file).
 * They include the classes in nested rules (`&.open`), at-rules (`@media`, `@layer`), pseudo-class
 * arguments (`:is()`, `:not()`, `:global()`) and Tailwind's `@utility name`. `undefined` while the
 * CSS does not parse, as when a rule is being typed.
 */
export function cssClassRules(css: string, base = 0): ClassRule[] | undefined {
  let root: postcss.Root;
  try { root = postcss.parse(css); }
  catch { return undefined; }
  const found: ClassRule[] = [];
  const contexts = new Map<Container, readonly string[]>();
  const contextOf = (parent: Container | undefined): readonly string[] => {
    if (!parent || parent.type === "root") return [];
    let context = contexts.get(parent);
    if (!context) {
      const own = header(parent);
      context = [...contextOf(parent.parent as Container | undefined), ...own === undefined ? [] : [own]];
      contexts.set(parent, context);
    }
    return context;
  };
  root.walk((node) => {
    const start = node.source?.start?.offset;
    const end = node.source?.end?.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "atrule" && node.name === "utility") {
      // Tailwind 4: `@utility tab-4 {}` is the class `tab-4`; a functional `tab-*` is not one class.
      const name = node.params.trim();
      if (!/^[\w-]+$/.test(name)) return;
      const at = base + css.indexOf(name, start + node.name.length + 1);
      found.push({ name, start: at, end: at + name.length, ruleStart: base + start, ruleEnd: base + end, global: false, context: contextOf(node.parent as Container | undefined) });
      return;
    }
    if (node.type !== "rule") return;
    const selector = node.raws.selector?.raw ?? node.selector;
    try {
      selectorParser((selectors) => {
        selectors.walkClasses((item) => {
          let global = false;
          for (let parent = item.parent; parent; parent = parent.parent) {
            if (parent.type === "pseudo" && parent.value === ":global") global = true;
          }
          const at = base + start + (item.sourceIndex ?? 0);
          const written = (item as unknown as { raws?: { value?: string } }).raws?.value ?? item.value;
          found.push({
            name: item.value, start: at, end: at + written.length + 1, ruleStart: base + start, ruleEnd: base + end, global,
            context: contextOf(node.parent as Container | undefined),
          });
        });
      }).processSync(selector);
    } catch { /* A selector being typed. */ }
  });
  return found;
}

/**
 * The local files that `@import` names in `css` (`"./tokens.css"`, `url(./x.css)`), as written.
 * Packages (`"tailwindcss"`) and remote URLs are left for the caller to discard when they do not
 * resolve to a file.
 */
export function cssImports(css: string): string[] {
  const found: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of text.matchAll(/@import\s+(?:url\(\s*)?(?:(["'])([^"'\r\n]+)\1|([^\s"'()]+)\s*\))/gi)) {
    const target = (match[2] ?? match[3] ?? "").trim();
    if (target && !/^[a-z][\w+.-]*:/i.test(target) && !target.startsWith("//")) found.push(target);
  }
  return found;
}

const maximumLines = 12;

/**
 * The rule of a class as a short CSS snippet for hovers and completion documentation: its
 * at-rules and parent rules around it, re-indented, and at most {@link maximumLines} lines.
 */
export function classRuleSnippet(text: string, rule: ClassRule): string {
  const lines = text.slice(rule.ruleStart, rule.ruleEnd).split(/\r?\n/);
  // The first line starts at the selector; the closing brace carries the rule's own indentation.
  const indent = lines.length > 1 ? /^[ \t]*/.exec(lines.at(-1)!)![0].length : 0;
  let body = lines.map((line, index) => index === 0 ? line : line.slice(Math.min(indent, /^[ \t]*/.exec(line)![0].length)));
  if (body.length > maximumLines) body = [...body.slice(0, maximumLines - 2), "  …", body.at(-1)!];
  const depth = rule.context.length;
  const pad = (level: number): string => "  ".repeat(level);
  return [
    ...rule.context.map((line, level) => `${pad(level)}${line} {`),
    ...body.map((line) => `${pad(depth)}${line}`),
    ...rule.context.map((_, level) => `${pad(depth - level - 1)}}`),
  ].join("\n");
}
