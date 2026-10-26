import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Servidor de lenguaje elegido para un workspace. */
export interface ResolvedLanguageServer {
  /** Módulo Node que arranca el servidor. */
  readonly module: string;
  /** `workspace` si es el de `node_modules/@meekojs/meeko` del proyecto; `bundled` si es el incluido. */
  readonly source: "workspace" | "bundled";
  /** Versión del paquete Meeko del proyecto cuando se usa su servidor. */
  readonly version?: string;
  /** Motivo por el que se recurrió al servidor incluido, si lo hay. */
  readonly reason?: string;
}

export interface LanguageServerSearch {
  /** Carpetas del workspace, en orden de preferencia. */
  readonly folders: readonly string[];
  /** Ruta del servidor incluido en la extensión. */
  readonly bundled: string;
  /** `false` en workspaces no confiables: nunca se ejecuta código del proyecto. */
  readonly preferWorkspace: boolean;
}

interface PackageManifest {
  readonly version?: string;
  readonly bin?: string | Readonly<Record<string, string>>;
}

/**
 * Prefiere el servidor del paquete `@meekojs/meeko` instalado en el proyecto, para que el
 * editor use la misma versión que el compilador, y recurre al servidor incluido si no existe
 * o es anterior a `meeko-language-server`.
 */
export function resolveLanguageServer(search: LanguageServerSearch): ResolvedLanguageServer {
  const bundled = (reason: string): ResolvedLanguageServer => ({ module: search.bundled, source: "bundled", reason });
  if (!search.preferWorkspace) return bundled("el workspace no es de confianza o el servidor del workspace está desactivado");
  let outdated: string | undefined;
  for (const folder of search.folders) {
    let directory = resolve(folder);
    for (;;) {
      const manifestPath = join(directory, "node_modules", "@meekojs", "meeko", "package.json");
      if (existsSync(manifestPath)) {
        let manifest: PackageManifest;
        try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest; }
        catch { manifest = {}; }
        const bin = typeof manifest.bin === "object" ? manifest.bin["meeko-language-server"] : undefined;
        const module = bin ? resolve(dirname(manifestPath), bin) : undefined;
        if (module && existsSync(module)) {
          return { module, source: "workspace", ...(manifest.version ? { version: manifest.version } : {}) };
        }
        outdated ??= `@meekojs/meeko ${manifest.version ?? "(versión desconocida)"} en ${dirname(manifestPath)} no incluye servidor de lenguaje`;
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return bundled(outdated ?? "no se encontró el paquete @meekojs/meeko en el workspace");
}
