import { type Config } from 'prettier'

const config: Config = {
	plugins: ['@meekojs/prettier-plugin', 'prettier-plugin-css-order', 'prettier-plugin-packagejson'],
	cssDeclarationSorterKeepOverrides: false,
	cssDeclarationSorterOrder: 'concentric-css',
	endOfLine: 'auto',
	htmlWhitespaceSensitivity: 'ignore',
	meekoIndentSections: true,
	meekoSortClasses: 'stylesheet',
	printWidth: 800,
	semi: false,
	singleAttributePerLine: true,
	singleQuote: true,
	tabWidth: 2,
	useTabs: true,
}

export default config
