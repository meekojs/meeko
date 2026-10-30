import type postcss from "postcss";
import selectorParser from "postcss-selector-parser";

/**
 * What a scoped selector can see of a template element when the component is compiled: its tag,
 * its static attributes and the attributes the template or the page may change later.
 */
export interface ScopeCandidate {
  /** Tag name, lowercase. */
  readonly tag: string;
  /** Static attributes, by lowercase name. */
  readonly attributes: ReadonlyMap<string, string>;
  /** Lowercase names of attributes that the template renders or updates (`bind:name`, `model`). */
  readonly dynamic: ReadonlySet<string>;
  /**
   * The element may get any class or attribute outside the template: the script holds it through
   * `ref:` or an `on:` handler (`event.currentTarget`), or it is a custom element that sets its own.
   */
  readonly open: boolean;
}

/** Whether an element needs the scope attribute: some scoped compound may match it. */
export type ScopeTargets = (candidate: ScopeCandidate) => boolean;

type Matcher = (candidate: ScopeCandidate) => boolean;
type SelectorNode = selectorParser.Selector["nodes"][number];

const always: Matcher = () => true;

/** Pseudo-classes that match an element when one of their arguments does. */
const matchesAny = new Set([":is", ":where", ":matches", ":any", ":-webkit-any", ":-moz-any"]);

/**
 * Attributes that the browser itself adds to template elements, with their tags: `open` on
 * `<details>` (the user opens it) and `<dialog>` (`showModal()`).
 */
const browserAttributes: ReadonlyMap<string, ReadonlySet<string>> = new Map([["open", new Set(["details", "dialog"])]]);

/**
 * Elements that need the scope attribute of a scoped stylesheet, after `scopeCss` rewrote it.
 *
 * Only the compound that carries the attribute constrains an element to the component: the other
 * compounds of a selector (ancestors, siblings, `:global(...)`) match any element of the page,
 * with or without the attribute. An element therefore needs the attribute only when it may match
 * one of those compounds (the compound that carries it). The analysis over-approximates: a
 * pseudo-class, a pseudo-element, `:not(...)`, `:has(...)` and `*` match every element; `:is(...)`
 * and `:where(...)` match when an argument's last compound does; `&` matches what the subject of
 * its parent rule matches; a class, an id or an attribute matches when the element has it
 * statically or may get it (`bind:class`, `bind:id`, `bind:name`, `model`, an open element, `open`
 * on `<details>` and `<dialog>`). Tags, classes, ids and attribute values compare without case, as
 * in quirks mode and in the HTML attributes whose values ignore case.
 */
export function scopeTargets(root: postcss.Root, scopeAttribute: string): ScopeTargets {
  const scoped: Matcher[] = [];
  const subjects = new Map<postcss.Node, Matcher>();
  root.walkRules((rule) => {
    let ancestor: postcss.Node | undefined = rule.parent;
    let nesting: Matcher = always;
    while (ancestor) {
      if (ancestor.type === "atrule" && /keyframes$/i.test((ancestor as postcss.AtRule).name)) return;
      if (ancestor.type === "rule") {
        nesting = subjects.get(ancestor) ?? always;
        break;
      }
      ancestor = ancestor.parent;
    }
    const ruleSubjects: Matcher[] = [];
    let parsed = true;
    try {
      selectorParser((selectors) => {
        selectors.each((selector) => {
          const compounds = compoundsOf(selector.nodes);
          ruleSubjects.push(compoundMatcher(compounds.at(-1) ?? [], nesting));
          const compound = compounds.find((nodes) => nodes.some((node) => isScopeAttribute(node, scopeAttribute)));
          if (compound) scoped.push(compoundMatcher(compound.filter((node) => !isScopeAttribute(node, scopeAttribute)), nesting));
        });
      }).processSync(rule.selector);
    } catch {
      parsed = false;
    }
    // A selector that does not parse again keeps every element scoped.
    if (!parsed) {
      scoped.push(always);
      ruleSubjects.push(always);
    }
    subjects.set(rule, (candidate) => ruleSubjects.some((subject) => subject(candidate)));
  });
  return (candidate) => scoped.some((matches) => matches(candidate));
}

function isScopeAttribute(node: SelectorNode, scopeAttribute: string): boolean {
  return node.type === "attribute" && node.attribute === scopeAttribute;
}

/** The compounds of a selector, split at its combinators; a leading combinator leaves an empty one. */
function compoundsOf(nodes: readonly SelectorNode[]): SelectorNode[][] {
  const compounds: SelectorNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "combinator") compounds.push([]);
    else if (node.type !== "comment") compounds.at(-1)!.push(node);
  }
  return compounds;
}

function compoundMatcher(nodes: readonly SelectorNode[], nesting: Matcher): Matcher {
  const tests = nodes.map((node) => nodeMatcher(node, nesting));
  return (candidate) => tests.every((test) => test(candidate));
}

function nodeMatcher(node: SelectorNode, nesting: Matcher): Matcher {
  switch (node.type) {
    case "tag": {
      const tag = node.value.toLowerCase();
      return (candidate) => candidate.tag === tag;
    }
    case "class": {
      const name = node.value.toLowerCase();
      return (candidate) => candidate.open || candidate.dynamic.has("class")
        || (candidate.attributes.get("class") ?? "").toLowerCase().split(/[\t\n\f\r ]+/).includes(name);
    }
    case "id": {
      const id = node.value.toLowerCase();
      return (candidate) => candidate.open || candidate.dynamic.has("id") || candidate.attributes.get("id")?.toLowerCase() === id;
    }
    case "attribute":
      return attributeMatcher(node);
    case "nesting":
      return nesting;
    case "pseudo": {
      if (!matchesAny.has(node.value.toLowerCase()) || !node.nodes.length) return always;
      const options = node.nodes.map((selector) => compoundMatcher(compoundsOf(selector.nodes).at(-1) ?? [], nesting));
      return (candidate) => options.some((option) => option(candidate));
    }
    default:
      return always;
  }
}

function attributeMatcher(node: selectorParser.Attribute): Matcher {
  const name = node.attribute.toLowerCase();
  // A namespaced attribute (`[xlink|href]`) and Meeko's own markers are not worth narrowing.
  if (node.namespace !== undefined || name.startsWith("data-meeko-")) return always;
  const expected = node.value?.toLowerCase();
  const operator = node.operator;
  const browserTags = browserAttributes.get(name);
  return (candidate) => {
    if (candidate.open || candidate.dynamic.has(name) || browserTags?.has(candidate.tag)) return true;
    const value = candidate.attributes.get(name)?.toLowerCase();
    if (value === undefined) return false;
    if (operator === undefined || expected === undefined) return true;
    switch (operator) {
      case "=": return value === expected;
      case "~=": return value.split(/[\t\n\f\r ]+/).includes(expected);
      case "|=": return value === expected || value.startsWith(`${expected}-`);
      case "^=": return value.startsWith(expected);
      case "$=": return value.endsWith(expected);
      case "*=": return value.includes(expected);
      default: return true;
    }
  };
}
