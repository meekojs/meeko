/** Runtime targeted by `meeko build`; each adapter writes `.meeko/output/<adapter>/`. */
export type MeekoServerConfig =
  | {
    readonly adapter: "node";
    /** Interface used by `meeko start`. Defaults to 127.0.0.1; HOST overrides it. */
    readonly host?: string;
    /** Port used by `meeko start`. Defaults to 4173; PORT overrides it. */
    readonly port?: number;
  }
  | {
    readonly adapter: "cloudflare";
    /** Worker name in the generated `wrangler.jsonc`. Defaults to the package name. */
    readonly name?: string;
    /** Durable Object class exported for Socket rooms. Defaults to `MeekoSocketRoom`. */
    readonly socketClassName?: string;
    /** Workers compatibility date (`YYYY-MM-DD`). Defaults to the date Meeko is tested with. */
    readonly compatibilityDate?: string;
    /**
     * Extra `wrangler.jsonc` fields, such as `d1_databases`, `vars` or `routes`.
     * `compatibility_flags` and `durable_objects.bindings` are combined with
     * Meeko's. The Socket room class gets Meeko's migration only when there are
     * no `migrations`; an existing history must create it itself, and an
     * `exports` map gets its entry. `main`, `assets`, `no_bundle` and
     * `find_additional_modules` belong to Meeko.
     */
    readonly wrangler?: Readonly<Record<string, unknown>>;
  }
  | { readonly adapter: "deno" }
  | { readonly adapter: "bun" };

export type MeekoAdapterName = MeekoServerConfig["adapter"];

export interface MeekoConfig {
  /** Layers are applied after the application, in declaration order. Collisions fail. */
  readonly extends?: readonly string[];
  /** Modules use the same app/pages convention as layers. */
  readonly modules?: readonly string[];
  readonly imports?: { readonly serverDirs?: readonly string[] };
  /** Production server target. Defaults to `{ adapter: "node" }`. */
  readonly server?: MeekoServerConfig;
}

export function defineMeekoConfig<const T extends MeekoConfig>(config: T): T {
  return config;
}
