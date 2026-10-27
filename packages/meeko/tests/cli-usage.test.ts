import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

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
