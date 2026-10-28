import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import postcss from "postcss";
import { build, createServer, normalizePath } from "vite";
import { meekoUtilities } from "../src/postcss.ts";
import type { MeekoUtilitiesOptions } from "../src/postcss.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { meeko } from "../src/vite.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

/** A utilities module that reads, without imports, a constant of `imports.appDirs` and one of `shared/utils`. */
const colorModule = `import { defineUtilities } from "@meekojs/meeko/postcss";
import { roles } from "./roles";

export default defineUtilities(({ rule }) =>
  THEME_COLORS.map((color) => rule(\`.color[data-color='\${color}']\`, { ...roles(color), "--fallback": typeof FALLBACK === "undefined" ? "none" : FALLBACK })));
`;

const meekoProject: Record<string, string> = {
  "package.json": `${JSON.stringify({ private: true, type: "module", dependencies: { "@meekojs/meeko": "*" } })}\n`,
  "meeko.config.ts": `import { defineMeekoConfig } from "@meekojs/meeko/framework";\nexport default defineMeekoConfig({ imports: { appDirs: ["app/theme"] } });\n`,
  "postcss.config.ts": `import { meekoUtilities } from "@meekojs/meeko/postcss";\nexport default { plugins: [meekoUtilities()] };\n`,
  "app/theme/constants.ts": `export const THEME_COLORS = ["neutral", "accent"] as const;\nexport type ThemeColor = (typeof THEME_COLORS)[number];\n`,
  // A primitive constant: rolldown inlines it, and the file must still be a dependency.
  "shared/utils/steps.ts": `export const STEP_COUNT = 2;\n`,
  // A local module of the utilities module: it gets the autoimports too.
  "app/styles/utilities/roles.ts": `export const roles = (color: ThemeColor): Record<string, string> =>
  Object.fromEntries(Array.from({ length: STEP_COUNT }, (_, i) => [\`--color-\${i + 1}\`, \`var(--\${color}-\${i + 1})\`]));
`,
  "app/styles/utilities/color.ts": colorModule,
  "app/styles/main.css": `@layer utilities;\n@utilities "./utilities/color.ts" layer(utilities);\n`,
  "server/utils/secret.ts": `export const SECRET_COLOR = "red";\n`,
  "app/styles/utilities/secret.ts": `export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".secret", { color: SECRET_COLOR });\n`,
  "app/styles/server.css": `@utilities "./utilities/secret.ts";\n`,
  "app/pages/index.meeko": `<template><p class="color" data-color="neutral">Hola</p></template>\n`,
  "index.html": `<!doctype html><html><head><link rel="stylesheet" href="/app/styles/main.css"></head><body><script type="module" src="/main.ts"></script></body></html>\n`,
  "main.ts": `export {};\n`,
};

async function createProject(prefix: string, files: Record<string, string>) {
  const project = await createTempProject(prefix);
  await linkRepositoryPackages(project.root);
  for (const [path, contents] of Object.entries(files)) await write(project.root, path, contents);
  return project;
}

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents);
  // A later mtime: two writes within one tick of the file system must still look different.
  const later = new Date(Date.now() + 2_000 + Math.floor(Math.random() * 1_000));
  await utimes(file, later, later);
}

/** Runs only `meekoUtilities()` on `css`, as a stylesheet at `path` of `root`. */
async function generate(root: string, path: string, css: string, options?: MeekoUtilitiesOptions) {
  return postcss([meekoUtilities(options)]).process(css, { from: join(root, path) });
}

