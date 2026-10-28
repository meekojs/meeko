import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { AutoImport } from "../autoimports.js";

/**
 * The autoimports of a Meeko project for the modules of `@utilities`, which run in Node while the
 * stylesheet is generated, applied by the bundler of `module-loader.ts` to every local module. It reuses the registry and the transform of the Vite plugin
 * (`discoverAutoImports`, `transformTypeScriptAutoImports`) with the entries that make sense
 * there: the value exports of `app/` and `shared/` folders (also `imports.appDirs`,
 * `imports.sharedDirs`, layers and modules). Server-only and browser-only exports, components,
 * generated clients and the framework's runtime APIs are left out: a module that reads one gets
 * a value that throws a clear error when it is used, instead of a `ReferenceError`.
 *
 * The compiler and TypeScript load only when a Meeko project is found, so PostCSS outside Meeko
 * does not pay for them.
 */

/** What the bundler of `module-loader.ts` needs to apply a project's autoimports. */
export interface UtilityAutoImports {
  /** Root of the Meeko project. */
  readonly root: string;
  /** Changes with the registry: a loaded module built with another key is stale. */
  readonly key: string;
  /** The module with its autoimports; `undefined` when nothing changes. */
  transform(code: string, id: string): string | undefined;
  /**
   * The files a path alias of the project (`~/`, `@/`, `#shared/`, `#server/` and those of `alias`)
   * names from `importer`, in order; `undefined` when `specifier` has no alias. Throws `MEEK108` or
   * `MEEK118` for an alias that the importer's folder does not see.
   */
  resolveAlias?(specifier: string, importer: string): readonly string[] | undefined;
}

const configFiles = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"];
const meekoPackage = "@meekojs/meeko";
/** Framework APIs for components and the running app: `signal`, `useState`, `defineApiRoute`… */
const frameworkSpecifiers: ReadonlySet<string> = new Set([meekoPackage, `${meekoPackage}/framework`, `${meekoPackage}/server`]);

/**
 * The Meeko project of `file`: the nearest folder with a `meeko.config.*` up to the nearest
 * `package.json`, or the folder of that `package.json` when it depends on `@meekojs/meeko`.
 * `undefined` outside a Meeko project.
 */
