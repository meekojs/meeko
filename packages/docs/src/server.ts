import { defineServerRuntime, MemorySessionStore, SessionManager } from '@meekojs/meeko/server'

// Las webs documentales son públicas: no crean cuentas ni sesiones persistentes.
// Sólo el manager admite memoria; el runtime de producción conserva su política de errores.
export default defineServerRuntime(() => ({
	sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
}))