test("meeko dev gives @utilities modules the autoimports of app/ and shared/, watches them and rejects server/ clearly", { timeout: 120_000 }, async () => {
  const project = await createProject("postcss-autoimports-dev-", meekoProject);
  const root = project.root;
  const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
  try {
    const first = await server.transformRequest("/app/styles/main.css");
    assert.match(first?.code ?? "", /@layer utilities \{[^]*\.color\[data-color='neutral'\] \{[^]*--color-2: var\(--neutral-2\)[^]*--fallback: none/);
    assert.match(first?.code ?? "", /\.color\[data-color='accent'\]/);

    // The autoimported files are dependencies of the stylesheet, also the inlined constant.
    const graph = server.environments.client.moduleGraph;
    const stylesheet = await graph.getModuleByUrl("/app/styles/main.css");
    assert.ok(stylesheet);
    for (const dependency of ["app/theme/constants.ts", "shared/utils/steps.ts", "app/styles/utilities/roles.ts"]) {
      const modules = graph.getModulesByFile(normalizePath(join(root, dependency)));
      assert.ok([...modules ?? []].some((module) => module.importers.has(stylesheet)), `${dependency} updates the stylesheet`);
    }

    // Changing an autoimported constant regenerates the stylesheet.
    await write(root, "app/theme/constants.ts", `export const THEME_COLORS = ["neutral", "danger"] as const;\nexport type ThemeColor = (typeof THEME_COLORS)[number];\n`);
    await write(root, "shared/utils/steps.ts", `export const STEP_COUNT = 3;\n`);
    graph.invalidateModule(stylesheet);
    const changed = await server.transformRequest("/app/styles/main.css");
    assert.match(changed?.code ?? "", /\.color\[data-color='danger'\] \{[^]*--color-3: var\(--danger-3\)/);
    assert.doesNotMatch(changed?.code ?? "", /data-color='accent'/);

    // An export added to an autoimport folder reaches a module whose own files did not change.
    await write(root, "app/theme/fallback.ts", `export const FALLBACK = "var(--neutral-1)";\n`);
    graph.invalidateModule(stylesheet);
    const added = await server.transformRequest("/app/styles/main.css");
    assert.match(added?.code ?? "", /--fallback: var\(--neutral-1\)/);
    await rm(join(root, "app/theme/fallback.ts"));
    graph.invalidateModule(stylesheet);
    const removed = await server.transformRequest("/app/styles/main.css");
    assert.match(removed?.code ?? "", /--fallback: none/);

    // A server/utils export is not available: a clear error, not a ReferenceError.
    await assert.rejects(server.transformRequest("/app/styles/server.css"), (error: Error) => {
      assert.match(error.message, /app\/styles\/utilities\/secret\.ts usa el autoimport SECRET_COLOR, que no está disponible al generar el CSS de @utilities: viene de server\/utils\/secret\.ts, que sólo existe en el servidor/);
      assert.doesNotMatch(error.message, /is not defined/);
      return true;
    });
  } finally {
    await server.close();
    await project.remove();
  }
});

test("meeko build writes the utilities generated with autoimports", { timeout: 120_000 }, async () => {
  const project = await createProject("postcss-autoimports-build-", meekoProject);
  try {
    const result = await build({
      root: project.root, configFile: false, plugins: [meeko()], logLevel: "silent",
      build: { outDir: join(project.root, "dist"), write: false, minify: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ fileName: string; source?: string | Uint8Array }> }>;
    const css = outputs.flatMap((entry) => entry.output)
      .filter((item) => item.fileName.endsWith(".css"))
      .map((item) => typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source)).join("\n");
    assert.match(css, /\.color\[data-color='accent'\] \{[^]*--color-2: var\(--accent-2\)/);
    assert.doesNotMatch(css, /@utilities/);
  } finally {
    await project.remove();
  }
});

test("@utilities modules do not get browser-only, component or framework runtime autoimports", { timeout: 60_000 }, async () => {
  const unavailable: Record<string, string> = {
    "app/utils/browser.client.ts": `export const BROWSER_COLOR = "blue";\n`,
    "app/components/Badge.meeko": `<template><span>badge</span></template>\n`,
    // An autoimport module that also uses signal: the utilities module only reads TINT.
    "app/utils/tint.ts": `export const TINT = "var(--accent-9)";\nexport function useTint() { return signal(TINT); }\n`,
    "app/styles/utilities/client.ts": `export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".client", { color: BROWSER_COLOR });\n`,
    "app/styles/utilities/component.ts": `export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".badge", { content: String(Badge) });\n`,
    "app/styles/utilities/signal.ts": `export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".signal", { opacity: signal(1).value });\n`,
    "app/styles/utilities/tint.ts": `export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".tint", { color: TINT });\n`,
  };
  const project = await createProject("postcss-autoimports-scopes-", { ...meekoProject, ...unavailable });
  try {
    const root = project.root;
    const cases: Array<[string, RegExp]> = [
      ["client", /usa el autoimport BROWSER_COLOR, que no está disponible al generar el CSS de @utilities: viene de app\/utils\/browser\.client\.ts, que sólo existe en el navegador/],
      ["component", /usa el autoimport Badge, que no está disponible al generar el CSS de @utilities: es el componente app\/components\/Badge\.meeko/],
      ["signal", /usa el autoimport signal, que no está disponible al generar el CSS de @utilities: es una API de @meekojs\/meeko para componentes/],
    ];
    for (const [name, message] of cases) {
      await assert.rejects(generate(root, "app/styles/main.css", `@utilities "./utilities/${name}.ts";`), (error: Error) => {
        // Thrown where the value is used: by the function, or by the plugin when it reads the output.
        assert.match(error.message, new RegExp(`"\\./utilities/${name}\\.ts"(?: lanzó un error al generar las utilidades)?: app/styles/utilities/${name}\\.ts usa`));
        assert.match(error.message, message);
        return true;
      }, name);
    }
    const tint = await generate(root, "app/styles/main.css", `@utilities "./utilities/tint.ts";`);
    assert.match(tint.css, /^\.tint \{\s*color: var\(--accent-9\);?\s*\}$/);
  } finally {
    await project.remove();
  }
});

test("without a Meeko project, or with autoImports: false, @utilities modules load as before", { timeout: 60_000 }, async () => {
  const plain = Object.fromEntries(Object.entries(meekoProject).filter(([path]) => path !== "meeko.config.ts" && path !== "package.json"));
  const outside = await createProject("postcss-autoimports-outside-", plain);
  const inside = await createProject("postcss-autoimports-disabled-", meekoProject);
  try {
    await assert.rejects(generate(outside.root, "app/styles/main.css", `@utilities "./utilities/color.ts";`), /THEME_COLORS is not defined/);
    await assert.rejects(generate(inside.root, "app/styles/main.css", `@utilities "./utilities/color.ts";`, { autoImports: false }), /THEME_COLORS is not defined/);
    // A module with its imports written out works in both.
    const explicit = `import { defineUtilities } from "@meekojs/meeko/postcss";\nimport { THEME_COLORS } from "../../theme/constants";\nexport default defineUtilities(({ rule }) => THEME_COLORS.map((color) => rule(\`.c-\${color}\`, { color })));\n`;
    for (const project of [outside, inside]) {
      await write(project.root, "app/styles/utilities/explicit.ts", explicit);
      const result = await generate(project.root, "app/styles/main.css", `@utilities "./utilities/explicit.ts";`, { autoImports: project !== inside });
      assert.match(result.css, /\.c-neutral \{[^]*\.c-accent/);
    }
  } finally {
    await outside.remove();
    await inside.remove();
  }
});

test("a configuration that throws leaves @utilities modules without autoimports, with a warning, and the stylesheet is generated", { timeout: 60_000 }, async () => {
  const project = await createProject("postcss-autoimports-broken-config-", {
    ...meekoProject,
    "meeko.config.ts": `throw new Error("configuración rota a propósito");\n`,
    "app/styles/utilities/explicit.ts": `import { defineUtilities } from "@meekojs/meeko/postcss";\nexport default defineUtilities(({ rule }) => rule(".explicit", { color: "red" }));\n`,
  });
  try {
    const result = await generate(project.root, "app/styles/main.css", `@utilities "./utilities/explicit.ts";\n@utilities "./utilities/explicit.ts" layer(again);\n`);
    assert.match(result.css, /\.explicit \{[^]*color: red[^]*@layer again \{[^]*\.explicit/);
    const warnings = result.warnings().map((warning) => warning.text);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.match(warnings[0]!, /no pudo leer los autoimports del proyecto .* y carga "\.\/utilities\/explicit\.ts" sin ellos: .*configuración rota a propósito/);
    // A module that needs an autoimport fails as without autoimports, at its own @utilities.
    await assert.rejects(generate(project.root, "app/styles/main.css", `@utilities "./utilities/color.ts";`), /THEME_COLORS is not defined/);
  } finally {
    await project.remove();
  }
});

test("meeko check type-checks @utilities modules with the autoimports they get", { timeout: 240_000 }, async () => {
  const files = Object.fromEntries(Object.entries(meekoProject).filter(([path]) => !path.endsWith("secret.ts") && path !== "app/styles/server.css"));
  // FALLBACK is not declared anywhere: the typeof guard needs a declaration for TypeScript.
  files["app/styles/utilities/color.ts"] = colorModule.replace(/, "--fallback": [^}]*\}/, " }");
  const project = await createProject("postcss-autoimports-check-", files);
  try {
    await checkFrameworkProject(project.root);
    // A server/utils export used in app/styles is a type error, as anywhere else in app/.
    await write(project.root, "server/utils/secret.ts", `export const SECRET_COLOR = "red";\n`);
    await write(project.root, "app/styles/utilities/secret.ts", meekoProject["app/styles/utilities/secret.ts"]!);
    await assert.rejects(checkFrameworkProject(project.root), /app[\\/]styles[\\/]utilities[\\/]secret\.ts.*TS2304.*SECRET_COLOR/s);
  } finally {
    await project.remove();
  }
});
