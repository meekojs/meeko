import { defineServerMiddleware } from '@meekojs/meeko/server'
import { livenessResponse } from 'meeko-docs-content/liveness'

// GET/HEAD /healthz for the healthcheck of the container and Coolify: always 200 while the process
// serves, with the state of the documentation database (up, down or unconfigured) and nothing else.
export default defineServerMiddleware((request, next) => livenessResponse(request) ?? next(request))
