import type { AstPath, Doc, ParserOptions, Printer } from "prettier";
import { printers as estreePrinters } from "prettier/plugins/estree";

/** Nodo ESTree con lo que necesita la regla: posiciones, decoradores y elementos. */
interface ArrayLikeNode {
  readonly type: string;
  readonly range?: readonly [number, number];
  readonly start?: number;
  readonly end?: number;
  readonly decorators?: readonly ArrayLikeNode[];
  readonly elements?: ReadonlyArray<ArrayLikeNode | null>;
  readonly elementTypes?: ReadonlyArray<ArrayLikeNode | null>;
}

/** Arrays, patrones de desestructuración y tuplas de TypeScript (y de Flow, con `babel`). */
const arrayTypes = new Set(["ArrayExpression", "ArrayPattern", "TSTupleType", "TupleTypeAnnotation"]);

/** Posición inicial como la calcula Prettier (`range` de typescript-estree, `start` de Babel). */
function startOf(node: ArrayLikeNode): number | undefined {
  return node.range?.[0] ?? node.start;
}

function endOf(node: ArrayLikeNode): number | undefined {
  return node.range?.[1] ?? node.end;
}

/**
 * Posición del `[` que abre el array. Se salta los decoradores de un parámetro (`@Dec() [a]`), los
 * espacios y los comentarios; `undefined` si el texto no empieza por `[` (nunca se adivina).
 */
function openingBracket(node: ArrayLikeNode, text: string): number | undefined {
  let index = startOf(node);
  const lastDecorator = node.decorators?.at(-1);
  const decoratorsEnd = lastDecorator ? endOf(lastDecorator) : undefined;
  if (index === undefined) return undefined;
  if (decoratorsEnd !== undefined && decoratorsEnd > index) index = decoratorsEnd;
  while (index < text.length) {
    if (/\s/.test(text[index]!)) index += 1;
    else if (text.startsWith("//", index)) {
      const newline = text.indexOf("\n", index);
      index = newline < 0 ? text.length : newline + 1;
    } else if (text.startsWith("/*", index)) {
      const close = text.indexOf("*/", index + 2);
      if (close < 0) return undefined;
      index = close + 2;
    } else break;
  }
  return text[index] === "[" ? index : undefined;
}

/**
 * Regla de `meekoPreserveArrayBreaks`, la misma que `objectWrap: "preserve"` aplica a los objetos:
 * hay un salto de línea entre el `[` y el primer elemento no nulo, con los comentarios y los huecos
 * (`[, a]`) que haya entre ambos. Un array sin elementos no se fuerza.
 */
function hasBreakAfterOpeningBracket(node: ArrayLikeNode, text: string): boolean {
  const elements = node.type === "TSTupleType" || node.type === "TupleTypeAnnotation" ? node.elementTypes : node.elements;
  const first = elements?.find((element): element is ArrayLikeNode => element !== null && element !== undefined);
  const firstStart = first ? startOf(first) : undefined;
  if (firstStart === undefined) return false;
  const bracket = openingBracket(node, text);
  if (bracket === undefined || bracket >= firstStart) return false;
  return /[\n\r]/.test(text.slice(bracket + 1, firstStart));
}

type GroupDoc = Extract<Doc, { type: "group" }>;

/** El `group(["[", indent([...]), softline, "]"])` que imprime `printArray` de Prettier. */
function isBracketGroup(doc: GroupDoc): boolean {
  const { contents } = doc;
  return !doc.expandedStates && Array.isArray(contents) && contents[0] === "[" && contents.at(-1) === "]";
}

/**
 * Devuelve el doc con el grupo de los corchetes roto, o `undefined` si no lo encuentra. Recorre
 * sólo concatenaciones y etiquetas (los paréntesis, `?` y la anotación de tipo que el printer
 * añade alrededor) y nunca entra en grupos ajenos: los de los elementos son de otros nodos y ya
 * pasaron por esta regla. En un parámetro decorado (`decorated`) entra sólo en la última parte
 * del grupo que une decoradores y nodo; un array de los argumentos del decorador nunca se toca.
 */
function breakBracketGroup(doc: Doc, decorated: boolean): Doc | undefined {
  if (Array.isArray(doc)) {
    for (const [index, item] of doc.entries()) {
      const broken = breakBracketGroup(item as Doc, decorated);
      if (broken === undefined) continue;
      if (broken === item) return doc;
      const copy = [...doc];
      copy[index] = broken;
      return copy;
    }
    return undefined;
  }
  if (typeof doc !== "object" || doc === null) return undefined;
  if (doc.type === "label") {
    const broken = breakBracketGroup(doc.contents, decorated);
    return broken === undefined ? undefined : broken === doc.contents ? doc : { ...doc, contents: broken };
  }
  if (doc.type !== "group") return undefined;
  if (isBracketGroup(doc)) return doc.break === true ? doc : { ...doc, break: true };
  // A decorated parameter is printed as `group([decorators, node])`: only the last part is the node.
  const { contents } = doc;
  if (!decorated || doc.expandedStates || !Array.isArray(contents) || contents.length < 2) return undefined;
  const last = contents.at(-1) as Doc;
  const broken = breakBracketGroup(last, false);
  return broken === undefined ? undefined : broken === last ? doc : { ...doc, contents: [...contents.slice(0, -1), broken] };
}

