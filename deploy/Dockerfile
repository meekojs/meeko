# syntax=docker/dockerfile:1.7
#
# Imágenes de meekojs.com (docs/deploy-meekojs.md). Un solo Dockerfile para el monorepo pnpm, con un
# target por tipo de imagen. Se construye desde la raíz del repositorio; el .dockerignore que aplica
# es deploy/Dockerfile.dockerignore:
#
#   docker build -f deploy/Dockerfile --target web --build-arg APP=meeko .   # meekojs.com
#   docker build -f deploy/Dockerfile --target web --build-arg APP=ui .      # ui.meekojs.com
#   docker build -f deploy/Dockerfile --target web --build-arg APP=i18n .    # i18n.meekojs.com
#   docker build -f deploy/Dockerfile --target content .                     # release: migrar, importar y sincronizar
#   docker build -f deploy/Dockerfile --target dashboard .                   # dashboard.meekojs.com (bloqueado hasta F5)
#
# - web: la salida de `meeko build` (.meeko/output/node) con las dependencias de producción de su app
#   (`pnpm deploy --prod`), sin el resto del monorepo. El render de la documentación no está aquí: las
#   webs leen el snapshot de PostgreSQL.
# - content: el monorepo completo (docs/, el código de los paquetes para el JSDoc, la taxonomía y las
#   dependencias de desarrollo, Vite y TypeScript incluidos), porque `docs:import` y `docs:sync`
#   renderizan desde esos archivos con Vite. Es una imagen de una sola ejecución.
# - dashboard: content más el build del dashboard. Sus trabajos de importación, publicación, salud y
#   vista previa son procesos hijo que cargan meeko-docs-content con Vite sobre el mismo árbol.

ARG NODE_BUILD=node:24-bookworm
ARG NODE_RUNTIME=node:24-bookworm-slim

# ---------------------------------------------------------------------------------------------------
# El workspace instalado y los paquetes que consumen las webs construidos.
FROM ${NODE_BUILD} AS workspace
ENV PNPM_HOME=/pnpm \
	PATH=/pnpm:$PATH \
	COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
	CI=true \
	NODE_OPTIONS=--max-old-space-size=8192
WORKDIR /repo
# pnpm sale de `packageManager` del package.json raíz (pnpm@12.14.0): una sola fuente.
COPY package.json ./
RUN corepack enable && corepack prepare --activate && pnpm --version
COPY . .
RUN --mount=type=cache,id=meekojs-pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --store-dir /pnpm/store
# El núcleo, UI, i18n, icon y la base documental, en orden topológico. Cada módulo que carga una app
# debe estar aquí: `meeko build` lo lee de su dist (scripts/deploy-dockerfile.test.mjs lo comprueba).
RUN pnpm -r --filter @meekojs/meeko --filter @meekojs/ui --filter @meekojs/i18n --filter @meekojs/icon --filter meeko-docs run build

# ---------------------------------------------------------------------------------------------------
# Build de una web pública y sus dependencias de producción en /out.
FROM workspace AS web-build
ARG APP
RUN set -eu; \
	case "${APP:-}" in \
		meeko) package=meeko-site ;; \
		ui) package=meeko-ui-site ;; \
		i18n) package=meeko-i18n-site ;; \
		*) echo "APP must be meeko, ui or i18n, not '${APP:-}'" >&2; exit 1 ;; \
	esac; \
	pnpm -F "$package" run build; \
	pnpm -F "$package" deploy --prod /out; \
	rm -rf /out/.meeko /out/.env; \
	mkdir -p /out/.meeko; \
	cp -a "apps/$APP/.meeko/output" /out/.meeko/output; \
	test -f /out/.meeko/output/node/index.mjs

# ---------------------------------------------------------------------------------------------------
FROM ${NODE_RUNTIME} AS web
ENV NODE_ENV=production \
	MEEKO_HOST=0.0.0.0 \
	MEEKO_PORT=3000
WORKDIR /app
# Todo pertenece a root y es de solo lectura para el proceso: el servidor no escribe en disco.
COPY --from=web-build /out ./
USER node
EXPOSE 3000
# /healthz responde 200 mientras el proceso atiende; el estado de la base va en el cuerpo y no
# decide la salud, porque las webs degradan sin ella. 127.0.0.1 y no localhost: en estas imágenes
# localhost puede resolver a ::1 y el servidor escucha en 0.0.0.0.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# `meeko start` en forma exec: el shim de pnpm hace `exec node`, así que Node es el PID 1, recibe el
# SIGTERM de Coolify y cierra las conexiones en curso antes de salir.
CMD ["node_modules/.bin/meeko", "start", "."]

# ---------------------------------------------------------------------------------------------------
# El monorepo para el release de contenido (deploy/release.sh) y para el dashboard.
FROM ${NODE_RUNTIME} AS content
ENV PNPM_HOME=/pnpm \
	PATH=/pnpm:$PATH \
	COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
	NODE_OPTIONS=--max-old-space-size=8192
WORKDIR /repo
COPY --from=workspace /repo /repo
# Vite puede escribir su caché junto a la raíz que carga; es lo único escribible por `node`.
RUN mkdir -p apps/meeko/node_modules/.vite apps/dashboard/node_modules/.vite \
	&& chown -R node:node apps/meeko/node_modules/.vite apps/dashboard/node_modules/.vite
USER node
# Idempotente: migraciones registradas, importación sin cambios en revisiones y un snapshot nuevo
# que solo se activa si el render termina. Necesita DATABASE_URL.
CMD ["sh", "deploy/release.sh"]

# ---------------------------------------------------------------------------------------------------
FROM workspace AS dashboard-build
# NODE_ENV=production en el build: meeko.config.ts del dashboard escucha entonces en 0.0.0.0.
RUN NODE_ENV=production pnpm -F meeko-dashboard run build && test -f apps/dashboard/.meeko/output/node/index.mjs

# ---------------------------------------------------------------------------------------------------
FROM content AS dashboard
USER root
COPY --from=dashboard-build /repo/apps/dashboard/.meeko /repo/apps/dashboard/.meeko
COPY --from=dashboard-build /repo/packages/docs /repo/packages/docs
ENV NODE_ENV=production \
	MEEKO_HOST=0.0.0.0 \
	MEEKO_PORT=3000
WORKDIR /repo/apps/dashboard
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node_modules/.bin/meeko", "start", "."]
