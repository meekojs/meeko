/**
 * Lógica sin `vscode` de los proveedores externos de clases (Tailwind CSS, UnoCSS…) que declara un
 * proyecto Meeko: qué responde el servidor a `meeko/classProviders` y qué añade la extensión a la
 * sección `meeko.classes` que el servidor pide con `workspace/configuration`.
 */

/** Petición del servidor (desde `@meekojs/meeko` 1.12) con los proveedores del proyecto de un documento. */
export const classProvidersMethod = 'meeko/classProviders'

/** La extensión que el `tailwindActive` de los servidores anteriores a 1.12 comprueba. */
export const legacyTailwindExtension = 'bradlc.vscode-tailwindcss'

/** Un proveedor tal como lo describe el servidor. */
export interface ClassProviderInfo {
	readonly name: string
	/** Ids de las extensiones de VS Code que atienden sus clases. */
	readonly vscode: readonly string[]
	readonly languages: readonly string[]
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** Los proveedores de una respuesta de `meeko/classProviders`; cualquier otra cosa no declara ninguno. */
export function providersFromResponse(value: unknown): ClassProviderInfo[] {
	const providers = value && typeof value === 'object' ? (value as { providers?: unknown }).providers : undefined
	if (!Array.isArray(providers)) return []
	return providers.flatMap((provider: unknown) => {
		if (!provider || typeof provider !== 'object') return []
		const { name, vscode, languages } = provider as Record<string, unknown>
		return typeof name === 'string' ? [{ name, vscode: strings(vscode), languages: strings(languages) }] : []
	})
}

/**
 * Pide los proveedores al servidor. Uno anterior a 1.12 no conoce la petición y responde con un
 * error (`MethodNotFound`); como cualquier otro fallo, cuenta como un proyecto sin proveedores.
 */
export async function requestClassProviders(send: () => Promise<unknown>): Promise<ClassProviderInfo[]> {
	try {
		return providersFromResponse(await send())
	} catch {
		return []
	}
}

/** Las extensiones de los proveedores que están activas, cada una una vez y como las nombra el proveedor. */
export function activeProviderExtensions(providers: readonly ClassProviderInfo[], isActive: (id: string) => boolean): string[] {
	return [...new Set(providers.flatMap((provider) => provider.vscode))].filter((id) => isActive(id))
}

/**
 * La sección `meeko.classes` para el servidor: los ajustes del usuario más `activeExtensions`, que
 * lee un servidor desde 1.12 (también vacío: así sabe que el cliente conoce los proveedores), y
 * `tailwindActive`, calculado como siempre para un servidor anterior, que ignora lo otro.
 */
export function classSettingsForServer(value: unknown, providers: readonly ClassProviderInfo[], isActive: (id: string) => boolean): Record<string, unknown> {
	const settings = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
	return { ...settings, activeExtensions: activeProviderExtensions(providers, isActive), tailwindActive: isActive(legacyTailwindExtension) }
}
