#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import { checkSource } from "./check.js";
import { compile } from "./compiler.js";
import { projectRoot } from "./compiler/project-root.js";
import { loadMeekoConfig } from "./framework/config.js";
import { setModuleDevelopmentMode, warnLegacyLayerEntries } from "./framework/module-loader.js";
import { generateTypes } from "./types.js";
import { initProject } from "./init.js";
import { initFrameworkProject } from "./framework/init.js";
import { checkApp } from "./framework/check-app.js";
import { prerenderProject } from "./framework/prerender.js";
import { assertBuildAdapter, buildProject, developmentServerPorts, prepareProject, previewProject, startProject, stopDevelopmentServer } from "./framework/project.js";
import { prepareFrameworkTypeDeclarations } from "./framework/type-declarations.js";
import { claimDevelopmentProject } from "./framework/dev-lock.js";
import { findLinkedMeeko, isSupervisedDevelopment, linkWatchEnabled, runSupervisedDevelopment, superviseDevelopment, warnLinkedMeekoRebuilds } from "./framework/dev-link.js";
import { checkFrameworkProject, loadCheckedMeekoConfig, prepareFrameworkTypes } from "./framework/check-project.js";
import { cleanProject, formatCleanResult } from "./framework/clean.js";
import { loadProjectEnv } from "./framework/env-file.js";
import { formatDiagnostic, hasErrors } from "./compiler/sfc.js";
import type { CompileDiagnostic } from "./compiler/sfc.js";

const usage = "Uso: meeko dev [directorio]\n     meeko check [directorio | componente.meeko] [--json]\n     meeko build [directorio] [--adapter <node|cloudflare|deno|bun|static>]\n     meeko start [directorio]\n     meeko preview [directorio] [--adapter <node|cloudflare|bun|deno|static>]\n     meeko clean [directorio] [--all] [--dry-run]\n     meeko auth hash  (pide una contraseña sin mostrarla, o la lee de stdin, e imprime su hash)\n     meeko check-app <directorio>\n     meeko compile <componente.meeko> <salida.ts>\n     meeko types <componente.meeko>\n     meeko routes <directorio>\n     meeko prerender <directorio>\n     meeko init <directorio>\n     meeko init-framework <directorio>\n     meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>\n     meeko <comando> --help  (la ayuda de un comando)\n     meeko --help | --version\n\n" +
  "Variables de entorno:\n" +
  "     MEEKO_PORT, MEEKO_HOST  puerto y dirección de dev, start y preview; sustituyen a server.port y\n" +
  "                      server.host de meeko.config.ts (por defecto, 127.0.0.1:4173; preview\n" +
  "                      de cloudflare se los pasa a wrangler dev). PORT sigue valiendo\n" +
  "     MEEKO_PUBLIC_ORIGIN  origen público de dev, start y preview para las comprobaciones de\n" +
  "                      Origin de HTTP y Socket tras un proxy\n" +
  "     MEEKO_REDIS_URL  Redis de las sesiones en producción si server/runtime.ts no las declara\n" +
  "     MEEKO_TRUST_PROXY  proxies de confianza para X-Forwarded-For (un número o true)\n" +
  "     MEEKO_HMR_PORT   puerto del WebSocket de HMR de dev\n" +
  "     MEEKO_EDITOR_BRIDGE=0  desactiva el puente con el editor de dev\n" +
  "     MEEKO_LINK_WATCH=0     dev no se reinicia al reconstruir un @meekojs/meeko enlazado (avisa)\n" +
  "     HOST y PUBLIC_ORIGIN están obsoletas: usa MEEKO_HOST y MEEKO_PUBLIC_ORIGIN\n" +
  "dev, build, start, preview y check leen el .env del proyecto; el entorno real tiene prioridad.\n";
