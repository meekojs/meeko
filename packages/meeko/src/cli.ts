#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkSource } from "./check.js";
import { compile } from "./compiler.js";
import { projectRoot } from "./compiler/project-root.js";
import { loadMeekoConfig } from "./framework/config.js";
import { setModuleDevelopmentMode, warnLegacyLayerEntries } from "./framework/module-loader.js";
import { generateTypes } from "./types.js";
import { initProject } from "./init.js";
import { initFrameworkProject } from "./framework/init.js";
import { generateRoutes } from "./framework/generate.js";
import { generateServerContracts } from "./framework/contracts-generate.js";
import { checkApp, generateAppTypes } from "./framework/check-app.js";
import { prerenderProject } from "./framework/prerender.js";
import { generateTypeScriptAutoImports } from "./autoimports-ts.js";
import { assertBuildAdapter, buildProject, developmentServerPorts, previewProject, startProject, stopDevelopmentServer } from "./framework/project.js";
import { findLinkedMeeko, isSupervisedDevelopment, linkWatchEnabled, runSupervisedDevelopment, superviseDevelopment } from "./framework/dev-link.js";
import { checkFrameworkProject, prepareFrameworkTypes } from "./framework/check-project.js";
import { cleanProject, formatCleanResult } from "./framework/clean.js";

const usage = "Uso: meeko dev [directorio]\n     meeko check [directorio | componente.meeko] [--json]\n     meeko build [directorio] [--adapter <node|cloudflare|deno|bun>]\n     meeko start [directorio]\n     meeko preview [directorio] [--adapter <node|cloudflare|bun|deno>]\n     meeko clean [directorio] [--all] [--dry-run]\n     meeko check-app <directorio>\n     meeko compile <componente.meeko> <salida.ts>\n     meeko types <componente.meeko>\n     meeko routes <directorio>\n     meeko prerender <directorio>\n     meeko init <directorio>\n     meeko init-framework <directorio>\n     meeko lsp --stdio\n     meeko --help | --version\n\n" +
  "Variables de entorno:\n" +
  "     PORT, HOST       puerto y dirección de dev, start y preview; sustituyen a server.port y\n" +
  "                      server.host de meeko.config.ts (por defecto, 127.0.0.1:4173; preview\n" +
  "                      de cloudflare se los pasa a wrangler dev)\n" +
  "     PUBLIC_ORIGIN    origen público de dev, start y preview (Node, Bun y Deno) para las\n" +
  "                      comprobaciones de Origin de HTTP y Socket tras un proxy\n" +
  "     MEEKO_HMR_PORT   puerto del WebSocket de HMR de dev\n" +
  "     MEEKO_EDITOR_BRIDGE=0  desactiva el puente con el editor de dev\n" +
  "     MEEKO_LINK_WATCH=0     dev no se reinicia al reconstruir un @meekojs/meeko enlazado\n";
