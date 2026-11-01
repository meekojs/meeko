#!/bin/sh
# Release de contenido contra la base de producción: ejecuta la imagen `content` del commit
# (deploy/release.sh: db:migrate, docs:import y docs:sync) en la red `coolify`, la única desde la que
# se alcanza la base, que no publica puerto. DATABASE_URL llega del secreto del pipeline y se pasa
# por nombre (`-e DATABASE_URL`), nunca como valor en los argumentos.
set -eu
. deploy/ci-common.sh

: "${DATABASE_URL:?DATABASE_URL is required}"
network=${MEEKOJS_DATABASE_NETWORK:-coolify}

registry_login
image="$(image_name content):$CI_COMMIT_SHA"
docker pull --quiet "$image" >/dev/null
docker run --rm \
	--name "meekojs-release-$(printf '%s' "$CI_COMMIT_SHA" | cut -c1-12)" \
	--network "$network" \
	--memory 3g \
	--env DATABASE_URL \
	"$image"
