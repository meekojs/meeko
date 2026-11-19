import { defineServerMiddleware } from '@meekojs/meeko/server'
import { livenessResponse } from 'meeko-docs-content/liveness'

/** Salud de las webs documentales: conserva 200 aun sin base de datos. */
export default defineServerMiddleware((request, next) => livenessResponse(request) ?? next(request))
