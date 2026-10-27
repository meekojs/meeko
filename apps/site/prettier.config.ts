import { type Config } from 'prettier'

const config: Config = {
	plugins: ['@meekojs/meeko/prettier', 'prettier-plugin-css-order'],
	cssDeclarationSorterKeepOverrides: false,
	cssDeclarationSorterOrder: 'concentric-css',
	endOfLine: 'auto',
	htmlWhitespaceSensitivity: 'ignore',
	meekoIndentSections: true,
	printWidth: 800,
	semi: false,
	singleQuote: true,
	singleAttributePerLine: true,
	tabWidth: 2,
	useTabs: true,
}

export default config
