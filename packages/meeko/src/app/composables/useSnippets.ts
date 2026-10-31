import { readChannels } from "../runtime/channels";
import { passedSnippetsKey } from "../runtime/props";
import type { PassedSnippets } from "../runtime/props";
import { snippetOf } from "../runtime/snippets";
import type { SnippetMap } from "../../app/definitions/define-snippets";

function readOnlySnippets(): never {
  throw new TypeError("Meeko snippets are read-only: the parent passes them with <snippet>");
}

/** Traps of the snippets of a mounted child, whose parent may start or stop passing one (`<snippet if:when>`). */
const passedSnippetsTraps: ProxyHandler<{ readonly reader: PassedSnippets }> = {
  get: ({ reader }, key) => {
    if (typeof key === "symbol") return undefined;
    const value = reader.get(key);
    return snippetOf(value) ? value : undefined;
  },
  has: ({ reader }, key) => typeof key === "string" && reader.names().includes(key) && snippetOf(reader.get(key)) !== undefined,
  ownKeys: ({ reader }) => reader.names().filter((name) => snippetOf(reader.get(name))),
  getOwnPropertyDescriptor: ({ reader }, key) => {
    if (typeof key === "symbol") return undefined;
    const value = reader.get(key);
    return snippetOf(value) ? { value, writable: false, enumerable: true, configurable: true } : undefined;
  },
  set: readOnlySnippets,
  defineProperty: readOnlySnippets,
  deleteProperty: readOnlySnippets,
};

/**
 * The snippets that the parent passed to this instance. On a child whose props the parent updates
 * in place, each read is tracked: a binding that reads `snippets.x` follows a `<snippet if:when>`
 * of the parent, and a snippet that stays passed keeps its identity.
 */
export function useSnippets<T>(props: object): SnippetMap<T> {
  const reader = (props as { readonly [passedSnippetsKey]?: PassedSnippets })[passedSnippetsKey];
  if (reader) return new Proxy({ reader }, passedSnippetsTraps) as unknown as SnippetMap<T>;
  const passed = readChannels(props)?.snippets ?? {};
  const snippets: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(passed)) if (snippetOf(value)) snippets[name] = value;
  return Object.freeze(snippets) as SnippetMap<T>;
}
