import { readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ClassProvider } from '../modules/define-meeko-module'

/**
 * The external class providers of a project (see {@link ClassProvider}): what a module declares with
 * `meeko.addClassProvider` and the project in `css.classProviders`. They are data for the editor;
 * nothing here knows the tools they name.
 */

/** A provider after validation: every list present, without repeated ids. */
export type ResolvedClassProvider = Required<ClassProvider>

/** Where `meeko dev` and `meeko check` keep the providers of the modules, for an editor that does not run them. */
export const classProvidersManifestFile = join('.meeko', 'manifests', 'class-providers.json')

/** A VS Code extension id: `publisher.name`. */
const extensionId = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/i
/** A language id of an editor (`tailwindcss`, `postcss`). */
const languageId = /^[a-z][a-z0-9._+-]*$/i
const providerFields = ['name', 'vscode', 'languages']
/** The manifest is small; a larger file is not one Meeko wrote. */
const maximumManifestBytes = 64 * 1024

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

function idList(value: unknown, pattern: RegExp, label: string, example: string): string[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !pattern.test(entry))) throw new TypeError(`${label} debe ser un array de ids como ${example}`)
	return [...new Set(value as string[])]
}

/**
 * Validates one declaration and returns it with every list present. `label` names it in the
 * messages, such as `meeko.config.ts: css.classProviders[0]`.
 */
export function normalizeClassProvider(value: unknown, label: string): ResolvedClassProvider {
	if (!isPlainObject(value)) throw new TypeError(`${label} debe ser un objeto { name, vscode?, languages? }`)
	for (const key of Object.keys(value)) if (!providerFields.includes(key)) throw new TypeError(`${label}: campo desconocido ${key}; se admiten ${providerFields.join(', ')}`)
	if (typeof value.name !== 'string' || !value.name.trim()) throw new TypeError(`${label}.name debe ser un texto no vacío, como "Tailwind CSS"`)
	const languages = idList(value.languages, languageId, `${label}.languages`, '"tailwindcss"')
	if (languages.includes('meeko')) throw new TypeError(`${label}.languages no puede incluir "meeko": son los lenguajes de las hojas CSS de la herramienta`)
	return { name: value.name.trim(), vscode: idList(value.vscode, extensionId, `${label}.vscode`, '"bradlc.vscode-tailwindcss"'), languages }
}

/** Validates a list of declarations, as `css.classProviders` is. */
export function normalizeClassProviders(value: unknown, label: string): ResolvedClassProvider[] {
	if (value === undefined) return []
	if (!Array.isArray(value)) throw new TypeError(`${label} debe ser un array de proveedores { name, vscode?, languages? }`)
	return value.map((entry, index) => normalizeClassProvider(entry, `${label}[${index}]`))
}

/** Joins lists of providers; two with the same name are one, with the ids of both. */
export function mergeClassProviders(...lists: readonly (readonly ResolvedClassProvider[])[]): ResolvedClassProvider[] {
	const byName = new Map<string, { name: string; vscode: Set<string>; languages: Set<string> }>()
	for (const provider of lists.flat()) {
		const entry = byName.get(provider.name) ?? { name: provider.name, vscode: new Set<string>(), languages: new Set<string>() }
		byName.set(provider.name, entry)
		for (const id of provider.vscode) entry.vscode.add(id)
		for (const id of provider.languages) entry.languages.add(id)
	}
	return [...byName.values()].map(({ name, vscode, languages }) => ({ name, vscode: [...vscode], languages: [...languages] }))
}

/**
 * Writes the providers to {@link classProvidersManifestFile}, or removes the file when there are
 * none. A file with the same contents keeps its date, so file watchers stay quiet.
 */
export async function writeClassProvidersManifest(projectRoot: string, providers: readonly ResolvedClassProvider[]): Promise<void> {
	const file = join(projectRoot, classProvidersManifestFile)
	if (!providers.length) {
		await rm(file, { force: true })
		return
	}
	const source = `${JSON.stringify({ version: 1, providers }, null, '\t')}\n`
	const previous = await readFile(file, 'utf8').catch(() => undefined)
	if (previous === source) return
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, source)
}

/**
 * The providers of {@link classProvidersManifestFile}, read without running anything; `[]` when
 * the file is missing, too large or not a valid manifest.
 */
export function readClassProvidersManifestSync(projectRoot: string): ResolvedClassProvider[] {
	const file = join(projectRoot, classProvidersManifestFile)
	try {
		const stat = statSync(file, { throwIfNoEntry: false })
		if (!stat?.isFile() || stat.size > maximumManifestBytes) return []
		const manifest = JSON.parse(readFileSync(file, 'utf8')) as unknown
		if (!isPlainObject(manifest) || manifest.version !== 1) return []
		return normalizeClassProviders(manifest.providers, classProvidersManifestFile)
	} catch {
		return []
	}
}
