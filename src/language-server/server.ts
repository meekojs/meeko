import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind, createConnection, DiagnosticSeverity, DidChangeWatchedFilesNotification, TextDocuments, TextDocumentSyncKind,
} from "vscode-languageserver/node";
import type { Connection, Diagnostic, InitializeResult, SemanticTokens } from "vscode-languageserver/node";
import { projectRoot } from "../compiler/project-root.js";
import { checkFrameworkPageContracts } from "../framework/page-contracts-check.js";
import { componentDiagnostics, contractRange, frameworkContractRoot } from "./diagnostics.js";
import {
  codeActions, completion, definition, documentSymbols, foldingRanges, formatting, hover, prepareRename, references,
  rename, resolveCompletion, semanticTokens, semanticTokensLegend, signatureHelp,
} from "./features.js";
import type { CompletionData, FeatureContext, LocatedDocument } from "./features.js";
import { MeekoWorkspace, pathKey } from "./project.js";

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

/** Generated output (.meeko/) and dependencies never trigger checks; checks write there themselves. */
function ignoredChange(path: string): boolean {
  const parts = relative(projectRoot(path), path).split(/[\\/]/);
  return parts.some((part) => part === "node_modules" || part === ".git") || parts[0] === ".meeko";
}

/** Registra los manejadores del servidor de lenguaje Meeko en una conexión LSP. */
export function startLanguageServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  let workspace = new MeekoWorkspace({ trusted: true });
  let contracts = true;
  let delay = 300;
  let semanticRefresh = false;
  let watchedRegistration = false;
  const log = (message: string): void => connection.console.log(message);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const openVersions = new Map<string, number>();
  const ownDiagnostics = new Map<string, Diagnostic[]>();
  const contractDiagnostics = new Map<string, Diagnostic[]>();
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
    connection.sendDiagnostics({ uri, diagnostics: [...(ownDiagnostics.get(uri) ?? []), ...(contractDiagnostics.get(uri) ?? [])] })
      .catch((error: unknown) => log(`${uri}: cannot publish diagnostics: ${error instanceof Error ? error.message : String(error)}`));
  };

  async function withContext<T>(uri: string, run: (context: FeatureContext) => T | undefined): Promise<T | null> {
    const document = documents.get(uri);
    const filename = uriToPath(uri);
    if (!document || !filename?.endsWith(".meeko")) return null;
    const project = workspace.projectFor(filename);
    await project.ready();
    const component = project.setDocument(filename, document.getText());
    if (!component) return null;
    try { return run({ project, component, document, locate }) ?? null; }
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
      componentDiagnostics(project, document, filename, locate).then((found) => {
        if (documents.get(document.uri)?.version !== version) return;
        ownDiagnostics.set(document.uri, found);
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
        log(`${root}: project contract check failed: ${message}`);
        if (trigger && documents.get(trigger.uri)) {
          contractDiagnostics.set(trigger.uri, [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: `Project contract check failed: ${message}`, code: "MEEK_PROJECT_CHECK", source: "Meeko", severity: DiagnosticSeverity.Error,
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
    contracts = options.projectContracts !== false;
    if (typeof options.diagnosticsDelay === "number" && options.diagnosticsDelay >= 0) delay = options.diagnosticsDelay;
    semanticRefresh = params.capabilities.workspace?.semanticTokens?.refreshSupport === true;
    watchedRegistration = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    const version = packageVersion();
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: { includeText: false } },
        completionProvider: { triggerCharacters: [".", ":"], resolveProvider: true },
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        signatureHelpProvider: { triggerCharacters: ["(", ","], retriggerCharacters: [")"] },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        documentFormattingProvider: true,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
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
    const paths = changes.flatMap((change) => uriToPath(change.uri) ?? []).filter((path) => !ignoredChange(path));
    if (!paths.length) return;
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
  });

  connection.onCompletion(({ textDocument, position }) => withContext(textDocument.uri, (context) => completion(context, position)));
  connection.onCompletionResolve(async (item) => {
    const data = item.data as CompletionData | undefined;
    if (!data?.uri) return item;
    return await withContext(data.uri, (context) => resolveCompletion(context, item)) ?? item;
  });
  connection.onHover(({ textDocument, position }) => withContext(textDocument.uri, (context) => hover(context, position)));
  connection.onDefinition(({ textDocument, position }) => withContext(textDocument.uri, (context) => definition(context, position)));
  connection.onReferences(({ textDocument, position, context: options }) =>
    withContext(textDocument.uri, (context) => references(context, position, options.includeDeclaration)));
  connection.onPrepareRename(({ textDocument, position }) => withContext(textDocument.uri, (context) => prepareRename(context, position)));
  connection.onRenameRequest(({ textDocument, position, newName }) => withContext(textDocument.uri, (context) => rename(context, position, newName)));
  connection.onSignatureHelp(({ textDocument, position }) => withContext(textDocument.uri, (context) => signatureHelp(context, position)));
  connection.onDocumentSymbol(({ textDocument }) => withContext(textDocument.uri, (context) => documentSymbols(context)));
  connection.onFoldingRanges(({ textDocument }) => withContext(textDocument.uri, (context) => foldingRanges(context)));
  connection.onDocumentFormatting(({ textDocument, options }) => withContext(textDocument.uri, (context) => formatting(context, options)));
  connection.onCodeAction(({ textDocument, range, context: request }) =>
    withContext(textDocument.uri, (context) => codeActions(context, range, request.diagnostics)));
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
    process.stderr.write("Usage: meeko lsp --stdio | --node-ipc | --socket=<port> | --pipe=<name>\n");
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
