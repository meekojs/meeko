#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkSource } from "./check.js";
import { compile } from "./compiler.js";
import { generateTypes } from "./types.js";
import { initProject } from "./init.js";
import { initFrameworkProject } from "./framework/init.js";
import { generateRoutes } from "./framework/generate.js";
import { generateServerContracts } from "./framework/contracts-generate.js";
import { checkApp, generateAppTypes } from "./framework/check-app.js";
import { prerenderProject } from "./framework/prerender.js";
import { generateTypeScriptAutoImports } from "./autoimports-ts.js";
import { buildProject, startProject } from "./framework/project.js";
import { checkFrameworkProject, prepareFrameworkTypes } from "./framework/check-project.js";

const usage = "Usage: meeko dev [project-directory]\n       meeko check [project-directory | component.meeko] [--json]\n       meeko build [project-directory]\n       meeko start [project-directory]\n       meeko check-app <project-directory>\n       meeko compile <component.meeko> <output.ts>\n       meeko types <component.meeko>\n       meeko routes <project-directory>\n       meeko prerender <project-directory>\n       meeko init <directory>\n       meeko init-framework <directory>\n       meeko --help | --version\n";
const [command, input, output] = process.argv.slice(2);
const projectCommand = command === "dev" || command === "build" || command === "start";
const legacyCommand = command === "compile" || command === "check-app" || command === "types" || command === "init" || command === "init-framework" || command === "routes" || command === "prerender";
if ((command === "--help" || command === "-h" || command === "help") && input === undefined) {
  process.stdout.write(usage);
} else if ((command === "--version" || command === "-v") && input === undefined) {
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  process.stdout.write(`${metadata.version}\n`);
} else if ((!projectCommand && !legacyCommand && command !== "check") || (!projectCommand && command !== "check" && !input) || (command === "compile" && !output) || (command === "check" && output !== undefined && output !== "--json") || (command !== "compile" && command !== "check" && output !== undefined)) {
  process.stderr.write(usage);
  process.exitCode = 1;
} else {
  try {
    if (projectCommand) {
      const root = input ?? ".";
      if (command === "dev") {
        await prepareFrameworkTypes(root);
        await startProject(root, false);
      }
      else if (command === "start") await startProject(root, true);
      else {
        await checkFrameworkProject(root);
        await buildProject(root);
      }
    } else if (command === "check" && (!input || (await stat(input).catch(() => undefined))?.isDirectory())) {
      if (output) throw new Error("--json is available only for a .meeko component");
      await checkFrameworkProject(input ?? ".");
      process.stdout.write(`${resolve(input ?? ".")}: OK\n`);
    } else if (command === "init" || command === "init-framework") {
      if (!input) throw new Error("Missing destination directory");
      const target = command === "init" ? await initProject(input) : await initFrameworkProject(input);
      const manager = existsSync(join(target, "pnpm-lock.yaml")) ? "pnpm" : "npm";
      const prefix = target === resolve(".") ? "" : `cd ${target} && `;
      process.stdout.write(`Created ${target}\nNext: ${prefix}${manager} install && ${manager} run dev\n`);
    } else if (command === "routes") {
      if (!input) throw new Error("Missing project directory");
      const generated = await generateRoutes(input);
      const server = await generateServerContracts(input);
      const components = await generateAppTypes(input);
      const imports = await generateTypeScriptAutoImports(input);
      process.stdout.write(`${generated.types}\n${generated.manifest}\n${server.types}\n${server.manifest}\n${components.map((file) => `${file}\n`).join("")}${imports.client}\n${imports.server}\n${imports.shared}\n`);
    } else if (command === "prerender") {
      if (!input) throw new Error("Missing project directory");
      for (const file of await prerenderProject(input)) process.stdout.write(`${file}\n`);
    } else if (command === "check-app") {
      if (!input) throw new Error("Missing project directory");
      const diagnostics = await checkApp(input);
      for (const diagnostic of diagnostics) {
        const { line, column } = diagnostic.location;
        process.stderr.write(`${diagnostic.filename}:${line}:${column} ${diagnostic.code}: ${diagnostic.message}\n`);
      }
      if (diagnostics.length > 0) process.exitCode = 1;
      else process.stdout.write(`${input}: OK\n`);
    } else {
      if (!input) throw new Error("Missing component path");
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
        const result = compile(source, input);
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
