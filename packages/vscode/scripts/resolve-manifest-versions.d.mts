/**
 * Sustituye los protocolos de pnpm (`catalog:`, `workspace:`) por la versión instalada en `node_modules`.
 * @param manifest Manifiesto que se modifica en el sitio.
 * @param installedVersion Devuelve la versión instalada de una dependencia.
 * @returns Dependencias sustituidas.
 */
export function resolveManifestVersions(manifest: Record<string, unknown>, installedVersion: (name: string) => string): string[]
