#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkSource } from "./check.js";
import { compile } from "./compiler.js";
import { generateTypes } from "./types.js";
import { initProject } from "./init.js";

const [command, input, output] = process.argv.slice(2);
if ((command !== "compile" && command !== "check" && command !== "types" && command !== "init") || !input || (command === "compile" && !output) || (command === "check" && output !== undefined && output !== "--json") || ((command === "types" || command === "init") && output !== undefined)) {
  process.stderr.write("Usage: meeko check <component.meeko> [--json]\n       meeko compile <component.meeko> <output.ts>\n       meeko types <component.meeko>\n       meeko init <directory>\n");
  process.exitCode = 1;
} else {
  try {
    if (command === "init") {
      const target = await initProject(input);
      const manager = existsSync(join(target, "pnpm-lock.yaml")) ? "pnpm" : "npm";
      const prefix = target === resolve(".") ? "" : `cd ${target} && `;
      process.stdout.write(`Created ${target}\nNext: ${prefix}${manager} install && ${manager} run dev\n`);
    } else {
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
