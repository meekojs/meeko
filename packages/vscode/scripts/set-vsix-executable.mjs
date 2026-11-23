import { readFileSync, writeFileSync } from 'node:fs'

import { setExecutable } from './vsix-archive.mjs'

const [archivePath, executablePath] = process.argv.slice(2)
if (!archivePath || !executablePath) throw new Error('Indica el VSIX y la ruta del ejecutable interno.')

const archive = readFileSync(archivePath)
setExecutable(archive, executablePath)
writeFileSync(archivePath, archive)
