#!/bin/sh
# Construye las imágenes de deploy/Dockerfile y las sube al registry de voidcat-local con el SHA del
# commit como etiqueta: las webs de MEEKOJS_TARGETS y siempre `content` (el release de contenido).
# Lo ejecuta el paso `images` de .woodpecker/web.yml.
set -eu
. deploy/ci-common.sh

registry_login

builder=meekojs-builder
if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
	docker buildx create \
		--name "$builder" \
		--driver docker-container \
		--driver-opt network=host \
		--buildkitd-config /opt/woodpecker/buildkitd.toml
fi
docker buildx use "$builder"
docker buildx inspect --bootstrap >/dev/null

build() {
	name=$1
	shift
	image="$(image_name "$name"):$CI_COMMIT_SHA"
	echo "[images] $image"
	docker buildx build \
		--builder "$builder" \
		--file deploy/Dockerfile \
		--label "org.opencontainers.image.revision=$CI_COMMIT_SHA" \
		--label "org.opencontainers.image.source=https://github.com/meekojs/meeko" \
		--tag "$image" \
		--push \
		"$@" \
		.
	docker buildx imagetools inspect "$image" >/dev/null
}

# Asignado antes: un `exit` de `targets` dentro de `for … in $(…)` no detendría el script.
list=$(targets)
for target in $list; do
	case "$target" in
		dashboard) build dashboard --target dashboard ;;
		*) build "$target" --target web --build-arg "APP=$target" ;;
	esac
done
build content --target content
echo "[images] publicadas con la etiqueta $CI_COMMIT_SHA"
