import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { linkRepositoryPackages } from "./temp-project.ts";

/**
 * A small app that the static adapter can build: a home page, a dynamic route with two
 * prerendered entries, app/error.meeko and a public file. `config` is the body of
 * `meeko.config.mjs`.
 */
export async function writeStaticApp(root: string, config: string): Promise<void> {
  const files: Record<string, string> = {
    "package.json": '{"name":"static-app","private":true,"type":"module"}\n',
    "meeko.config.mjs": `export default ${config};\n`,
    "app/pages/index.meeko": '<template><p id="home">Inicio</p><a id="to-a" href="/docs/a">A</a><a id="to-missing" href="/docs/zz">Missing</a></template>\n',
    "app/pages/index.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\n\nexport const route = definePage({ render: "prerender" });\n',
    "app/pages/docs/[slug].meeko": [
      '<script lang="ts">',
      "const props = defineProps<{ params: { slug: string }; search: Record<string, string | string[]> }>();",
      "</script>",
      '<template><p id="doc">{props.params.slug}</p><a id="to-home" href="/">Inicio</a><a id="to-b" href="/docs/b">B</a></template>',
      "",
    ].join("\n"),
    "app/pages/docs/[slug].route.ts": [
      'import { definePage } from "@meekojs/meeko/framework";',
      "",
      'export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "a" }, { slug: "b" }], head: ({ params }) => ({ title: `Doc ${params.slug}`, description: `About ${params.slug}` }) });',
      "",
    ].join("\n"),
    "app/error.meeko": [
      '<script lang="ts">',
      "const props = defineProps<{ status: number; message: string }>();",
      "</script>",
      '<template><p id="error">{props.status}</p><a id="error-home" href="/">Inicio</a><a id="error-a" href="/docs/a">A</a></template>',
      "",
    ].join("\n"),
    "public/hello.txt": "hello\n",
  };
  for (const [file, contents] of Object.entries(files)) {
    const path = join(root, ...file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
}

/** The configuration of {@link writeStaticApp} with every option of the static adapter. */
export const staticAppConfig = `{
  site: "https://example.com",
  sitemap: true,
  robots: { disallow: ["/private/"] },
  document: { lang: "es", seo: true, head: { titleTemplate: "%s · Test", script: [{ children: "window.boot = 1" }] } },
  server: {
    adapter: "static",
    headerFiles: ["_headers", "nginx"],
    // data: for the default <link rel="icon" href="data:,"> of a document without an icon.
    contentSecurityPolicy: { "default-src": ["'self'"], "img-src": ["'self'", "data:"], "style-src": ["'self'", "'unsafe-inline'"], "object-src": ["'none'"] },
    headers: { "X-Content-Type-Options": "nosniff" },
  },
}`;
