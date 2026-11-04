#!/bin/sh
# Despliega en el Coolify de voidcat-local la imagen de cada destino de MEEKOJS_TARGETS: fija su
# etiqueta (el SHA del commit) en la app, lanza el deploy y espera a que termine. Coolify solo da el
# deploy por terminado cuando el contenedor nuevo pasa su HEALTHCHECK; si no, el anterior sigue
# sirviendo. Usa la API local publicada en el host (COOLIFY_API_URL) con el token de COOLIFY_TOKEN.
# Necesita jq y curl.
set -eu
. deploy/ci-common.sh

: "${COOLIFY_API_URL:?COOLIFY_API_URL is required}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"

# El token va en un archivo de cabeceras temporal, no en los argumentos de curl.
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
printf 'Authorization: Bearer %s\n' "$COOLIFY_TOKEN" >"$headers"

coolify() {
	curl --fail --silent --show-error --header "@$headers" --header 'Accept: application/json' "$@"
}

uuid_of() {
	case "$1" in
		meeko) printf '%s' "${COOLIFY_UUID_MEEKOJS_SITE:-}" ;;
		ui) printf '%s' "${COOLIFY_UUID_MEEKOJS_UI:-}" ;;
		i18n) printf '%s' "${COOLIFY_UUID_MEEKOJS_I18N:-}" ;;
		dashboard) printf '%s' "${COOLIFY_UUID_MEEKOJS_DASHBOARD:-}" ;;
	esac
}

deploy() {
	target=$1
	uuid=$(uuid_of "$target")
	if [ -z "$uuid" ]; then
		echo "Falta el UUID de Coolify de $target." >&2
		exit 1
	fi
	image=$(image_name "$target")
	payload=$(jq -cn --arg image "$image" --arg tag "$CI_COMMIT_SHA" '{docker_registry_image_name: $image, docker_registry_image_tag: $tag}')
	printf '%s' "$payload" | coolify --request PATCH --header 'Content-Type: application/json' --data-binary @- "$COOLIFY_API_URL/applications/$uuid" >/dev/null
	deployment=$(coolify --request POST "$COOLIFY_API_URL/deploy?uuid=$uuid" | jq -r '.deployments[0].deployment_uuid // empty')
	if [ -z "$deployment" ]; then
		echo "Coolify no devolvió un deployment para $target." >&2
		exit 1
	fi
	echo "[deploy] $target: $image:$CI_COMMIT_SHA (deployment $deployment)"
	attempt=0
	while [ "$attempt" -lt 120 ]; do
		attempt=$((attempt + 1))
		status=$(coolify "$COOLIFY_API_URL/deployments/$deployment" | jq -r '.status')
		case "$status" in
			finished)
				echo "[deploy] $target desplegado"
				return 0
				;;
			failed | cancelled-by-user)
				echo "Coolify terminó el deploy de $target con estado: $status" >&2
				exit 1
				;;
		esac
		sleep 5
	done
	echo "Coolify no terminó el deploy de $target en 10 minutos." >&2
	exit 1
}

# En serie: si una web falla, las siguientes no cambian y el pipeline queda en rojo.
# Asignado antes: un `exit` de `targets` dentro de `for … in $(…)` no detendría el script.
list=$(targets)
for target in $list; do
	deploy "$target"
done
