import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin'

import { type Config } from 'prettier'

const config: Config & MeekoPrettierOptions & { cssDeclarationSorterKeepOverrides: boolean; cssDeclarationSorterOrder: 'concentric-css' } = {
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
		// The whitespace between the tags of these templates would be text in their buttons and options
		// (tests/templates-without-whitespace.test.mjs): `ignore` breaks the tags into lines, `strict` keeps
		// the whitespace as written and only breaks inside the tags.
		{ files: '**/src/app/components/{Combobox,CommandPalette,DescriptionList,Drawer,LocaleSuggestion,Modal,PageHeader,Popover,Select,Tabs,ThemeToggle,Tooltip}.meeko', options: { htmlWhitespaceSensitivity: 'strict' } },
	],
	printWidth: 800,
	semi: false,
	singleAttributePerLine: true,
	singleQuote: true,
	tabWidth: 2,
	useTabs: true,
}

export default config
