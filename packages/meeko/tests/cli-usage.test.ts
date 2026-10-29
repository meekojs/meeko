import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { initFrameworkProject } from "../src/framework/init.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

/** Runs the CLI from its sources with tsx, so these checks do not need a build of dist/. */
function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), ...args], { encoding: "utf8" });
}

test("an unknown command or option names the problem before the usage and fails", () => {
  const cases: Array<[readonly string[], string]> = [
    [["frobnicate"], "Comando desconocido: frobnicate"],
    [["dev", "--port", "1"], "Opción desconocida para dev: --port"],
    [["start", ".", "--open"], "Opción desconocida para start: --open"],
    [["preview", "--adapter=node", "--watch"], "Opción desconocida para preview: --watch"],
    [["build", ".", "--adapter"], "Falta el nombre del adaptador en --adapter de build"],
    [["check", "a.meeko", "b.meeko"], "Argumento de más para check: b.meeko"],
    [["check", "--json"], "--json va después del componente .meeko de check"],
    [["compile", "a.meeko"], "Falta el archivo de salida de compile"],
    [["types"], "Falta el componente .meeko de types"],
    [["dev", "one", "two"], "Argumento de más para dev: two"],
    [[], "Falta el comando"],
  ];
  for (const [args, problem] of cases) {
    const result = cli(...args);
    assert.equal(result.status, 1, `${args.join(" ")}: ${result.stderr}`);
    assert.equal(result.stdout, "", args.join(" "));
    assert.ok(result.stderr.startsWith(`${problem}\n\nUso: meeko dev`), `${args.join(" ")}: ${result.stderr}`);
  }
});

test("the help names the environment variables that dev, start and preview read", () => {
  const result = cli("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Uso: meeko dev/);
  assert.match(result.stdout, /Variables de entorno:/);
  assert.match(result.stdout, /MEEKO_PORT, MEEKO_HOST {2}puerto y dirección de dev, start y preview/);
  assert.match(result.stdout, /MEEKO_PUBLIC_ORIGIN {2}origen público de dev, start y preview/);
  assert.match(result.stdout, /HOST y PUBLIC_ORIGIN están obsoletas/);
  assert.match(result.stdout, /MEEKO_HMR_PORT/);
  assert.match(result.stdout, /MEEKO_EDITOR_BRIDGE=0/);
});

test("meeko <command> --help and meeko help <command> print that command's help", () => {
  const commands = ["dev", "check", "build", "start", "preview", "clean", "auth", "check-app", "compile", "types", "routes", "prerender", "init", "init-framework", "lsp"];
  for (const command of commands) {
    for (const args of [[command, "--help"], [command, ".", "-h"], ["help", command]]) {
      const result = cli(...args);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.equal(result.stderr, "", args.join(" "));
      assert.ok(result.stdout.startsWith(`Uso: meeko ${command}`), `${args.join(" ")}: ${result.stdout}`);
      assert.doesNotMatch(result.stdout, /Variables de entorno/, "only that command");
    }
  }
  assert.match(cli("build", "--adapter", "--help").stdout, /--adapter sustituye a server\.adapter/, "help wins over a broken option");
  assert.match(cli("lsp", "--help").stdout, /--node-ipc \| --socket=<puerto> \| --pipe=<nombre>/);
});

test("the general help lists every transport of lsp and the help of each command", () => {
  const result = cli("--help");
  assert.match(result.stdout, /meeko lsp --stdio \| --node-ipc \| --socket=<puerto> \| --pipe=<nombre>\n/);
  assert.match(result.stdout, /meeko <comando> --help/);
});

test("a project directory that does not exist fails with its name, also in check-app", async (context) => {
  const root = await tempProject(context, "cli-missing");
  const missing = join(root, "no-existe");
  for (const command of ["check-app", "routes", "prerender", "check", "build", "start", "preview"]) {
    const result = cli(command, missing);
    assert.equal(result.status, 1, `${command}: ${result.stdout}`);
    assert.equal(result.stdout, "", `${command} prints no OK`);
    assert.equal(result.stderr, `No existe el directorio ${missing}\n`, command);
  }
  const component = cli("types", join(root, "Falta.meeko"));
  assert.equal(component.status, 1);
  assert.equal(component.stderr, `No existe el archivo ${join(root, "Falta.meeko")}\n`);
  const relative = cli("check-app", "./no-existe");
  assert.equal(relative.status, 1);
  assert.equal(relative.stdout, "");
  assert.equal(relative.stderr, `No existe el directorio ./no-existe (${resolve("./no-existe")})\n`);
});

test("meeko routes prepares .meeko like check: tsconfigs, services.d.ts and the Vite entries, so tsc -p works", async (context) => {
  const root = await tempProject(context, "cli-routes");
  await initFrameworkProject(root);
  await linkRepositoryPackages(root);
  const result = cli("routes", root);
  assert.equal(result.status, 0, result.stderr);
  const listed = result.stdout.trim().split(/\r?\n/);
  for (const file of [
    join(root, ".meeko", "types", "routes.d.ts"), join(root, ".meeko", "manifests", "server.json"),
    join(root, ".meeko", "types", "services.d.ts"), join(root, ".meeko", "tsconfig.app.json"),
    join(root, ".meeko", "tsconfig.server.json"), join(root, ".meeko", "tsconfig.shared.json"),
    join(root, ".meeko", "types", "autoimports", "server.d.ts"),
  ]) {
    assert.ok(listed.includes(file), `${file} in ${result.stdout}`);
    assert.ok(existsSync(file), file);
  }
  assert.ok(existsSync(join(root, ".meeko", "generated", "entry-server.ts")), "the entries the tsconfigs include");
});

test("meeko types writes the declaration with the file's own letter case on a case-insensitive disk", async (context) => {
  const root = await tempProject(context, "cli-types-case");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ private: true, type: "module" })}\n`);
  await linkRepositoryPackages(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "Greeting.meeko"), "<template><p>Hola</p></template>\n");
  if (!existsSync(join(root, "src", "greeting.meeko"))) {
    context.skip("case-sensitive file system");
    return;
  }
  const result = cli("types", join(root, "src", "greeting.meeko"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${join(root, ".meeko", "types", "src", "Greeting.d.meeko.ts")}\n`);
  assert.ok((await readdir(join(root, ".meeko", "types", "src"))).includes("Greeting.d.meeko.ts"));
});
