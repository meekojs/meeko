#!/bin/sh
# Funciones comunes de los pasos de Woodpecker de meekojs.com (.woodpecker/web.yml). Se cargan con
# `. deploy/ci-common.sh` desde un contenedor docker:29-cli del agente de voidcat-local, con el socket
# de Docker y el certificado del registry montados, como en mt, cdn, Quantum y Vuno.
set -eu

: "${CI_COMMIT_SHA:?CI_COMMIT_SHA is required}"
: "${REGISTRY_HOST:?REGISTRY_HOST is required}"

# Las imágenes de cada destino: <registry>/meekojs/<nombre>:<SHA>.
image_name() {
	printf '%s/meekojs/%s' "$REGISTRY_HOST" "$1"
}

# Los destinos que pide el pipeline manual (MEEKOJS_TARGETS), o las tres webs públicas. El dashboard
# solo entra si se nombra y MEEKOJS_DASHBOARD_READY=true (F5 terminado): docs/deploy-meekojs.md, paso 8.
targets() {
	list=${MEEKOJS_TARGETS:-meeko ui i18n}
	for target in $list; do
		case "$target" in
			meeko | ui | i18n) ;;
			dashboard)
				if [ "${MEEKOJS_DASHBOARD_READY:-}" != "true" ]; then
					echo "El dashboard no se publica hasta que F5 esté terminado (MEEKOJS_DASHBOARD_READY=true)." >&2
					exit 1
				fi
				;;
			*)
				echo "Destino desconocido en MEEKOJS_TARGETS: $target (meeko, ui, i18n o dashboard)." >&2
				exit 1
				;;
		esac
	done
	printf '%s\n' "$list"
}

# El contenedor del paso no hereda MagicDNS, pero el host del agente sí: resuelve el registry desde
# el host, confía en su CA e inicia sesión. Necesita REGISTRY_USERNAME y REGISTRY_PASSWORD.
registry_login() {
	: "${REGISTRY_USERNAME:?REGISTRY_USERNAME is required}"
	: "${REGISTRY_PASSWORD:?REGISTRY_PASSWORD is required}"
	registry_name=${REGISTRY_HOST%%:*}
	registry_ip=$(docker run --rm --network host alpine:3.22 getent hosts "$registry_name" | awk 'NR == 1 { print $1 }')
	if [ -z "$registry_ip" ]; then
		echo "No se pudo resolver el registry $registry_name desde el host del agente." >&2
		exit 1
	fi
	printf '%s %s\n' "$registry_ip" "$registry_name" >>/etc/hosts
	export SSL_CERT_FILE=/opt/woodpecker/certs/registry-ca.crt
	printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" --username "$REGISTRY_USERNAME" --password-stdin >/dev/null
}