/** Opciones que lee el printer; la opción vale `true` salvo que se desactive. */
type ArrayBreakOptions = ParserOptions & { meekoPreserveArrayBreaks?: boolean };

type CommentHandler = (...args: unknown[]) => boolean;

/** Miembros del printer `estree` que delega el de Meeko; todos son opcionales salvo `print`. */
interface EstreePrinter {
  readonly features?: object;
  readonly preprocess?: (ast: unknown, options: ParserOptions) => unknown;
  readonly print: (path: AstPath, options: ParserOptions, print: unknown, args?: unknown) => Doc;
  readonly embed?: (path: AstPath, options: ParserOptions) => unknown;
  readonly insertPragma?: (text: string) => string;
  readonly massageAstNode?: (original: unknown, cloned: unknown, parent: unknown) => unknown;
  readonly hasPrettierIgnore?: (path: AstPath) => boolean;
  readonly canAttachComment?: (node: unknown, ancestors?: unknown) => boolean;
  readonly isBlockComment?: (comment: unknown) => boolean;
  readonly handleComments?: Partial<Record<"ownLine" | "endOfLine" | "remaining", CommentHandler>>;
  readonly getCommentChildNodes?: (node: unknown, options: ParserOptions) => unknown;
  readonly printComment?: (path: AstPath, options: ParserOptions) => Doc;
  readonly isGap?: (text: string, options: ParserOptions) => boolean | undefined;
  readonly willPrintOwnComments?: (path: AstPath, options: ParserOptions) => boolean;
  readonly printPrettierIgnored?: (path: AstPath, options: ParserOptions, print: unknown, args?: unknown) => Doc;
  readonly getVisitorKeys?: (node: unknown, nonTraversableKeys: unknown) => readonly string[];
}

/** Marca del printer de Meeko, para no delegar en sí mismo ni en otra copia de Meeko cargada. */
const ownMarker = Symbol.for("meeko.prettier.estree");
/** Printer `estree` del Prettier del que depende Meeko: sólo se usa si el Prettier que ejecuta el plugin no trae otro. */
const bundledPrinter = estreePrinters.estree as unknown as EstreePrinter;

/** Una entrada `printers.estree`: el printer o, en los plugins internos de Prettier 3, una función que lo carga. */
type PrinterEntry = EstreePrinter | (() => Promise<EstreePrinter>);
interface PluginLike { readonly printers?: Record<string, PrinterEntry | undefined> }

/** Printers ya cargados de las entradas perezosas. */
const loadedEntries = new WeakMap<object, EstreePrinter>();
/** Printer del host de cada formateo, por su objeto de opciones y por la raíz de su AST. */
const hostByOptions = new WeakMap<object, EstreePrinter>();
const hostByRoot = new WeakMap<object, EstreePrinter>();
/**
 * Printer del host del último formateo. Prettier llama a `canAttachComment`, `isBlockComment` y
 * `getVisitorKeys` sin opciones, y antes de `preprocess`, el primer gancho asíncrono que las recibe.
 */
let recentHost: EstreePrinter | undefined;

function isOwn(entry: PrinterEntry): boolean {
  return (entry as { [ownMarker]?: boolean })[ownMarker] === true;
}

/**
 * La entrada `estree` del último plugin de `options.plugins` que la define, sin contar la de Meeko:
 * la del Prettier que ejecuta el plugin o la de un plugin anterior a Meeko que la sustituya.
 */
function hostEntry(options: ParserOptions): PrinterEntry | undefined {
  const plugins = (options as { plugins?: unknown[] }).plugins ?? [];
  for (let index = plugins.length - 1; index >= 0; index -= 1) {
    const plugin = plugins[index] as PluginLike | null;
    if (!plugin || typeof plugin !== "object" || !plugin.printers || !Object.hasOwn(plugin.printers, "estree")) continue;
    const entry = plugin.printers.estree;
    if (entry && !isOwn(entry)) return entry;
  }
  return undefined;
}

/** El printer del host si se conoce sin esperar; `undefined` mientras su entrada perezosa no se ha cargado. */
function knownHost(options: ParserOptions): EstreePrinter | undefined {
  const cached = hostByOptions.get(options);
  if (cached) return cached;
  // Not the options of a format (`getCommentChildNodes` receives those of the comment traversal).
  if (!Array.isArray((options as { plugins?: unknown }).plugins)) return undefined;
  const entry = hostEntry(options);
  if (!entry) return bundledPrinter;
  return typeof entry === "function" ? loadedEntries.get(entry) : entry;
}

/** Carga el printer del host de un formateo; sin otro printer `estree` en `options.plugins`, el de Meeko. */
async function loadHost(options: ParserOptions): Promise<EstreePrinter> {
  let host = knownHost(options);
  if (!host) {
    const entry = hostEntry(options);
    if (typeof entry === "function") {
      host = await entry();
      loadedEntries.set(entry, host);
    } else host = entry ?? bundledPrinter;
  }
  hostByOptions.set(options, host);
  recentHost = host;
  return host;
}

