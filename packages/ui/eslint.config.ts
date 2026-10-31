import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint(
	{
		// Los tres están activados por defecto.
		javascript: true,
		typescript: true,
		meeko: true,

		// Se añaden a las exclusiones predeterminadas.
		ignores: [
			'**/coverage/**',
			'**/.output/**',
		],

		rules: {
			// JavaScript

			'no-debugger': 'error',
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'prefer-const': 'error',

			// TypeScript
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],

			// Meeko
			'meeko/button-has-type': 'error',
			'meeko/no-autofocus': 'warn',
		},
	},

	// Configuraciones específicas: se aplican al final.
	{
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},

	{
		files: ['scripts/**/*.{js,mjs,cjs,ts}'],
		languageOptions: {
			globals: {
				process: 'readonly',
				Buffer: 'readonly',
				console: 'readonly',
			},
		},
		rules: {
			'no-console': 'off',
		},
	},
)