/** Help of each command: `meeko <command> --help` or `meeko help <command>`. */
const commandHelp: Readonly<Record<string, string>> = {
  dev: "Uso: meeko dev [directorio]\n\nArranca el servidor de desarrollo con Vite, SSR y HMR. Antes de escuchar prepara .meeko/\n(entradas, tipos y tsconfig.*.json). Por defecto, el directorio actual. Avisa si otro meeko dev\nya sirve el mismo proyecto.\n",
  check: "Uso: meeko check [directorio | componente.meeko] [--json]\n\nCon un directorio (por defecto, el actual), prepara .meeko/, comprueba los componentes .meeko y\nejecuta TypeScript sobre los proyectos app, server y shared. Con un componente, sólo lo comprueba\na él; --json imprime sus diagnósticos en JSON.\n",
  build: "Uso: meeko build [directorio] [--adapter <node|cloudflare|deno|bun|static>]\n\nComprueba el proyecto como meeko check y escribe la salida de producción en\n.meeko/output/<adaptador>/. --adapter sustituye a server.adapter de meeko.config.ts.\n",
  start: "Uso: meeko start [directorio]\n\nSirve el build de Node de .meeko/output/node; ejecute antes meeko build.\n",
  preview: "Uso: meeko preview [directorio] [--adapter <node|cloudflare|bun|deno|static>]\n\nEjecuta la salida de meeko build en su runtime: Node en este proceso; Bun, Deno y wrangler dev\ncomo proceso hijo; static con un servidor de archivos.\n",
  clean: "Uso: meeko clean [directorio] [--all] [--dry-run]\n\nBorra .meeko/ y la caché de Vite (node_modules/.vite). --all borra node_modules entero; --dry-run\nsólo mide lo que se borraría.\n",
  auth: "Uso: meeko auth hash\n\nPide una contraseña sin mostrarla (dos veces) o la lee de stdin, e imprime su hash. Sólo el hash\nva a la salida estándar.\n",
  "check-app": "Uso: meeko check-app <directorio>\n\nComprueba los componentes .meeko de la aplicación y de sus layers, sin preparar .meeko/ ni\nejecutar TypeScript sobre los .ts. Un directorio que no existe es un error.\n",
  compile: "Uso: meeko compile <componente.meeko> <salida.ts>\n\nComprueba un componente y lo compila a un módulo TypeScript.\n",
  types: "Uso: meeko types <componente.meeko>\n\nEscribe en .meeko/types/ la declaración del componente y de los .meeko que importa.\n",
  routes: "Uso: meeko routes <directorio>\n\nPrepara .meeko/ como meeko check (rutas, contratos, componentes, autoimports, services.d.ts y\ntsconfig.*.json), sin ejecutar TypeScript, e imprime los archivos escritos.\n",
  prerender: "Uso: meeko prerender <directorio>\n\nVuelve a prerenderizar las rutas render: \"prerender\" sobre el build de Node; ejecute antes\nmeeko build.\n",
  init: "Uso: meeko init <directorio>\n\nCrea un proyecto SSR independiente (un componente, su servidor de Node y Vite). El directorio\npuede no existir, estar vacío o tener sólo package.json, lockfiles, node_modules, .npmrc o .git.\n",
  "init-framework": "Uso: meeko init-framework <directorio>\n\nCrea una aplicación full-stack de Meeko. El directorio puede no existir, estar vacío o tener\nsólo package.json, lockfiles, node_modules, .npmrc o .git.\n",
  lsp: "Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>\n\nArranca el servidor de lenguaje de los componentes .meeko con el transporte indicado; lo lanza\nel editor.\n",
};

/**
 * The path with the letter case of the files on disk. On Windows and macOS `app.meeko` opens
 * `App.meeko`, and the declaration and the generated names would take the typed case.
 */
