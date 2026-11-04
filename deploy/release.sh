#!/bin/sh
# Release de contenido de meekojs.com contra la base de DATABASE_URL, en este orden:
#
# 1. db:migrate   aplica las migraciones pendientes de packages/docs-content en una transacción.
# 2. docs:import  actualiza las fuentes base del dashboard; nunca toca revisiones.
# 3. docs:sync    renderiza docs/, el JSDoc y la taxonomía con las revisiones publicadas y activa el
#                 snapshot nuevo en una transacción; si falla, sigue activo el anterior.
#
# Repetirlo es seguro: no aplica migraciones ya aplicadas, la importación es idempotente y el snapshot
# nuevo tiene el mismo contenido (la base conserva los 5 últimos). Es el CMD de la imagen `content`
# de deploy/Dockerfile; en local, `sh deploy/release.sh` desde la raíz con DATABASE_URL definida.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
cd "$(dirname "$0")/.."

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

step() {
	name=$1
	shift
	echo "[release] $name"
	timeout "${RELEASE_STEP_TIMEOUT:-900}" node "$@"
}

step db:migrate apps/meeko/scripts/migrate-docs.mjs
step docs:import apps/meeko/scripts/import-docs.mjs
step docs:sync apps/meeko/scripts/sync-docs.mjs
echo "[release] done"
