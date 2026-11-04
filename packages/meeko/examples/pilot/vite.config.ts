import { meeko } from '@meekojs/meeko/vite'
import { defineConfig } from 'vite'

/** Transforma la misma fuente .meeko para SSR y para el navegador. */
export default defineConfig({ plugins: [meeko()] })
