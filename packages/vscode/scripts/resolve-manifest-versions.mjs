const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/**
 * Sustituye los protocolos de pnpm (`catalog:`, `workspace:`) por la versión instalada en `node_modules`.
 * npm y vsce no entienden esos protocolos; la versión instalada es la que fijó el lockfile.
 * @param {Record<string, unknown>} manifest Manifiesto que se modifica en el sitio.
 * @param {(name: string) => string} installedVersion Devuelve la versión instalada de una dependencia.
 * @returns {string[]} Dependencias sustituidas.
 */
export function resolveManifestVersions(manifest, installedVersion) {
	const resolved = []
	for (const section of sections) {
		const dependencies = /** @type {Record<string, string> | undefined} */ (manifest[section])
		for (const [name, range] of Object.entries(dependencies ?? {})) {
			if (!/^(?:catalog|workspace):/.test(range)) continue
			dependencies[name] = installedVersion(name)
			resolved.push(name)
		}
	}
	return resolved
}