function diskCase(path: string): string {
  // Only the segments as written: a relative path stays relative, and an exact one is returned as is.
  const { root } = parse(path);
  let directory = root ? resolve(root) : process.cwd();
  let changed = false;
  const parts: string[] = [];
  for (const part of path.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    let name = part;
    if (part !== "." && part !== "..") {
      try {
        const entries = readdirSync(directory);
        if (!entries.includes(part)) name = entries.find((entry) => entry.toLowerCase() === part.toLowerCase()) ?? part;
      } catch { /* Unreadable: keep the rest as typed. */ }
    }
    changed ||= name !== part;
    parts.push(name);
    directory = resolve(directory, name);
  }
  return changed ? join(root, ...parts) : path;
}

/** A path as written, followed by its absolute form when it is relative. */
function withAbsolute(path: string): string {
  return resolve(path) === path ? path : `${path} (${resolve(path)})`;
}

/** Fails with a clear message when the project directory of a command does not exist. */
async function assertDirectory(path: string): Promise<void> {
  const found = await stat(path).catch(() => undefined);
  if (!found) throw new Error(`No existe el directorio ${withAbsolute(path)}`);
  if (!found.isDirectory()) throw new Error(`${path} no es un directorio`);
}

/** Reads a component, naming a missing file in Spanish. */
async function readComponent(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`No existe el archivo ${withAbsolute(path)}`, { cause: error });
    if (code === "EISDIR") throw new Error(`${path} es un directorio, no un componente .meeko`, { cause: error });
    throw error;
  }
}

