import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'

// Declara las dependencias de las plantillas al generar sus tipos adyacentes.
export default defineMeekoConfig({ modules: [ui], theme: true })
