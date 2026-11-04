/** The sheets of Crepe that `crepe.ts` imports for Vite: they have no declarations of their own. */
declare module '@milkdown/crepe/theme/common/*'

/** What `load.ts` reads from Vite, which this package does not depend on. */
interface ImportMeta {
	readonly env: { readonly SSR: boolean }
}
