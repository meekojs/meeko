// The light half of `@meekojs/ui/editor`: no Crepe here. The component loads ./crepe with `import()`
// in the browser, and the module that registers it is `@meekojs/ui/editor/module`.
export { createMarkdownSplicer, splitMarkdownSource } from './splice'
export type { MarkdownBlockNode, MarkdownBlockParser, MarkdownSource, MarkdownSplicer } from './splice'
export type { UIMarkdownEditorMode, UIMarkdownEditorProps } from '../app/types/markdown-editor'
