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
    /** Durable Object class exported for Socket rooms. */
    readonly socketClassName?: string;
    readonly compatibilityDate?: string;
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
