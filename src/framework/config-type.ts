export interface MeekoConfig {
  /** Layers are applied after the application, in declaration order. Collisions fail. */
  readonly extends?: readonly string[];
  /** Modules use the same app/pages convention as layers. */
  readonly modules?: readonly string[];
  readonly imports?: { readonly serverDirs?: readonly string[] };
}

export function defineMeekoConfig<const T extends MeekoConfig>(config: T): T {
  return config;
}
