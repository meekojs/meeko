import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { defineMeekoModule } from "@meekojs/meeko/framework";
import { compileCatalog, messageParameters } from "./messages";
import type { Catalog } from "./messages";

export interface I18nModuleOptions {
  /** Locale to use for an unprefixed URL. */
  readonly defaultLocale: string;
  /** JSON catalog path, or named catalog paths, for each locale. `common` loads on every route. */
  readonly catalogs: Readonly<Record<string, string | Readonly<Record<string, string>>>>;
  /** Additional catalog namespaces for each exact route ID in the Meeko manifest. */
  readonly routes?: Readonly<Record<string, readonly string[]>>;
  /** Text direction overrides; all other locales use ltr. */
  readonly directions?: Readonly<Record<string, "ltr" | "rtl">>;
}

const manifestId = "virtual:meeko-i18n";
const resolvedManifest = "\0meeko-i18n:manifest";
const catalogPrefix = "\0meeko-i18n:catalog:";

export default defineMeekoModule<I18nModuleOptions>({
  meta: { name: "@meekojs/i18n", compatibility: { meeko: ">=1.7 <2" } },
  setup(options, meeko) {
    if (!options.catalogs || typeof options.catalogs !== "object" || Array.isArray(options.catalogs)) throw new TypeError("i18n: catalogs must be an object");
    const locales = Object.keys(options.catalogs);
    if (!locales.length || !locales.includes(options.defaultLocale)) throw new TypeError("i18n: defaultLocale must name a catalog");
    if (locales.some((locale) => !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale))) throw new TypeError("i18n: invalid locale tag");
    for (const locale of locales) {
      try { Intl.getCanonicalLocales(locale); }
      catch { throw new TypeError(`i18n: invalid locale ${locale}`); }
    }
    if (options.directions && Object.keys(options.directions).some((locale) => !locales.includes(locale))) throw new TypeError("i18n: direction has no catalog");
    if (options.directions && Object.values(options.directions).some((direction) => direction !== "ltr" && direction !== "rtl")) throw new TypeError("i18n: direction must be ltr or rtl");
    const root = realpathSync(meeko.rootDir);
    const files = new Map<string, string>();
    const references = new Map<string, string[]>();
    const parameters = new Map<string, Readonly<Record<string, "value" | "number">>>();
    let expectedNamespaces: string[] | undefined;
    for (const [locale, input] of Object.entries(options.catalogs)) {
      const namespaces = typeof input === "string" ? { common: input } : input;
      if (!namespaces || typeof namespaces !== "object" || Array.isArray(namespaces) || !namespaces.common) throw new TypeError(`i18n: ${locale} needs a common catalog`);
      const names = Object.keys(namespaces).sort();
      if (expectedNamespaces && (names.length !== expectedNamespaces.length || names.some((name, index) => name !== expectedNamespaces![index]))) throw new TypeError(`i18n: ${locale} has different namespaces`);
      expectedNamespaces ??= names;
      for (const [namespace, path] of Object.entries(namespaces)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace) || typeof path !== "string") throw new TypeError(`i18n: invalid namespace ${namespace}`);
        const file = realpathSync(resolve(root, path));
        const inside = relative(root, file);
        if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) throw new TypeError(`i18n: catalog ${locale}/${namespace} leaves the project`);
        const catalog = compileCatalog(JSON.parse(readFileSync(file, "utf8")) as unknown, file);
        const keys = Object.keys(catalog).sort();
        const reference = references.get(namespace);
        if (reference && (keys.length !== reference.length || keys.some((key, index) => key !== reference[index]))) throw new TypeError(`i18n: catalog ${locale}/${namespace} has different message keys`);
        references.set(namespace, keys);
        for (const key of keys) {
          const contract = messageParameters(catalog[key]!);
          const identity = `${namespace}:${key}`;
          const previous = parameters.get(identity);
          if (previous && JSON.stringify(previous) !== JSON.stringify(contract)) throw new TypeError(`i18n: catalog ${locale}/${namespace} message ${key} has different parameters`);
          parameters.set(identity, contract);
        }
        files.set(`${locale}:${namespace}`, file);
      }
    }
    for (const [route, names] of Object.entries(options.routes ?? {})) {
      if (!route.startsWith("/") || !Array.isArray(names) || names.some((name) => !expectedNamespaces?.includes(name))) throw new TypeError(`i18n: invalid namespaces for route ${route}`);
    }
    const allKeys = new Set<string>();
    for (const [namespace, keys] of references) for (const key of keys) {
      if (allKeys.has(key)) throw new TypeError(`i18n: duplicate message key ${key} in ${namespace}`);
      allKeys.add(key);
    }
    const signatures = [...references].flatMap(([namespace, keys]) => keys.map((key) => {
      const fields = Object.entries(parameters.get(`${namespace}:${key}`)!).map(([name, kind]) => `readonly ${JSON.stringify(name)}: ${kind === "number" ? "number" : 'import("@meekojs/i18n").I18nValue'}`).join("; ");
      return [key, `    ${JSON.stringify(key)}: { ${fields} };`] as const;
    })).sort(([a], [b]) => a.localeCompare(b));
    const types = `// Generated by @meekojs/i18n. Do not edit.\nexport {};\ndeclare module "@meekojs/i18n" {\n  interface GeneratedI18nMessages {\n${signatures.map(([, declaration]) => declaration).join("\n")}\n  }\n}\n`;
    meeko.addTypeTemplate("messages.d.ts", types);
    meeko.addVitePlugin({
      name: "meeko:i18n",
      resolveId(id: string) {
        if (id === manifestId) return resolvedManifest;
        return id.startsWith(catalogPrefix) ? id : undefined;
      },
      load(this: { addWatchFile(file: string): void }, id: string) {
        if (id === resolvedManifest) {
          const entries = locales.map((locale) => `${JSON.stringify(locale)}: {${expectedNamespaces!.map((namespace) => `${JSON.stringify(namespace)}: () => import(${JSON.stringify(`${catalogPrefix}${locale}:${namespace}`)})`).join(",")}}`);
          return `export const catalogs = {${entries.join(",")}};`;
        }
        if (!id.startsWith(catalogPrefix)) return undefined;
        const key = id.slice(catalogPrefix.length);
        const file = files.get(key);
        if (!file) throw new TypeError(`i18n: unknown catalog ${key}`);
        this.addWatchFile(file);
        const catalog: Catalog = compileCatalog(JSON.parse(readFileSync(file, "utf8")) as unknown, file);
        return `export default ${JSON.stringify(catalog)};`;
      },
    });
    meeko.addPlugin({
      src: new URL("./plugin.js", import.meta.url),
      options: { defaultLocale: options.defaultLocale, locales, directions: options.directions ?? {}, routes: options.routes ?? {} },
    });
    meeko.addAutoImports({ name: "useI18n", from: "@meekojs/i18n", scope: "app", componentOnly: true });
  },
});
