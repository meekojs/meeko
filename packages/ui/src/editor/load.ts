import type { createMarkdownEditor } from './crepe'

/**
 * Loads the heavy half in the browser. On the server it is `null`: Vite replaces `import.meta.env.SSR`
 * and removes the import, so that neither Crepe nor its Vue reach the server bundle.
 */
export const loadMarkdownEditor: (() => Promise<{ createMarkdownEditor: typeof createMarkdownEditor }>) | null = import.meta.env.SSR ? null : () => import('./crepe')
