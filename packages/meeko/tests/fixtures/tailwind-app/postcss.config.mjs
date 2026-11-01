import { meekoUtilities } from '@meekojs/meeko/postcss'
import tailwindcss from '@tailwindcss/postcss'

// meekoUtilities() first: Tailwind then sees plain rules where @utilities was.
export default { plugins: [meekoUtilities(), tailwindcss()] }
