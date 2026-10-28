/**
 * HTML attributes of each element, for `<component is>` with a tag and for `bind="obj"`.
 *
 * Copied from the HTML data of `vscode-html-languageservice` (MDN), which the editor already uses
 * for completion; `tests/html-attributes.test.ts` keeps both in sync. Event handler attributes
 * (`on*`) are left out, because Meeko writes events as `on:event`, and so is `is`, the directive
 * of `<component>`. `type` is left out of `<a>` and `<area>`: there it is only a MIME hint, and
 * with `is="href ? 'a' : 'button'"` `bind:type` is the type of the button.
 */

/** Attributes that every HTML element accepts, besides `aria-*` and `data-*`, separated by spaces. */
export const globalAttributeNames = "accesskey autocapitalize autocorrect autofocus class contenteditable contextmenu dir draggable dropzone enterkeyhint exportparts hidden id inert inputmode itemid itemprop itemref itemscope itemtype lang nonce part popover role slot spellcheck style tabindex title translate virtualkeyboardpolicy";

/** Attributes of each HTML element, besides the global ones, separated by spaces. */
export const elementAttributeNames = {
  a: "download href hreflang ping referrerpolicy rel target",
  abbr: "",
  address: "",
  area: "alt coords download href hreflang ping rel shape target",
  article: "",
  aside: "",
  audio: "autoplay controls crossorigin loop mediagroup muted preload src",
  b: "",
  base: "href target",
  bdi: "",
  bdo: "",
  blockquote: "cite",
  body: "alink background bgcolor bottommargin leftmargin link rightmargin text topmargin vlink",
  br: "clear",
  button: "autocomplete disabled form formaction formenctype formmethod formnovalidate formtarget name popovertarget popovertargetaction type value",
  canvas: "height moz-opaque width",
  caption: "align",
  cite: "",
  code: "",
  col: "align span",
  colgroup: "align span",
  data: "value",
  datalist: "",
  dd: "nowrap",
  del: "cite datetime",
  details: "name open",
  dfn: "",
  dialog: "open",
  div: "",
  dl: "",
  dt: "",
  em: "",
  embed: "height src type width",
  fencedframe: "allow height width",
  fieldset: "disabled form name",
  figcaption: "",
  figure: "",
  footer: "",
  form: "accept accept-charset action autocomplete enctype method name novalidate target",
  h1: "",
  h2: "",
  h3: "",
  h4: "",
  h5: "",
  h6: "",
  head: "profile",
  header: "",
  hgroup: "",
  hr: "align color noshade size width",
  html: "manifest version xmlns",
  i: "",
  iframe: "allow allowfullscreen allowpaymentrequest csp height importance name referrerpolicy sandbox seamless src srcdoc width",
  img: "alt crossorigin decoding fetchpriority height importance intrinsicsize ismap loading referrerpolicy sizes src srcset usemap width",
  input: "accept alt autocomplete checked dirname disabled form formaction formenctype formmethod formnovalidate formtarget height list max maxlength min minlength multiple name pattern placeholder popovertarget popovertargetaction readonly required size src step type value width",
  ins: "cite datetime",
  kbd: "",
  label: "for form",
  legend: "",
  li: "type value",
  link: "as crossorigin href hreflang importance integrity media referrerpolicy rel sizes type",
  main: "",
  map: "name",
  mark: "",
  menu: "",
  meta: "charset content http-equiv name scheme",
  meter: "form high low max min optimum value",
  nav: "",
  noscript: "",
  object: "archive border classid codebase codetype data declare form height name standby type typemustmatch usemap width",
  ol: "compact reversed start type",
  optgroup: "disabled label",
  option: "disabled label selected value",
  output: "for form name",
  p: "",
  param: "name type value valuetype",
  picture: "",
  pre: "cols width wrap",
  progress: "max value",
  q: "cite",
  rb: "",
  rp: "",
  rt: "",
  ruby: "",
  s: "",
  samp: "",
  script: "async charset crossorigin defer integrity nomodule referrerpolicy src text type",
  search: "",
  section: "",
  select: "autocomplete disabled form multiple name required size",
  selectedcontent: "",
  slot: "name",
  small: "",
  source: "media sizes src srcset type",
  span: "",
  strong: "",
  style: "media scoped type",
  sub: "",
  summary: "",
  sup: "",
  table: "align border",
  tbody: "align",
  td: "abbr align axis bgcolor colspan headers rowspan",
  template: "",
  textarea: "autocomplete cols dirname disabled form maxlength minlength name placeholder readonly required rows wrap",
  tfoot: "align",
  th: "abbr align axis bgcolor colspan headers rowspan scope sorted",
  thead: "align",
  time: "datetime",
  title: "",
  tr: "align",
  track: "default kind label src srclang",
  u: "",
  ul: "compact",
  var: "",
  video: "autoplay controls crossorigin height loop mediagroup muted poster preload src width",
  wbr: "",
} as const;

/** The words of a list separated by spaces, as a union. */
export type Words<List extends string> = List extends `${infer Word} ${infer Rest}` ? Word | Words<Rest> : List extends "" ? never : List;

/** Elements of the HTML data. */
export type HtmlTagName = keyof typeof elementAttributeNames;

/** Attributes of every HTML element: the global ones, `aria-*` and `data-*`. */
export type GlobalAttributeName = Words<typeof globalAttributeNames> | `aria-${string}` | `data-${string}`;

/**
 * Attribute names of `Tag`: the global ones and its own. Distributive, so a union of tags accepts
 * the attributes of any of them; an element outside the HTML data (a custom element, SVG) accepts
 * any name.
 */
export type AttributeNameOf<Tag extends string> = Tag extends HtmlTagName ? GlobalAttributeName | Words<(typeof elementAttributeNames)[Tag]> : string;

/** Value of an attribute: `null`, `undefined` and `false` leave it out; `true` writes it empty. */
export type AttributeValue = string | number | boolean | null | undefined;

// Built on first use: a bundle that never checks an attribute (no `<component is>` with a tag) drops the lists.
let globalNames: ReadonlySet<string> | undefined;

/** Whether `name` is a global attribute: one of the list, `aria-*` or `data-*`. */
export function isGlobalAttribute(name: string): boolean {
  globalNames ??= new Set(globalAttributeNames.split(" "));
  return globalNames.has(name) || name.startsWith("aria-") || name.startsWith("data-");
}

let ownNames: Map<string, ReadonlySet<string>> | undefined;

/** Own attributes of an element of the HTML data, or `undefined` for another tag. */
function ownAttributes(tag: string): ReadonlySet<string> | undefined {
  ownNames ??= new Map(Object.entries(elementAttributeNames).map(([name, list]) => [name, new Set<string>(list ? list.split(" ") : [])]));
  return ownNames.get(tag);
}

/** Whether the element `tag` of the HTML data accepts the attribute `name` (always for a global one). */
export function elementAccepts(tag: string, name: string): boolean {
  return isGlobalAttribute(name) || (ownAttributes(tag)?.has(name) ?? false);
}

/**
 * Tags among `tags` whose own attributes include `name`, or `null` for a global attribute, which
 * every tag accepts. The compiler writes this list next to each attribute of `<component is>`.
 */
export function tagsAccepting(name: string, tags: Iterable<string>): string[] | null {
  if (isGlobalAttribute(name)) return null;
  return [...tags].filter((tag) => ownAttributes(tag)?.has(name) ?? false);
}