/** Prints the diagnostics on stderr, warnings included. */
function writeDiagnostics(diagnostics: readonly CompileDiagnostic[]): void {
  for (const diagnostic of diagnostics) process.stderr.write(`${formatDiagnostic(diagnostic)}\n`);
}
const argv = process.argv.slice(2);
/** First problem with the command line, reported before the usage. */
let problem: string | undefined;
// `meeko <command> --help` (or `-h`), and `meeko help <command>`: that command's help, nothing else.
const helpOf = argv[0] !== undefined && Object.hasOwn(commandHelp, argv[0]) && argv.slice(1).some((argument) => argument === "--help" || argument === "-h")
  ? argv[0]
  : (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") && argv.length === 2 && Object.hasOwn(commandHelp, argv[1]!) ? argv[1] : undefined;
if (helpOf !== undefined) argv.splice(0, argv.length, "--help");
// `meeko build` and `meeko preview` accept `--adapter <name>` or `--adapter=<name>` anywhere after the command.
let adapter: string | undefined;
if (argv[0] === "build" || argv[0] === "preview") {
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument !== "--adapter" && !argument.startsWith("--adapter=")) continue;
    const value = argument === "--adapter" ? argv[index + 1] : argument.slice("--adapter=".length);
    if (!value || value.startsWith("-")) problem ??= `Falta el nombre del adaptador en --adapter de ${argv[0]}`;
    else if (adapter !== undefined) problem ??= `--adapter aparece más de una vez en ${argv[0]}`;
    else adapter = value;
    argv.splice(index, argument === "--adapter" && value && !value.startsWith("-") ? 2 : 1);
    index--;
  }
}
// `meeko clean` accepts `--all` and `--dry-run` anywhere after the command.
let cleanAll = false;
let cleanDryRun = false;
if (argv[0] === "clean") {
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--all") cleanAll = true;
    else if (argument === "--dry-run") cleanDryRun = true;
    else continue;
    argv.splice(index, 1);
    index--;
  }
}
const [command, input, output] = argv;
const projectCommand = command === "dev" || command === "build" || command === "start" || command === "preview";
const legacyCommand = command === "compile" || command === "check-app" || command === "types" || command === "init" || command === "init-framework" || command === "routes" || command === "prerender";
const helpCommand = command === "--help" || command === "-h" || command === "help";
const versionCommand = command === "--version" || command === "-v";
if (command !== "lsp" && !helpCommand && !versionCommand) {
  if (command === undefined) problem ??= "Falta el comando";
  else if (!projectCommand && !legacyCommand && command !== "check" && command !== "clean" && command !== "auth") problem ??= `Comando desconocido: ${command}`;
  if (command === "auth" && input !== "hash") problem ??= input === undefined ? "Falta el subcomando de auth: meeko auth hash" : `Subcomando desconocido de auth: ${input}`;
  // `check` accepts `--json` after the component; every other option was consumed above.
  const option = argv.slice(1).find((argument, index) => argument.startsWith("-") && !(command === "check" && argument === "--json" && index === 1));
  if (option !== undefined) problem ??= command === "check" && option === "--json" ? "--json va después del componente .meeko de check" : `Opción desconocida para ${command}: ${option}`;
  if (!projectCommand && command !== "check" && command !== "clean" && command !== "auth" && !input) problem ??= `Falta ${command === "compile" || command === "types" ? "el componente .meeko" : "el directorio"} de ${command}`;
  if (command === "compile" && !output) problem ??= "Falta el archivo de salida de compile";
  const extra = argv[command === "compile" || (command === "check" && output === "--json") ? 3 : 2];
  if (extra !== undefined) problem ??= `Argumento de más para ${command}: ${extra}`;
} else if ((helpCommand || versionCommand) && input !== undefined) {
  problem = `Argumento de más para ${command}: ${input}`;
}
if (problem !== undefined) {
  process.stderr.write(`${problem}\n\n${usage}`);
  process.exitCode = 1;
} else if (helpCommand) {
  process.stdout.write(helpOf === undefined ? usage : commandHelp[helpOf]!);
} else if (versionCommand) {
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  process.stdout.write(`${metadata.version}\n`);
} else if (command === "lsp") {
  const { runLanguageServer } = await import("./language-server/server.js");
  runLanguageServer(process.argv.slice(3));
} else {
  try {
    if (projectCommand) {
      const root = input ?? ".";
      await assertDirectory(root);
      // Before anything reads the environment: PORT, MEEKO_LINK_WATCH or the app's own variables.
      loadProjectEnv(root);
      if (command === "dev") {
        // A linked Meeko (pnpm link:, npm link, a workspace) is rebuilt while dev runs: a
        // supervisor restarts the server in a fresh process, which loads the new build.
        const supervised = isSupervisedDevelopment();
        const linked = supervised ? undefined : findLinkedMeeko(resolve(root));
        const start = async () => {
          // Before .meeko/ is rewritten: another dev of this project would reload on those writes.
          claimDevelopmentProject(root);
          // Modules run once in this process, already in development mode for the types prepared below.
          setModuleDevelopmentMode(true);
          warnLegacyLayerEntries(root, await loadCheckedMeekoConfig(root));
          await prepareFrameworkTypes(root);
          return startProject(root, false);
        };
        if (linked && linkWatchEnabled()) process.exitCode = await superviseDevelopment(linked);
        else if (supervised) await runSupervisedDevelopment(start, stopDevelopmentServer, developmentServerPorts);
        else {
          // Without a supervisor the server keeps the build it loaded: each rebuild is reported.
          if (linked) warnLinkedMeekoRebuilds(linked);
          await start();
        }
      }
      else if (command === "start") await startProject(root, true);
      // Preview runs the output in its runtime: Node in this process; Bun, Deno and wrangler dev as a child.
      else if (command === "preview") await previewProject(root, adapter === undefined ? undefined : assertBuildAdapter(adapter));
      else {
        const requested = adapter === undefined ? undefined : assertBuildAdapter(adapter);
        warnLegacyLayerEntries(root, await loadCheckedMeekoConfig(root));
        writeDiagnostics(await checkFrameworkProject(root));
        const result = await buildProject(root, requested === undefined ? {} : { adapter: requested });
        process.stdout.write(`${result.output}\n`);
      }
    } else if (command === "auth") {
      // Only the hash goes to stdout, so `meeko auth hash >> .env` or a pipe gets a clean line.
      const { promptPassword } = await import("./password-prompt.js");
      const { hashPassword } = await import("./password.js");
      const password = await promptPassword(process.stdin, process.stderr);
      process.stdout.write(`${await hashPassword(password)}\n`);
    } else if (command === "clean") {
      const result = await cleanProject(input ?? ".", { all: cleanAll, dryRun: cleanDryRun });
      const report = formatCleanResult(result);
      process.stdout.write(report.stdout);
      process.stderr.write(report.stderr);
      if (result.failures.length > 0) process.exitCode = 1;
    } else if (command === "check" && (!input || (await stat(input).catch(() => undefined))?.isDirectory() || !input.endsWith(".meeko"))) {
      if (input) await assertDirectory(input);
      if (output) throw new Error("--json sólo está disponible para un componente .meeko");
      // meeko.config.ts and the runtime may read the project's variables.
      loadProjectEnv(input ?? ".");
      warnLegacyLayerEntries(input ?? ".", await loadCheckedMeekoConfig(input ?? "."));
      writeDiagnostics(await checkFrameworkProject(input ?? "."));
      process.stdout.write(`${resolve(input ?? ".")}: OK\n`);
    } else if (command === "init" || command === "init-framework") {
      if (!input) throw new Error("Falta el directorio de destino");
      const target = command === "init" ? await initProject(input) : await initFrameworkProject(input);
      const manager = existsSync(join(target, "pnpm-lock.yaml")) ? "pnpm" : "npm";
      const prefix = target === resolve(".") ? "" : `cd ${target} && `;
      process.stdout.write(`Proyecto creado en ${target}\nSiguiente paso: ${prefix}${manager} install && ${manager} run dev\n`);
    } else if (command === "routes") {
      if (!input) throw new Error("Falta el directorio del proyecto");
      await assertDirectory(input);
      // The same preparation as `meeko check`, without TypeScript: tsc -p .meeko/tsconfig.*.json works after it.
      // The entries go last, so a discovery error leaves no .meeko/ behind in a wrong folder.
      const files = await prepareFrameworkTypeDeclarations(input);
      await prepareProject(input);
      for (const file of files) process.stdout.write(`${file}\n`);
    } else if (command === "prerender") {
      if (!input) throw new Error("Falta el directorio del proyecto");
      await assertDirectory(input);
      for (const file of await prerenderProject(input)) process.stdout.write(`${file}\n`);
    } else if (command === "check-app") {
      if (!input) throw new Error("Falta el directorio del proyecto");
      // A missing folder has no components either: without this, it passed as a project without errors.
      await assertDirectory(input);
      const diagnostics = await checkApp(input);
      writeDiagnostics(diagnostics);
      if (hasErrors(diagnostics)) process.exitCode = 1;
      else process.stdout.write(`${input}: OK\n`);
    } else {
      if (!input) throw new Error("Falta la ruta del componente");
      const source = await readComponent(input);
      // The file's own letter case: the declaration and the component's names follow it.
      const filename = diskCase(input);
      const diagnostics = await checkSource(source, filename);
      if (command === "check" && output === "--json") {
        process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
      } else if (hasErrors(diagnostics)) {
        writeDiagnostics(diagnostics);
      } else if (command === "compile") {
        // The component follows the `css` and `theme` options of the project that contains it.
        const config = await loadMeekoConfig(projectRoot(filename));
        const scopeAttribute = config.css?.scopeAttribute;
        const result = compile(source, filename, { ...(scopeAttribute ? { scopeAttribute } : {}), theme: config.theme !== undefined && config.theme !== false });
        await writeFile(output!, result.code, "utf8");
        process.stdout.write(`${output}\n`);
      } else if (command === "types") {
        for (const generated of await generateTypes(source, filename)) process.stdout.write(`${generated}\n`);
      } else {
        writeDiagnostics(diagnostics);
        process.stdout.write(`${input}: OK\n`);
      }
      if (hasErrors(diagnostics)) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
