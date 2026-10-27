import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind, CodeLensRefreshRequest, createConnection, DiagnosticSeverity, DidChangeWatchedFilesNotification, RequestType, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver/node";
import type { Connection, Diagnostic, InitializeResult, Position, Range, SemanticTokens, TextDocumentIdentifier } from "vscode-languageserver/node";
import { projectRoot } from "../compiler/project-root.js";
import { checkFrameworkPageContracts } from "../framework/page-contracts-check.js";
import { componentDiagnostics, contractRange, frameworkContractRoot } from "./diagnostics.js";
import {
  codeActions, completionList, componentNameCompletion, definition, directiveNameCompletion, documentSymbols, shadowedTagsOf, foldingRanges, formatting, hover, prepareRename, references,
  rename, resolveCompletion, semanticTokens, semanticTokensLegend, signatureHelp,
} from "./features.js";
import type { CompletionData, FeatureContext, LocatedDocument, MeekoFormatSettings } from "./features.js";
import {
  classCompletion, classDefinition, colorPresentations, cssCompletion, cssHover, documentColors, htmlCompletion, htmlHover,
  linkedEditingRanges, styleDiagnostics, tagCompletion,
} from "./embedded.js";
import { codeLenses } from "./lenses.js";
import { createComponentActions, listItemActions, propsReadActions } from "./quick-fixes.js";
import { documentLinks, inlayHints, linkRouteCompletion, workspaceSymbols } from "./nav.js";
import { MeekoWorkspace, pathKey } from "./project.js";
import { executionZones } from "./zones.js";
import type { ExecutionZoneKind, ExecutionZoneReason } from "./zones.js";

/** A zone of `meeko/executionZones`: whole lines of a component and where they run. */
export interface ExecutionZoneItem {
  readonly kind: ExecutionZoneKind;
  readonly reason: ExecutionZoneReason;
  readonly range: Range;
  readonly label: string;
  readonly detail: string;
}

/**
 * `meeko/executionZones`: the lines of a `.meeko` that run only on the server (`<script server>`),
 * on both sides (the setup) and only in the browser (after the first browser `await` and inside
 * `onMounted`). It is computed statically, without a running app.
 */
/**
 * The closing tag that typing `>` or `</` completes in the template, as a snippet (`$0</div>`).
 * The VS Code extension asks for it after those keystrokes, like the HTML extension does.
 */
export const TagCompletionRequest = new RequestType<{ textDocument: TextDocumentIdentifier; position: Position }, string | null, void>("meeko/tagComplete");

export const ExecutionZonesRequest = new RequestType<{ textDocument: TextDocumentIdentifier }, { zones: ExecutionZoneItem[] } | null, void>("meeko/executionZones");

/** Opciones de inicialización que acepta el servidor (`initializationOptions`). */
export interface LanguageServerInitializationOptions {
  /**
   * `false` en workspaces no confiables: no se ejecuta la configuración del proyecto, se lee
   * su forma estática y no se comprueban los contratos de páginas. Por defecto es `true`.
   */
  readonly trusted?: boolean;
  /** Desactiva la comprobación de contratos de páginas al guardar. Por defecto está activa. */
  readonly projectContracts?: boolean;
  /** Espera en milisegundos antes de comprobar un documento editado. Por defecto 300. */
  readonly diagnosticsDelay?: number;
  /**
   * Opciones de formato para clientes sin `workspace/configuration`. Si el cliente la admite,
   * prevalece su sección `meeko.format`.
   */
  readonly format?: MeekoFormatSettings;
}

/** Normaliza la sección `meeko.format`; `undefined` si el cliente no la define. */
function formatSettingsOf(value: unknown): MeekoFormatSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const indent = (value as { indentSections?: unknown }).indentSections;
  return typeof indent === "boolean" ? { indentSections: indent } : undefined;
}

const transports = ["--stdio", "--node-ipc"];

function packageVersion(): string | undefined {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string };
        if (parsed.name === "@meekojs/meeko") return parsed.version;
      } catch { /* Keep looking upwards. */ }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try { return fileURLToPath(uri); }
  catch { return undefined; }
}

/**
 * Generated output (.meeko/) and dependencies never trigger checks; checks write there themselves.
 * The rule also holds relative to each workspace folder: a project reached through `node_modules`
 * (a package linked with `link:`, whose own temporary projects the editor's watcher reports) or
 * nested in a `.meeko/` directory (temporary projects of tools and tests) is not workspace code,
 * and checking its contracts would load its configuration and write into it.
 */