const withOptions = (options: ParserOptions): EstreePrinter => knownHost(options) ?? recentHost ?? bundledPrinter;
const withoutOptions = (): EstreePrinter => recentHost ?? bundledPrinter;
const ofPath = (path: AstPath): EstreePrinter => hostByRoot.get(path.stack[0] as object) ?? withoutOptions();

/**
 * Llama al manejador de comentarios del host con los argumentos que recibe: `(comment, text,
 * options, ast, isLastComment)` o, con `experimental_avoidAstMutation`, un contexto con `options`.
 */
function commentHandler(placement: "ownLine" | "endOfLine" | "remaining", args: readonly unknown[]): boolean {
  const options = (args.length === 1 ? (args[0] as { options?: ParserOptions } | undefined)?.options : args[2]) as ParserOptions | undefined;
  const host = options && typeof options === "object" ? withOptions(options) : withoutOptions();
  return host.handleComments?.[placement]?.(...(args as [unknown, string, ParserOptions])) ?? false;
}

/**
 * Printer `estree` con la regla de `meekoPreserveArrayBreaks`. Delega todo, en tiempo de ejecución,
 * en el printer `estree` del Prettier que ejecuta el plugin (el del último plugin de
 * `options.plugins` que lo define, sin contar el de Meeko) y sólo rompe el grupo de corchetes de un
 * array cuyo código fuente salta de línea tras `[`. Así un proyecto con otra versión 3.x de
 * Prettier imprime con la suya, y con `meekoPreserveArrayBreaks: false` la salida es la de su
 * Prettier. Sólo un Prettier sin printer `estree` propio usa el del Prettier de Meeko.
 */
export const preserveArrayBreaksPrinter = {
  [ownMarker]: true,
  // Prettier reads `features` once per printer object, before any options exist.
  ...(bundledPrinter.features ? { features: bundledPrinter.features } : {}),
  async preprocess(ast: unknown, options: ParserOptions) {
    const host = await loadHost(options);
    const result = host.preprocess ? await host.preprocess(ast, options) : ast;
    if (result && typeof result === "object") hostByRoot.set(result, host);
    return result;
  },
  print(path: AstPath, options: ParserOptions, print: unknown, args?: unknown): Doc {
    const doc = withOptions(options).print(path, options, print, args);
    const node = path.node as ArrayLikeNode | null | undefined;
    if (!node || !arrayTypes.has(node.type) || (options as ArrayBreakOptions).meekoPreserveArrayBreaks === false) return doc;
    if (!hasBreakAfterOpeningBracket(node, options.originalText)) return doc;
    return breakBracketGroup(doc, Boolean(node.decorators?.length)) ?? doc;
  },
  embed(path: AstPath, options: ParserOptions) {
    return withOptions(options).embed?.(path, options);
  },
  insertPragma(text: string): string {
    const host = withoutOptions();
    return host.insertPragma ? host.insertPragma(text) : text;
  },
  massageAstNode(original: unknown, cloned: unknown, parent: unknown) {
    return withoutOptions().massageAstNode?.(original, cloned, parent);
  },
  hasPrettierIgnore(path: AstPath): boolean {
    return ofPath(path).hasPrettierIgnore?.(path) ?? false;
  },
  canAttachComment(node: unknown, ancestors?: unknown): boolean {
    return withoutOptions().canAttachComment?.(node, ancestors) ?? false;
  },
  isBlockComment(comment: unknown): boolean {
    return withoutOptions().isBlockComment?.(comment) ?? false;
  },
  handleComments: {
    ownLine: (...args: unknown[]) => commentHandler("ownLine", args),
    endOfLine: (...args: unknown[]) => commentHandler("endOfLine", args),
    remaining: (...args: unknown[]) => commentHandler("remaining", args),
  },
  getCommentChildNodes(node: unknown, options: ParserOptions) {
    return withOptions(options).getCommentChildNodes?.(node, options);
  },
  printComment(path: AstPath, options: ParserOptions): Doc {
    const host = withOptions(options);
    return host.printComment ? host.printComment(path, options) : bundledPrinter.printComment!(path, options);
  },
  isGap(text: string, options: ParserOptions): boolean | undefined {
    return withOptions(options).isGap?.(text, options);
  },
  willPrintOwnComments(path: AstPath, options: ParserOptions): boolean {
    return withOptions(options).willPrintOwnComments?.(path, options) ?? false;
  },
  printPrettierIgnored(path: AstPath, options: ParserOptions, print: unknown, args?: unknown): Doc {
    const host = withOptions(options);
    if (host.printPrettierIgnored) return host.printPrettierIgnored(path, options, print, args);
    return options.originalText.slice(options.locStart(path.node), options.locEnd(path.node));
  },
  getVisitorKeys(node: unknown, nonTraversableKeys: unknown): readonly string[] {
    return (withoutOptions().getVisitorKeys ?? bundledPrinter.getVisitorKeys!)(node, nonTraversableKeys);
  },
} as unknown as Printer;
