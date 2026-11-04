import { defineUtilities } from '@meekojs/meeko/postcss'

export default defineUtilities(({ rule }) => rule('.meeko-probe', { 'border-top-width': '3px', 'border-top-style': 'solid' }))