function ignoredChange(path: string, folders: readonly string[]): boolean {
  const parts = relative(projectRoot(path), path).split(/[\\/]/);
  if (parts.some((part) => part === "node_modules" || part === ".git") || parts[0] === ".meeko") return true;
  return folders.some((folder) => {
    const inner = relative(folder, path);
    if (!inner || inner === ".." || inner.startsWith(`..${sep}`) || isAbsolute(inner)) return false;
    const segments = inner.split(/[\\/]/);
    return segments.some((part) => part === "node_modules" || part === ".git") || segments.slice(0, -1).includes(".meeko");
  });
}

/** Registra los manejadores del servidor de lenguaje Meeko en una conexión LSP. */
export function startLanguageServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  let workspace = new MeekoWorkspace({ trusted: true });
  let contracts = true;
  let delay = 300;
  let semanticRefresh = false;
  let watchedRegistration = false;
  let configurationSupport = false;
  let codeLensRefresh = false;
  let deleteFiles = false;
  let createFiles = false;
  let formatFallback: MeekoFormatSettings = {};
  /** Workspace folders of the client, the reference of {@link ignoredChange}. */
  let folders: string[] = [];
  const log = (message: string): void => connection.console.log(message);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const openVersions = new Map<string, number>();
  const ownDiagnostics = new Map<string, Diagnostic[]>();
  const contractDiagnostics = new Map<string, Diagnostic[]>();
  /** Failures of `meeko.config.*` found by component checks, by the URI of the configuration file. */
  const configDiagnostics = new Map<string, Diagnostic[]>();
  /** URI under which each configuration file (by {@link pathKey}) has diagnostics. */
  const configUris = new Map<string, string>();
  const contractTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const contractVersions = new Map<string, number>();
  const contractRuns = new Map<string, Promise<void>>();
  const contractUris = new Map<string, Set<string>>();
  const semanticCache = new Map<string, { version: number; tokens: SemanticTokens }>();

  const openDocument = (filename: string): TextDocument | undefined => {
    const key = pathKey(filename);
    return documents.all().find((document) => {
      const path = uriToPath(document.uri);
      return path !== undefined && pathKey(path) === key;
    });
  };

  const locate = (filename: string): LocatedDocument | undefined => {
    const open = openDocument(filename);
    if (open) return { uri: open.uri, document: open };
    const text = ts.sys.readFile(filename);
    if (text === undefined) return undefined;
    const uri = pathToFileURL(filename).href;
    return { uri, document: TextDocument.create(uri, filename.endsWith(".meeko") ? "meeko" : "typescript", 0, text) };
  };

  let stopped = false;
  const publish = (uri: string): void => {
    if (stopped) return;
    connection.sendDiagnostics({ uri, diagnostics: [...(ownDiagnostics.get(uri) ?? []), ...(contractDiagnostics.get(uri) ?? []), ...(configDiagnostics.get(uri) ?? [])] })
      .catch((error: unknown) => log(`${uri}: no se pudieron publicar los diagnósticos: ${error instanceof Error ? error.message : String(error)}`));
  };

  /** Publishes a configuration failure on `meeko.config.*` itself, once; `[]` clears it. */
  const reportConfig = (filename: string, diagnostics: Diagnostic[]): void => {
    const key = pathKey(filename);
    const previous = configUris.get(key);
    if (!diagnostics.length) {
      if (previous === undefined) return;
      configUris.delete(key);
      configDiagnostics.delete(previous);
      publish(previous);
      return;
    }
    const uri = previous ?? locate(filename)?.uri ?? pathToFileURL(filename).href;
    if (JSON.stringify(configDiagnostics.get(uri)) === JSON.stringify(diagnostics)) return;
    configUris.set(key, uri);
    configDiagnostics.set(uri, diagnostics);
    publish(uri);
  };

  /** Runs a feature on an open component; `app` waits for the application index (routes, API, RPC). */
  async function withContext<T>(uri: string, run: (context: FeatureContext) => T | undefined, app = false): Promise<T | null> {
    const document = documents.get(uri);
    const filename = uriToPath(uri);
    if (!document || !filename?.endsWith(".meeko")) return null;
    const project = workspace.projectFor(filename);
    await project.ready();
    const component = project.setDocument(filename, document.getText());
    if (!component) return null;
    const index = app ? await project.appIndex() : undefined;
    try { return run({ project, component, document, locate, ...(index ? { app: index } : {}) }) ?? null; }
    catch (error) {
      log(`${filename}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return null;
    }
  }

  const scheduleCheck = (document: TextDocument): void => {
    const filename = uriToPath(document.uri);
    if (!filename?.endsWith(".meeko")) return;
    clearTimeout(timers.get(document.uri));
    const version = document.version;
    timers.set(document.uri, setTimeout(() => {
      timers.delete(document.uri);
      const project = workspace.projectFor(filename);
      project.setDocument(filename, document.getText());
      componentDiagnostics(project, document, filename, locate, reportConfig).then((found) => {
        if (documents.get(document.uri)?.version !== version) return;
        // CSS errors and unused classes of <style>: read from the text, also when the script fails.
        ownDiagnostics.set(document.uri, [...found, ...styleDiagnostics(document)]);
        publish(document.uri);
      }, (error: unknown) => log(`${filename}: ${error instanceof Error ? error.message : String(error)}`));
    }, delay));
  };

  /** Los contratos dependen de rutas y sidecars guardados; se comprueban fuera del ritmo de escritura. */
  const scheduleContractCheck = (root: string, trigger?: TextDocument): void => {
    if (!workspace.options.trusted || !contracts) return;
    const key = pathKey(root);
    clearTimeout(contractTimers.get(key));
    const version = (contractVersions.get(key) ?? 0) + 1;
    contractVersions.set(key, version);
    contractTimers.set(key, setTimeout(() => {
      contractTimers.delete(key);
      const previous = contractRuns.get(key) ?? Promise.resolve();
      const run = previous.then(async () => {
        if (contractVersions.get(key) !== version) return;
        const found = await checkFrameworkPageContracts(root);
        if (contractVersions.get(key) !== version) return;
        const grouped = new Map<string, Diagnostic[]>();
        for (const item of found) {
          const target = locate(item.filename);
          if (!target) continue;
          const [start, end] = contractRange(target.document.getText(), item.filename, item.offset);
          grouped.set(target.uri, [...(grouped.get(target.uri) ?? []), {
            range: { start: target.document.positionAt(start), end: target.document.positionAt(end) },
            message: item.message, code: item.code, source: "Meeko", severity: DiagnosticSeverity.Error,
          }]);
        }
        for (const uri of contractUris.get(key) ?? []) {
          if (!grouped.has(uri)) { contractDiagnostics.delete(uri); publish(uri); }
        }
        for (const [uri, items] of grouped) { contractDiagnostics.set(uri, items); publish(uri); }
        contractUris.set(key, new Set(grouped.keys()));
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log(`${root}: falló la comprobación de contratos del proyecto: ${message}`);
        if (trigger && documents.get(trigger.uri)) {
          contractDiagnostics.set(trigger.uri, [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: `Falló la comprobación de contratos del proyecto: ${message}`, code: "MEEK_PROJECT_CHECK", source: "Meeko", severity: DiagnosticSeverity.Error,
          }]);
          publish(trigger.uri);
        }
      });
      contractRuns.set(key, run);
      void run.finally(() => { if (contractRuns.get(key) === run) contractRuns.delete(key); });
    }, 450));
  };

  const contractRootOf = (document: TextDocument): string | undefined => {
    const filename = uriToPath(document.uri);
    return filename ? frameworkContractRoot(filename) : undefined;
  };

  connection.onInitialize((params): InitializeResult => {
    const options = (params.initializationOptions ?? {}) as LanguageServerInitializationOptions;
    workspace = new MeekoWorkspace({ trusted: options.trusted !== false, log });
    folders = (params.workspaceFolders?.map((folder) => folder.uri) ?? (params.rootUri ? [params.rootUri] : [])).flatMap((uri) => uriToPath(uri) ?? []);
    contracts = options.projectContracts !== false;
    if (typeof options.diagnosticsDelay === "number" && options.diagnosticsDelay >= 0) delay = options.diagnosticsDelay;
    semanticRefresh = params.capabilities.workspace?.semanticTokens?.refreshSupport === true;
    watchedRegistration = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    configurationSupport = params.capabilities.workspace?.configuration === true;
    codeLensRefresh = params.capabilities.workspace?.codeLens?.refreshSupport === true;
    const workspaceEdit = params.capabilities.workspace?.workspaceEdit;
    deleteFiles = workspaceEdit?.documentChanges === true && (workspaceEdit.resourceOperations ?? []).includes("delete");
    createFiles = workspaceEdit?.documentChanges === true && (workspaceEdit.resourceOperations ?? []).includes("create");
    formatFallback = formatSettingsOf(options.format) ?? {};
    const version = packageVersion();
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: { includeText: false } },
        completionProvider: { triggerCharacters: [".", ":", "<", "/", "\""], resolveProvider: true },
        linkedEditingRangeProvider: true,
        documentLinkProvider: { resolveProvider: false },
        workspaceSymbolProvider: true,
        inlayHintProvider: true,
        colorProvider: true,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        signatureHelpProvider: { triggerCharacters: ["(", ","], retriggerCharacters: [")"] },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        documentFormattingProvider: true,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite] },
        codeLensProvider: { resolveProvider: false },
        semanticTokensProvider: { legend: semanticTokensLegend, full: true },
      },
      serverInfo: { name: "meeko-language-server", ...(version ? { version } : {}) },
    };
  });

  connection.onInitialized(() => {
    if (!watchedRegistration) return;
    void connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [
        { globPattern: "**/*.{ts,mts,cts,meeko}" },
        { globPattern: "**/{tsconfig*.json,meeko.config.*}" },
        // Installing or removing a dependency changes where imports resolve (see MeekoProject).
        { globPattern: "**/{package.json,package-lock.json,pnpm-lock.yaml,yarn.lock,bun.lock}" },
      ],
    });
  });

  documents.onDidOpen(({ document }) => {
    openVersions.set(document.uri, document.version);
    const filename = uriToPath(document.uri);
    if (filename?.endsWith(".meeko")) workspace.projectFor(filename).setDocument(filename, document.getText());
    const root = contractRootOf(document);
    if (root) scheduleContractCheck(root, document);
  });

  documents.onDidChangeContent(({ document }) => {
    if (openVersions.get(document.uri) !== document.version && contractDiagnostics.delete(document.uri)) publish(document.uri);
    scheduleCheck(document);
  });

  documents.onDidSave(({ document }) => {
    scheduleCheck(document);
    const root = contractRootOf(document);
    if (root) scheduleContractCheck(root, document);
  });

  documents.onDidClose(({ document }) => {
    clearTimeout(timers.get(document.uri));
    timers.delete(document.uri);
    openVersions.delete(document.uri);
    semanticCache.delete(document.uri);
    const filename = uriToPath(document.uri);
    if (filename?.endsWith(".meeko")) workspace.projectFor(filename).closeDocument(filename);
    ownDiagnostics.delete(document.uri);
    publish(document.uri);
  });

  connection.onDidChangeWatchedFiles(({ changes }) => {
    const paths = changes.flatMap((change) => uriToPath(change.uri) ?? []).filter((path) => !ignoredChange(path, folders));
    if (!paths.length) return;
    // A changed configuration is checked again with the open components; none may be open.
    for (const path of paths) if (configUris.has(pathKey(path))) reportConfig(path, []);
    const projects = workspace.filesChanged(paths);
    if (!projects.length) return;
    const roots = new Set(projects.map((project) => pathKey(project.root)));
    semanticCache.clear();
    let contractDocument: TextDocument | undefined;
    for (const document of documents.all()) {
      const filename = uriToPath(document.uri);
      if (!filename?.endsWith(".meeko") || !roots.has(pathKey(workspace.projectFor(filename).root))) continue;
      scheduleCheck(document);
      if (!contractDocument && contractRootOf(document)) contractDocument = document;
    }
    const changedContract = paths.map(frameworkContractRoot).find((root) => root !== undefined);
    const contractRoot = changedContract ?? (contractDocument && contractRootOf(contractDocument));
    if (contractRoot) scheduleContractCheck(contractRoot, contractDocument);
    if (semanticRefresh) void connection.languages.semanticTokens.refresh();
    if (codeLensRefresh) void connection.sendRequest(CodeLensRefreshRequest.type).catch(() => undefined);
  });

  // Clients without workspace/configuration may push `{ meeko: { format: {...} } }` instead.
  connection.onDidChangeConfiguration(({ settings }) => {
    const pushed = formatSettingsOf((settings as { meeko?: { format?: unknown } } | null | undefined)?.meeko?.format);
    if (pushed) formatFallback = pushed;
  });

  /** Opciones `meeko.format` vigentes para un documento, pedidas al cliente en cada formateo. */
  const formatSettingsFor = async (uri: string): Promise<MeekoFormatSettings> => {
    if (!configurationSupport) return formatFallback;
    try {
      const value: unknown = await connection.workspace.getConfiguration({ scopeUri: uri, section: "meeko.format" });
      return formatSettingsOf(value) ?? formatFallback;
    } catch (error) {
      log(`${uri}: no se pudo leer meeko.format: ${error instanceof Error ? error.message : String(error)}`);
      return formatFallback;
    }
  };

  connection.onCompletion(async ({ textDocument, position, context: request }) => {
    // `<A` in the template: the component is usually unparsable while the tag is being typed.
    const document = documents.get(textDocument.uri);
    const filename = uriToPath(textDocument.uri);
    if (document && filename?.endsWith(".meeko")) {
      const project = workspace.projectFor(filename);
      await project.ready();
      const tags = componentNameCompletion(project, document, filename, position);
      if (tags) return tags;
      // `each:`, `if:when`, `bind:`… in a tag, also a component tag; the tag may not parse yet.
      const shadowed = shadowedTagsOf(project, document.getText());
      const directives = directiveNameCompletion(document, position, shadowed);
      if (directives) return directives;
      const classes = classCompletion(document, position);
      if (classes) return classes;
      const routes = linkRouteCompletion(document, position, await project.appIndex(), project.root, shadowed);
      if (routes) return routes;
    }
    const typed = await withContext(textDocument.uri, (context) => completionList(context, position, request?.triggerCharacter));
    if (typed || !document) return typed;
    // Outside TypeScript: HTML tags and attribute values of the template, and CSS of <style>.
    return htmlCompletion(document, position) ?? cssCompletion(document, position) ?? null;
  });
  connection.onCompletionResolve(async (item) => {
    const data = item.data as CompletionData | undefined;
    if (!data?.uri) return item;
    return await withContext(data.uri, (context) => resolveCompletion(context, item)) ?? item;
  });
  connection.onHover(async ({ textDocument, position }) => {
    const typed = await withContext(textDocument.uri, (context) => hover(context, position), true);
    const document = documents.get(textDocument.uri);
    if (typed || !document) return typed;
    return htmlHover(document, position) ?? cssHover(document, position) ?? null;
  });
  connection.onDefinition(async ({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    // A class in `class="…"` goes to its selectors in <style>.
    const classes = document && classDefinition(document, position);
    if (classes) return classes;
    return withContext(textDocument.uri, (context) => definition(context, position), true);
  });
  connection.onDocumentLinks(({ textDocument }) => withContext(textDocument.uri, (context) => documentLinks(context), true));
  connection.languages.inlayHint.on(({ textDocument, range }) => withContext(textDocument.uri, (context) => inlayHints(context, range)));
  connection.onWorkspaceSymbol(({ query }) => {
    // The projects of the open files, and those of the workspace folders before any file opens.
    for (const folder of folders) {
      if (existsSync(join(folder, "app", "pages")) || existsSync(join(folder, "meeko.config.ts"))) workspace.projectFor(join(folder, "app", "app.meeko"));
    }
    return workspaceSymbols(workspace.all(), query);
  });
  connection.languages.onLinkedEditingRange(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    const ranges = document && linkedEditingRanges(document, position);
    return ranges ? { ranges } : null;
  });
  connection.onRequest(TagCompletionRequest, ({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    return (document && tagCompletion(document, position)) ?? null;
  });
  connection.onDocumentColor(({ textDocument }) => {
    const document = documents.get(textDocument.uri);
    return document ? documentColors(document) : [];
  });
  connection.onColorPresentation(({ textDocument, color, range }) => {
    const document = documents.get(textDocument.uri);
    return document ? colorPresentations(document, color, range) : [];
  });
  connection.onReferences(({ textDocument, position, context: options }) =>
    withContext(textDocument.uri, (context) => references(context, position, options.includeDeclaration)));
  connection.onPrepareRename(({ textDocument, position }) => withContext(textDocument.uri, (context) => prepareRename(context, position)));
  connection.onRenameRequest(({ textDocument, position, newName }) => withContext(textDocument.uri, (context) => rename(context, position, newName)));
  connection.onSignatureHelp(({ textDocument, position }) => withContext(textDocument.uri, (context) => signatureHelp(context, position)));
  connection.onDocumentSymbol(({ textDocument }) => withContext(textDocument.uri, (context) => documentSymbols(context)));
  connection.onFoldingRanges(({ textDocument }) => withContext(textDocument.uri, (context) => foldingRanges(context)));
  connection.onDocumentFormatting(async ({ textDocument, options }) => {
    const settings = await formatSettingsFor(textDocument.uri);
    // formatting() never rejects: a file that does not compile yields no edits.
    return withContext(textDocument.uri, (context) => formatting(context, options, settings, { trusted: workspace.options.trusted !== false, log }));
  });
  connection.onCodeAction(async ({ textDocument, range, context: request }) => {
    const compiled = await withContext(textDocument.uri, (context) => [
      ...codeActions(context, range, request.diagnostics, { deleteFiles }, request.only),
      ...propsReadActions(context, request.diagnostics),
      ...createComponentActions(context, request.diagnostics, { createFiles }),
    ]);
    // A list without `each:as` does not compile: its fix works on the text.
    const document = documents.get(textDocument.uri);
    const actions = [...compiled ?? [], ...document ? listItemActions(document, request.diagnostics) : []];
    const only = request.only;
    return only?.length ? actions.filter((action) => action.kind !== undefined && only.some((kind) => action.kind === kind || action.kind!.startsWith(`${kind}.`))) : actions;
  });
  connection.onCodeLens(({ textDocument }) => withContext(textDocument.uri, (context) => codeLenses(context), true));
  connection.onRequest(ExecutionZonesRequest, ({ textDocument }) => withContext(textDocument.uri, (context) => ({
    zones: executionZones(context.component, context.project.sourceRoots()).map((zone): ExecutionZoneItem => ({
      kind: zone.kind,
      reason: zone.reason,
      label: zone.label,
      detail: zone.detail,
      range: {
        start: { line: zone.startLine, character: 0 },
        end: { line: zone.endLine, character: context.document.getText({ start: { line: zone.endLine, character: 0 }, end: { line: zone.endLine + 1, character: 0 } }).replace(/\r?\n$|\r$/, "").length },
      },
    })),
  })));
  connection.languages.semanticTokens.on(async ({ textDocument }) => {
    const empty: SemanticTokens = { data: [] };
    const document = documents.get(textDocument.uri);
    if (!document) return empty;
    const cached = semanticCache.get(textDocument.uri);
    if (cached && cached.version === document.version) return cached.tokens;
    const tokens = await withContext(textDocument.uri, (context) => semanticTokens(context));
    if (!tokens) return empty;
    if (documents.get(textDocument.uri)?.version === document.version) semanticCache.set(textDocument.uri, { version: document.version, tokens });
    return tokens;
  });

  connection.onShutdown(() => {
    stopped = true;
    for (const timer of [...timers.values(), ...contractTimers.values()]) clearTimeout(timer);
    timers.clear();
    contractTimers.clear();
    workspace.dispose();
  });

  documents.listen(connection);
}

/**
 * Arranca el servidor en el proceso actual. Acepta `--stdio` o `--node-ipc`, además de
 * `--socket=<puerto>` y `--pipe=<nombre>`.
 */
export function runLanguageServer(argv: readonly string[]): boolean {
  const transport = argv.find((argument) => transports.includes(argument) || argument.startsWith("--socket=") || argument.startsWith("--pipe="));
  if (!transport) {
    process.stderr.write("Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>\n");
    process.exitCode = 1;
    return false;
  }
  const connection = transport === "--stdio" ? createConnection(process.stdin, process.stdout) : createConnection();
  // stdout carries the protocol; route stray console output to the client log.
  console.log = (...values: unknown[]) => connection.console.log(values.map(String).join(" "));
  console.info = (...values: unknown[]) => connection.console.info(values.map(String).join(" "));
  console.warn = (...values: unknown[]) => connection.console.warn(values.map(String).join(" "));
  console.error = (...values: unknown[]) => connection.console.error(values.map(String).join(" "));
  console.debug = console.log;
  startLanguageServer(connection);
  connection.listen();
  return true;
}