export function meekoProjectRoot(file: string): string | undefined {
  let directory = dirname(resolve(file));
  for (;;) {
    if (configFiles.some((name) => existsSync(join(directory, name)))) return directory;
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) return dependsOnMeeko(manifest) ? directory : undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function dependsOnMeeko(manifest: string): boolean {
  try {
    const json = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some((field) => {
      const dependencies = json[field];
      return typeof dependencies === "object" && dependencies !== null && meekoPackage in dependencies;
    });
  } catch {
    return false;
  }
}

/** Reads the registry of `root` now; call it again to see added or removed exports. */
export async function utilityAutoImports(root: string): Promise<UtilityAutoImports> {
  const [autoimports, autoimportsTs, config, aliases, aliasMatching] = await Promise.all([
    import("../autoimports.js"), import("../autoimports-ts.js"), import("../framework/config.js"), import("../framework/aliases.js"), import("../compiler/aliases.js"),
  ]);
  const registry = await autoimports.discoverAutoImports(root);
  const sourceRoots = (await config.resolveConfigSources(root)).map((source) => source.root);
  const project = await aliases.resolveProjectAliases(root);
  const available = registry.filter((entry) => isAvailable(entry, autoimports.isGeneratedClient));
  const availableNames = new Set(available.map((entry) => entry.name));
  const unavailable = new Map<string, AutoImport>();
  for (const entry of registry) {
    if (!entry.typeOnly && !availableNames.has(entry.name) && !unavailable.has(entry.name)) unavailable.set(entry.name, entry);
  }
  const key = createHash("sha256").update(JSON.stringify([root, sourceRoots, registry, project.aliases])).digest("hex");
  return {
    root,
    key,
    resolveAlias(specifier, importer) {
      const match = aliasMatching.matchPathAlias(project.aliases, specifier);
      if (!match) return undefined;
      const scope = aliasMatching.aliasImporterScope(importer, project.sourceRoots);
      const problem = scope && aliasMatching.aliasScopeProblem(match.alias, scope, specifier);
      if (problem) throw new Error(`${problem.code}: ${relative(root, importer).replaceAll("\\", "/")}: ${problem.message}`);
      return match.alias.targets.map((target) => join(target, match.rest));
    },
    transform(code, id) {
      // Like the editor and `meeko check`: TypeScript under app/, shared/ or server/ of a source root.
      if (!/\.[cm]?ts$/.test(id) || /[\\/]node_modules[\\/]/.test(id)) return undefined;
      if (!autoimportsTs.typeScriptScope(root, id, sourceRoots)) return undefined;
      const transformed = autoimportsTs.transformTypeScriptAutoImports(code, id, root, available, sourceRoots) ?? code;
      const missing = new Map<string, AutoImport>();
      for (const reference of autoimports.freeReferences(code, id)) {
        const entry = reference.value ? unavailable.get(reference.name) : undefined;
        if (entry) missing.set(reference.name, entry);
      }
      if (missing.size === 0) return transformed === code ? undefined : transformed;
      const file = relative(root, id).replaceAll("\\", "/");
      const stubs = [...missing].map(([name, entry]) => `const ${name} = __meeko_unavailable(${JSON.stringify(unavailableMessage(file, entry, root, autoimports.isGeneratedClient))});`);
      // Static imports are hoisted, so the stubs can go first; the original body stays last.
      return `${unavailableFactory}\n${stubs.join("\n")}\n${transformed}`;
    },
  };
}

function isAvailable(entry: AutoImport, isGeneratedClient: (file: string) => boolean): boolean {
  return (entry.scope === "app" || entry.scope === "shared") && !entry.component && !isGeneratedClient(entry.file)
    && !(entry.specifier !== undefined && frameworkSpecifiers.has(entry.specifier));
}

/** A value that throws `message` on any use: reading it, calling it, comparing it… */
const unavailableFactory = "const __meeko_unavailable = (message) => { const fail = () => { throw new Error(message); }; "
  + "return new Proxy(function () {}, { get: fail, set: fail, has: fail, apply: fail, construct: fail, ownKeys: fail, "
  + "defineProperty: fail, deleteProperty: fail, getOwnPropertyDescriptor: fail, getPrototypeOf: fail, setPrototypeOf: fail }); };";

function unavailableMessage(file: string, entry: AutoImport, root: string, isGeneratedClient: (file: string) => boolean): string {
  const origin = entry.specifier ?? relative(root, entry.file).replaceAll("\\", "/");
  const reason = entry.component ? `es el componente ${origin}`
    : isGeneratedClient(entry.file) ? `es un cliente generado (${origin}), que sólo funciona con la aplicación en marcha`
    : entry.specifier !== undefined && frameworkSpecifiers.has(entry.specifier) ? `es una API de ${entry.specifier} para componentes y para la aplicación en marcha; si la necesita en Node, impórtela explícitamente`
    : entry.scope === "server" ? `viene de ${origin}, que sólo existe en el servidor`
    : entry.scope === "client" ? `viene de ${origin}, que sólo existe en el navegador`
    : `viene de ${origin}`;
  return `${file} usa el autoimport ${entry.name}, que no está disponible al generar el CSS de @utilities: ${reason}. `
    + "Los módulos de @utilities se ejecutan en Node y sólo reciben los autoimports de valores de app/ y shared/ "
    + "(con imports.appDirs, imports.sharedDirs, los layers y los módulos), sin los .client.ts ni los .server.ts; "
    + "lleve a una de esas carpetas lo que el CSS necesita.";
}
