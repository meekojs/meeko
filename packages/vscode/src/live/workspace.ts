import { isAbsolute, relative, sep } from 'node:path'

/** Returns a non-empty relative path only for a resource below the local root. */
export function localWorkspacePath(root: string, resource: string): string | undefined {
	const path = relative(root, resource)
	return path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path) ? path : undefined
}

/** Keeps one set of disposables per local workspace folder and returns newly watched folders. */
export function reconcileWatchedFolders<Folder extends { uri: { scheme: string; toString(): string } }>(folders: readonly Folder[], watched: Map<string, { dispose(): void }[]>, subscribe: (folder: Folder) => { dispose(): void }[]): Folder[] {
	const local = folders.filter((folder) => folder.uri.scheme === 'file')
	const current = new Set(local.map((folder) => folder.uri.toString()))
	for (const [key, disposables] of watched) {
		if (current.has(key)) continue
		for (const disposable of disposables) disposable.dispose()
		watched.delete(key)
	}
	const added: Folder[] = []
	for (const folder of local) {
		const key = folder.uri.toString()
		if (watched.has(key)) continue
		watched.set(key, subscribe(folder))
		added.push(folder)
	}
	return added
}