const argv = process.argv.slice(2);
/** First problem with the command line, reported before the usage. */
let problem: string | undefined;
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
  else if (!projectCommand && !legacyCommand && command !== "check" && command !== "clean") problem ??= `Comando desconocido: ${command}`;
  // `check` accepts `--json` after the component; every other option was consumed above.
  const option = argv.slice(1).find((argument, index) => argument.startsWith("-") && !(command === "check" && argument === "--json" && index === 1));
  if (option !== undefined) problem ??= command === "check" && option === "--json" ? "--json va después del componente .meeko de check" : `Opción desconocida para ${command}: ${option}`;
  if (!projectCommand && command !== "check" && command !== "clean" && !input) problem ??= `Falta ${command === "compile" || command === "types" ? "el componente .meeko" : "el directorio"} de ${command}`;
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
  process.stdout.write(usage);
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
      if (command === "dev") {
        // A linked Meeko (pnpm link:, npm link, a workspace) is rebuilt while dev runs: a
        // supervisor restarts the server in a fresh process, which loads the new build.
        const linked = linkWatchEnabled() ? findLinkedMeeko(resolve(root)) : undefined;
        const start = async () => {
          // Modules run once in this process, already in development mode for the types prepared below.
          setModuleDevelopmentMode(true);
          warnLegacyLayerEntries(root, await loadMeekoConfig(root));
          await prepareFrameworkTypes(root);
          return startProject(root, false);
        };
        if (linked) process.exitCode = await superviseDevelopment(linked);
        else if (isSupervisedDevelopment()) await runSupervisedDevelopment(start, stopDevelopmentServer, developmentServerPorts);
        else await start();
      }
      else if (command === "start") await startProject(root, true);
      // Preview runs the output in its runtime: Node in this process; Bun, Deno and wrangler dev as a child.
      else if (command === "preview") await previewProject(root, adapter === undefined ? undefined : assertBuildAdapter(adapter));
      else {
        const requested = adapter === undefined ? undefined : assertBuildAdapter(adapter);
        warnLegacyLayerEntries(root, await loadMeekoConfig(root));
        await checkFrameworkProject(root);
        const result = await buildProject(root, requested === undefined ? {} : { adapter: requested });
        process.stdout.write(`${result.output}\n`);
      }
    } else if (command === "clean") {
      const result = await cleanProject(input ?? ".", { all: cleanAll, dryRun: cleanDryRun });
      const report = formatCleanResult(result);
      process.stdout.write(report.stdout);
      process.stderr.write(report.stderr);
      if (result.failures.length > 0) process.exitCode = 1;
    } else if (command === "check" && (!input || (await stat(input).catch(() => undefined))?.isDirectory())) {
      if (output) throw new Error("--json sólo está disponible para un componente .meeko");
      warnLegacyLayerEntries(input ?? ".", await loadMeekoConfig(input ?? "."));
      await checkFrameworkProject(input ?? ".");
      process.stdout.write(`${resolve(input ?? ".")}: OK\n`);
    } else if (command === "init" || command === "init-framework") {
      if (!input) throw new Error("Falta el directorio de destino");
      const target = command === "init" ? await initProject(input) : await initFrameworkProject(input);
      const manager = existsSync(join(target, "pnpm-lock.yaml")) ? "pnpm" : "npm";
      const prefix = target === resolve(".") ? "" : `cd ${target} && `;
      process.stdout.write(`Proyecto creado en ${target}\nSiguiente paso: ${prefix}${manager} install && ${manager} run dev\n`);
    } else if (command === "routes") {
      if (!input) throw new Error("Falta el directorio del proyecto");
      const generated = await generateRoutes(input);
      const server = await generateServerContracts(input);
      const components = await generateAppTypes(input);
      const imports = await generateTypeScriptAutoImports(input);
      process.stdout.write(`${generated.types}\n${generated.manifest}\n${server.types}\n${server.manifest}\n${components.map((file) => `${file}\n`).join("")}${imports.client}\n${imports.server}\n${imports.shared}\n`);
    } else if (command === "prerender") {
      if (!input) throw new Error("Falta el directorio del proyecto");
      for (const file of await prerenderProject(input)) process.stdout.write(`${file}\n`);
    } else if (command === "check-app") {
      if (!input) throw new Error("Falta el directorio del proyecto");
      const diagnostics = await checkApp(input);
      for (const diagnostic of diagnostics) {
        const { line, column } = diagnostic.location;
        process.stderr.write(`${diagnostic.filename}:${line}:${column} ${diagnostic.code}: ${diagnostic.message}\n`);
      }
      if (diagnostics.length > 0) process.exitCode = 1;
      else process.stdout.write(`${input}: OK\n`);
    } else {
      if (!input) throw new Error("Falta la ruta del componente");
      const source = await readFile(input, "utf8");
      const diagnostics = await checkSource(source, input);
      if (command === "check" && output === "--json") {
        process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
      } else if (diagnostics.length > 0) {
        for (const diagnostic of diagnostics) {
          const { line, column } = diagnostic.location;
          process.stderr.write(`${diagnostic.filename}:${line}:${column} ${diagnostic.code}: ${diagnostic.message}\n`);
        }
      } else if (command === "compile") {
        // The component follows the `css` options of the project that contains it.
        const scopeAttribute = (await loadMeekoConfig(projectRoot(input))).css?.scopeAttribute;
        const result = compile(source, input, scopeAttribute ? { scopeAttribute } : {});
        await writeFile(output!, result.code, "utf8");
        process.stdout.write(`${output}\n`);
      } else if (command === "types") {
        for (const generated of await generateTypes(source, input)) process.stdout.write(`${generated}\n`);
      } else {
        process.stdout.write(`${input}: OK\n`);
      }
      if (diagnostics.length > 0) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
