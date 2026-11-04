import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin'

import { type Config } from 'prettier'

const config: Config &
	MeekoPrettierOptions & {
		cssDeclarationSorterKeepOverrides: boolean
		cssDeclarationSorterOrder: 'concentric-css'
	} = {
	plugins: ['@meekojs/prettier-plugin', 'prettier-plugin-css-order', 'prettier-plugin-packagejson'],
	cssDeclarationSorterKeepOverrides: false,
	cssDeclarationSorterOrder: 'concentric-css',
	endOfLine: 'auto',
	htmlWhitespaceSensitivity: 'ignore',
	meekoIndentSections: true,
	overrides: [
		// The examples of the documentation are `html` fences in Meeko syntax. Prettier's HTML parser would
		// change what they say: `<Content />` becomes `<content />` and a lone `<form>` gets closed.
		{ files: '*.md', options: { embeddedLanguageFormatting: 'off' } },
	],
	printWidth: 800,
	semi: false,
	singleAttributePerLine: true,
	singleQuote: true,
	tabWidth: 2,
	useTabs: true,
}

export default config
