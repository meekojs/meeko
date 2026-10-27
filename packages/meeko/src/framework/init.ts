import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const allowedEntries = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "node_modules", ".npmrc", ".git"]);

const files: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n.meeko/\n",
  "public/.gitkeep": "",
  "app/styles/main.css": `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; }
`,
  "meeko.config.ts": `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  layers: [],
  modules: [],
  imports: { serverDirs: [] },
});
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "allowArbitraryExtensions": true,
    "skipLibCheck": true
  },
  "files": [],
  "references": [
    { "path": "./.meeko/tsconfig.app.json" },
    { "path": "./.meeko/tsconfig.server.json" },
    { "path": "./.meeko/tsconfig.shared.json" }
  ]
}
`,
  "app/pages/index.meeko": `<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<script lang="ts">
import { signal } from "@meekojs/meeko";

export interface Props {
  params: Record<string, string>;
  search: Record<string, string | string[]>;
  data?: unknown;
}

const count = signal(0);
</script>

<template>
  <section>
    <h1>Welcome to Meeko</h1>
    <p>File routes, server rendering, and hydration are ready.</p>
    <button type="button" on:click="() => count.value++">Count: {count.value}</button>
  </section>
</template>
`,
  "app/app.meeko": `<template>
  <div class="site-root"><MeekoOutlet /></div>
</template>
`,
  "app/layouts/default.meeko": `<template>
  <div class="app-shell">
    <header><MeekoLink to="/">Meeko</MeekoLink></header>
    <main><MeekoOutlet /></main>
  </div>
</template>

<style scoped>
.app-shell { max-width: 64rem; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
header { margin-bottom: 2rem; }
</style>
`,
  "server/runtime.ts": `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

// Created once per server process. \`meeko build\` also calls it with
// \`prerendering: true\` to render pages declared with render: "prerender".
export default defineServerRuntime(({ production, prerendering }) => {
  if (production && !prerendering) throw new Error("Configure a persistent SessionStore in server/runtime.ts before production startup");
  return { sessions: new SessionManager({ store: new MemorySessionStore(), production: false }) };
});
`,
  "README.md": `# Meeko framework starter

Requires Node 24.

\`\`\`sh
npm install
npm run dev
\`\`\`

Routes live in \`app/pages\`. \`app/layouts/default.meeko\` keeps the shared shell during client navigation. Put shared route guards in \`app/middleware\` with \`defineRouteMiddleware\`, and server request middleware in \`server/middleware\` with \`defineServerMiddleware\`; see the framework guide for their execution and security boundaries. \`server/runtime.ts\` creates the sessions and services shared by pages, API, RPC and Socket channels; replace its memory store with a persistent \`SessionStore\` before production. Global styles in \`app/styles/main.css\` load automatically; component styles stay in \`<style>\` blocks. Run \`npm run check\` for types, then \`npm run build\` and \`npm start\` for production SSR. The build in \`.meeko/output/node\` runs without the application sources; \`HOST\`, \`PORT\` and \`PUBLIC_ORIGIN\` configure it. Generated files live under \`.meeko/\`.
`,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creates a framework project without overwriting unrelated user files. */
export async function initFrameworkProject(directory: string): Promise<string> {
  const target = resolve(directory);
  const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "meeko-app";
  const metadata: unknown = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  if (!record(metadata) || typeof metadata.version !== "string") throw new Error("Meeko package version is unavailable");
  let entries: string[] = [];
  try {
    if (!(await stat(target)).isDirectory()) throw new Error(`Destination is not a directory: ${target}`);
    entries = await readdir(target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const unexpected = entries.filter((entry) => !allowedEntries.has(entry));
  if (unexpected.length || (entries.length && !entries.includes("package.json"))) {
    throw new Error(`Destination is not empty: ${target}`);
  }
  const existing: unknown = entries.includes("package.json") ? JSON.parse(await readFile(join(target, "package.json"), "utf8")) : {};
  if (!record(existing) || (existing.scripts !== undefined && !record(existing.scripts))
    || (existing.dependencies !== undefined && !record(existing.dependencies))
    || (existing.devDependencies !== undefined && !record(existing.devDependencies))) {
    throw new Error(`Invalid package.json in ${target}`);
  }
  const scripts = {
    dev: "meeko dev .",
    check: "meeko check .",
    build: "meeko build .",
    start: "meeko start .",
  };
  const oldScripts = existing.scripts as Record<string, unknown> | undefined;
  for (const command of Object.keys(scripts)) if (oldScripts && command in oldScripts) {
    throw new Error(`Destination already defines the ${command} script: ${target}`);
  }
  const manifest = {
    ...existing,
    name: typeof existing.name === "string" ? existing.name : name,
    private: true,
    type: "module",
    engines: { ...(record(existing.engines) ? existing.engines : {}), node: ">=24" },
    scripts: { ...oldScripts, ...scripts },
    dependencies: { ...(existing.dependencies as Record<string, unknown> | undefined), "@meekojs/meeko": metadata.version },
    devDependencies: {
      ...(existing.devDependencies as Record<string, unknown> | undefined),
      "@types/node": "^24.0.0", typescript: "^7.0.2", vite: "^8.3.5",
    },
  };
  await mkdir(target, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    const output = join(target, filename);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(join(target, "package.json"), JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8", flag: entries.includes("package.json") ? "w" : "wx",
  });
  return target;
}
