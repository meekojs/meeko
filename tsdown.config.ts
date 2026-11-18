import { defineConfig } from 'tsdown'

// Shared by the packages whose `build` runs `tsdown -c ../../tsdown.config.ts`: it builds the
// package of the working directory, one ESM module per source module, with its declarations.
export default defineConfig({
	cwd: process.cwd(),
	entry: ['src/**/*.ts'],
	unbundle: true,
	format: 'esm',
	target: 'es2022',
	fixedExtension: false,
	dts: true,
	sourcemap: true,
	deps: { neverBundle: true },
})
