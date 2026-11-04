import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Both documentation apps serve the same committed logo and licensed font.
const source = fileURLToPath(new URL('../assets/', import.meta.url))
const output = resolve('public')
await mkdir(output, { recursive: true })
await cp(source, output, { recursive: true })
