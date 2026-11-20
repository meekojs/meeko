import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin'

import { type Config } from 'prettier'

const config: Config & MeekoPrettierOptions & { cssDeclarationSorterKeepOverrides: boolean; cssDeclarationSorterOrder: 'concentric-css' } = {
	plugins: ['@meekojs/prettier-plugin', 'prettier-plugin-css-order', 'prettier-plugin-packagejson'],
	cssDeclarationSorterKeepOverrides: false,
	cssDeclarationSorterOrder: 'concentric-css',
	endOfLine: 'auto',
	// The plugin keeps the text of a template only with 'css' or 'strict': 'ignore' hands the whitespace to Prettier's HTML printer, which adds or drops visible spaces (a space before a comma after <code>).
	htmlWhitespaceSensitivity: 'css',
	meekoIndentSections: true,
	overrides: [
		// The examples of the documentation are `html` fences in Meeko syntax. Prettier's HTML parser would
		// change what they say: `<Content />` becomes `<content />` and a lone `<form>` gets closed.
		{ files: '*.md', options: { embeddedLanguageFormatting: 'off' } },
		// The whitespace between the tags of these templates would be text in their buttons and options
		// (tests/templates-without-whitespace.test.mjs): `ignore` breaks the tags into lines, `strict` keeps
		// the whitespace as written and only breaks inside the tags.
		// The same holds for the core components (their compiled copies in src/builtins/ are generated from
		// these sources) and for the example whose list items render their text without whitespace.
		{ files: ['packages/meeko/src/app/components/{MeekoAwait,MeekoLink,MeekoPopover,MeekoSelect,MeekoThemeToggle}/*.meeko', 'packages/meeko/examples/primitives/Primitives.meeko'], options: { htmlWhitespaceSensitivity: 'strict' } },
		{ files: '**/src/{app/components/{CodeBlock,Combobox,CommandPalette,CopyButton,DescriptionList,Diff,Drawer,Hint,IconButton,LocaleSuggestion,Menu,Modal,PageHeader,Popover,SegmentedControl,Select,Stat,Tabs,ThemeToggle,Tooltip},editor/components/MarkdownEditor}.meeko', options: { htmlWhitespaceSensitivity: 'strict' } },
	],
	printWidth: 800,
	semi: false,
	singleAttributePerLine: true,
	singleQuote: true,
	tabWidth: 2,
	useTabs: true,
}

export default config
