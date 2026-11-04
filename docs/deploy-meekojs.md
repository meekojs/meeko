# Despliegue de meekojs.com en voidcat-local

Runbook para publicar las webs de Meeko en el Coolify de `voidcat-local`, detrás del túnel de Cloudflare `voidcat-local` y de Traefik. Cada paso que toca infraestructura tiene una casilla **Confirmar con el usuario**: no se ejecuta sin esa confirmación explícita, aunque los anteriores ya estén hechos. Los secretos nunca se escriben en este documento, en la consola ni en los logs: salen del archivo de secretos del host o de los secretos de Woodpecker.

| Dominio                 | App              | Paquete             | Imagen (`<registry>/meekojs/…`) | Estado                   |
| ----------------------- | ---------------- | ------------------- | ------------------------------- | ------------------------ |
| `meekojs.com`           | `apps/meeko`     | `meeko-site`        | `meeko`                         | Listo para desplegar     |
| `www.meekojs.com`       | `apps/meeko`     | —                   | — (301 a `meekojs.com`)         | Listo para desplegar     |
| `ui.meekojs.com`        | `apps/ui`        | `meeko-ui-site`     | `ui`                            | Listo para desplegar     |
| `i18n.meekojs.com`      | `apps/i18n`      | `meeko-i18n-site`   | `i18n`                          | Listo para desplegar     |
| `dashboard.meekojs.com` | `apps/dashboard` | `meeko-dashboard`   | `dashboard`                     | **Bloqueado por F5**     |
| —                       | release          | `deploy/release.sh` | `content`                       | Una ejecución por deploy |

`<registry>` es el valor del secreto `registry_host` (ver «Valores que no se versionan»).

## Cómo encaja

```text
navegador ─TLS─ Cloudflare ── túnel voidcat-local (cloudflared) ── http://localhost:80 (Traefik, coolify-proxy)
                                                                     └─ Host → contenedor de la app :3000 (red coolify)
                                                                                └─ PostgreSQL de producción (red coolify, sin puerto publicado)
```

- **Imágenes** (`deploy/Dockerfile`, un solo archivo con un target por imagen):
  - `web` (`--build-arg APP=meeko|ui|i18n`): la salida de `meeko build` y las dependencias de producción de la app (`pnpm deploy --prod`), sobre `node:24-bookworm-slim`, usuario `node`, `meeko start`, puerto 3000 y `HEALTHCHECK` contra `/healthz`. Unos 475 MB.
  - `content`: el monorepo entero, porque `docs:import` y `docs:sync` renderizan con Vite desde `docs/**`, el código de los paquetes (JSDoc), la taxonomía y `apps/*/app/utils/navigation.ts`. Su `CMD` es `deploy/release.sh`.
  - `dashboard`: `content` más el build del dashboard. Sus trabajos (importar, publicar, salud y vista previa) son procesos hijo que cargan `meeko-docs-content` con Vite sobre el mismo árbol, así que la imagen necesita el repositorio y las dependencias de desarrollo. No incluye `.git`: el historial de un archivo para resolver un conflicto de revisiones (`findGitVersion`) no está disponible y el detalle compara solo Git con la revisión.
- **Salud**: `GET /healthz` responde `200` con `{"status":"ok","database":"up|down|unconfigured"}` y `Cache-Control: no-store` mientras el proceso atiende (`meeko-docs-content/liveness`). La base no decide la salud, porque las webs degradan sin ella; el estado viaja en el cuerpo. Como mucho una consulta `SELECT 1` cada 5 s, en un pool de una conexión con 2 s de límite.
- **CI/CD**: `.woodpecker/web.yml`. Un push a `main` ejecuta gates, SonarQube (`meekojs-web`) y publica las imágenes con el SHA del commit. Un pipeline **manual** sobre `main` con `MEEKOJS_DEPLOY=true` hace además el release de contenido (`deploy/ci-release.sh`) y el deploy en Coolify (`deploy/ci-deploy.sh`). GitHub Actions (`.github/workflows/ci.yml`) sigue siendo la verificación completa del framework y de npm; Woodpecker solo entrega las webs, porque necesita el socket de Docker, el registry, la red `coolify` y la API local de Coolify de voidcat-local.

## Estado comprobado de la infraestructura (2026-10-31, solo lectura)

- Coolify 4.5.3 con un servidor (`localhost`) y el proyecto **`meeko`** ya creado. Las apps del host usan la red `coolify`, dominios `http://` (TLS en Cloudflare) y, cuando tienen healthcheck, `health_check_host=127.0.0.1`.
- La app **`meeko-site`** de Coolify sirve hoy el sitio estático (nginx) en `meeko.diegootayza.com`. Se queda como vuelta atrás: no se borra.
- El túnel `voidcat-local` (cloudflared con configuración remota) **ya enruta** `meekojs.com`, `www.meekojs.com`, `ui.meekojs.com`, `i18n.meekojs.com` y `dashboard.meekojs.com` a `http://localhost` (Traefik). Mientras Traefik no tenga un router para un host, responde `404`.
- El Docker del host ya confía en el registry y tiene sesión: Coolify puede tirar de las imágenes de `<registry>/meekojs/*`.
- Woodpecker: `meekojs/meeko` **no está activado** todavía. SonarQube oficial (`sonarqube-dev`): no hay proyecto meeko.
- Traefik no tiene `forwardedHeaders.trustedIPs` en el entrypoint `http` (ver «IP del cliente»).

## Variables por app

Sin valores reales: los secretos se cargan desde `/root/meekojs-produccion.secrets` del host (paso 1) con `jq`, sin imprimirlos. Las imágenes ya fijan `NODE_ENV=production`, `MEEKO_HOST=0.0.0.0` y `MEEKO_PORT=3000`.

### `apps/meeko` (meekojs.com)

| Variable                | Valor                                               | Notas                                                                        |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`          | `postgresql://meekojs_app:…@<db-uuid>:5432/meekojs` | Rol de la app (solo DML). Secreto.                                           |
| `MEEKO_PUBLIC_ORIGIN`   | `https://meekojs.com`                               | Los POST de métricas comparan `Origin` con él.                               |
| `SITE_CANONICAL_ORIGIN` | `https://meekojs.com`                               | Activa el `301` de `www.meekojs.com`. Un valor inválido detiene el arranque. |
| `MEEKO_TRUST_PROXY`     | `cloudflare`                                        | Ver «IP del cliente». Lee `CF-Connecting-IP` (Meeko 1.8).                    |
| `DOCS_METRICS`          | sin definir                                         | `off` desactiva vistas, búsquedas y «¿Te sirvió?».                           |

### `apps/ui` y `apps/i18n`

| Variable              | Valor                                                 | Notas                                           |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `DATABASE_URL`        | la misma que `apps/meeko`                             | Opcional: sin ella, sin moderación ni métricas. |
| `MEEKO_PUBLIC_ORIGIN` | `https://ui.meekojs.com` / `https://i18n.meekojs.com` |                                                 |
| `MEEKO_TRUST_PROXY`   | igual que `apps/meeko`                                |                                                 |
| `DOCS_METRICS`        | sin definir                                           |                                                 |

### `apps/dashboard` (cuando F5 esté listo)

| Variable                                                                           | Valor                              | Notas                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                                                                     | la de `meekojs_app`                | Las sesiones de F5 viven en la misma base (migración 005).         |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`                                            | del archivo de secretos            | El hash sale de `pnpm exec meeko auth hash`. Sin ellos no arranca. |
| `MEEKO_PUBLIC_ORIGIN`                                                              | `https://dashboard.meekojs.com`    |                                                                    |
| `DASHBOARD_ALLOWED_HOSTS`                                                          | `dashboard.meekojs.com`            | El resto de hosts responde `421`.                                  |
| `MEEKO_TRUST_PROXY`                                                                | igual que las webs                 | Los límites de login por IP dependen de ello.                      |
| `DASHBOARD_SESSION_TTL`, `DASHBOARD_SESSION_IDLE`, `DASHBOARD_SESSION_SAMESITE`    | por defecto `12h`, `30m`, `Strict` | Ver `apps/dashboard/.env.example`.                                 |
| `DASHBOARD_LOGIN_IP_LIMIT`, `DASHBOARD_LOGIN_USER_LIMIT`, `DASHBOARD_LOGIN_WINDOW` | por defecto `20`, `5`, `15m`       |                                                                    |
| `DASHBOARD_AUTHOR`                                                                 | opcional                           | Firma por defecto de las revisiones.                               |

### Secretos de Woodpecker (repo `meekojs/meeko`)

| Secreto                                                                             | Origen                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `registry_host`, `registry_username`, `registry_password`                           | Los mismos de mt, cdn, Quantum y Vuno (`deploy-ops/references/credentials.md`).                        |
| `sonar_host_url`, `sonar_token`                                                     | `<SONAR_CI_URL>` y `sonarqube_ci_token`.                                                               |
| `meekojs_database_url`                                                              | URL del **propietario** `meekojs` (migraciones). Solo eventos `manual`.                                |
| `coolify_local_token`                                                               | `coolify_local_api_token` del host. Solo eventos `manual`.                                             |
| `coolify_local_api_url`                                                             | `<COOLIFY_API_URL_CI>`: API de Coolify alcanzable desde los contenedores de CI. Solo eventos `manual`. |
| `coolify_uuid_meekojs_site`, `coolify_uuid_meekojs_ui`, `coolify_uuid_meekojs_i18n` | UUID de cada app de Coolify (paso 2).                                                                  |

### Valores que no se versionan

Los marcadores `<…>` de este runbook son topología interna del host (UUID de Coolify, host del registry, direcciones de Tailscale). Sus valores reales están en la referencia privada `deploy-ops/references/meekojs.md` de quien opera el despliegue, no en este repositorio.

| Marcador                 | Qué es                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `<REGISTRY>`             | Host y puerto del registry de imágenes (igual que el secreto `registry_host`). |
| `<COOLIFY_SERVER_UUID>`  | UUID del servidor `localhost` de Coolify.                                      |
| `<COOLIFY_PROJECT_UUID>` | UUID del proyecto `meeko` de Coolify.                                          |
| `<COOLIFY_API_URL_CI>`   | URL de la API de Coolify desde CI (valor del secreto `coolify_local_api_url`). |
| `<SONAR_CI_URL>`         | URL de SonarQube desde CI (valor del secreto `sonar_host_url`).                |
| `<WOODPECKER_URL>`       | URL base de Woodpecker.                                                        |

## IP del cliente

La cadena es Cloudflare → cloudflared → Traefik → app. Cloudflare escribe la IP del lector en `X-Forwarded-For`, pero Traefik no confía en las cabeceras `X-Forwarded-*` que le llegan de cloudflared (su entrypoint `http` no tiene `forwardedHeaders.trustedIPs`) y las sustituye: la app recibe en `X-Forwarded-For` solo la dirección de cloudflared. Con `MEEKO_TRUST_PROXY=1`, todas las peticiones tendrían la misma IP, y los `rateLimit` por cliente (120 vistas por minuto, 30 búsquedas por minuto, 10 respuestas de «¿Te sirvió?» cada 10 minutos y, en el dashboard, el login por IP) serían límites globales de toda la web.

Opciones, a decidir antes del paso 2:

Decisión: **opción B**, sin tocar Traefik. Desde Meeko 1.8, `MEEKO_TRUST_PROXY=cloudflare` lee la IP del lector en `CF-Connecting-IP`, la cabecera que fija Cloudflare, pero solo si la conexión y cada salto de `X-Forwarded-For` vienen de redes de confianza (`MEEKO_TRUSTED_PROXIES`; por defecto loopback, RFC 1918 y `fc00::/7`, donde están Traefik, la red `coolify` y cloudflared). Si alguien llega directamente a la entrada pública de Traefik con la cabecera inventada, Traefik escribe su IP en `X-Forwarded-For` y Meeko usa esa. Véase [Cloudflare Tunnel y Traefik](framework.md#cloudflare-tunnel-y-traefik).

```dotenv
MEEKO_TRUST_PROXY=cloudflare
# Opcional. Si se restringe, debe incluir la red de Traefik y la IP con la que cloudflared llega a Traefik:
# MEEKO_TRUSTED_PROXIES=<subred de coolify>, <IP de cloudflared vista por Traefik>
```

Alternativas descartadas: **A**, confiar en cloudflared en el entrypoint `http` de Traefik (`forwardedHeaders.trustedIPs`) y `MEEKO_TRUST_PROXY=2`, que cambia el proxy de todas las apps del host; y **C**, `MEEKO_TRUST_PROXY=1` con límites globales. El `301` de `www` no depende de esto: Traefik conserva `Host`, y la redirección de `apps/meeko` solo lee `X-Forwarded-Host` con un número o `true`.

Pendiente de verificar en vivo, tras el primer deploy: que `CF-Connecting-IP` llega intacta a la app y que la IP de Traefik que ve el contenedor está en una red privada.

## Paso 0. Woodpecker y SonarQube

- [ ] **Confirmar con el usuario**: activar `meekojs/meeko` en Woodpecker, marcarlo _trusted_ para volúmenes y crear sus secretos.

1. Activar el repositorio (la cuenta de Woodpecker debe ver la organización `meekojs` en GitHub):

   ```sh
   ID=$(gh api repos/meekojs/meeko --jq .id)
   ssh voidcat-local "T=\$(cat /srv/development/shared-services/secrets/woodpecker_api_token); curl -fsS -X POST -H \"Authorization: Bearer \$T\" '<WOODPECKER_URL>/api/repos?forge_remote_id=$ID' | jq '{id, full_name}'"
   ```

2. Marcarlo _trusted_ para volúmenes (`<repo-id>` del paso anterior):

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/woodpecker_api_token); curl -fsS -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"trusted\":{\"volumes\":true,\"network\":false,\"security\":false}}" <WOODPECKER_URL>/api/repos/<repo-id> | jq .trusted'
   ```

3. Crear cada secreto en el host, leyendo el valor de su archivo, sin imprimirlo. Ejemplo con `sonar_token`:

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/woodpecker_api_token); jq -n --rawfile v /srv/development/shared-services/secrets/sonarqube_ci_token "{name:\"sonar_token\", value:(\$v|rtrimstr(\"\n\")), events:[\"push\",\"manual\"], images:[]}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- <WOODPECKER_URL>/api/repos/<repo-id>/secrets | jq .name'
   ```

   `meekojs_database_url` y `coolify_local_token` llevan `events:["manual"]`, de modo que un push nunca los recibe.

4. SonarQube: el primer análisis crea `meekojs-web` (el usuario `dev-agents` tiene `provisioning`). **Verificación**: `mcp__sonarqube__search_my_sonarqube_projects` con `q=meekojs` tras el primer push, y el paso `sonarqube` en verde o con el veredicto del Gate.

**Verificación del paso**: un push a `main` deja `install`, `gates`, `images` en verde y las imágenes en el registry:

```sh
ssh voidcat-local 'P=$(cat /opt/woodpecker/secrets/registry-password); curl -fsS --cacert /opt/woodpecker/certs/registry-ca.crt -u "registry:$P" https://<REGISTRY>/v2/meekojs/meeko/tags/list; unset P'
```

## Paso 1. Base PostgreSQL de producción

- [ ] **Confirmar con el usuario**: crear el recurso PostgreSQL en el proyecto `meeko` de Coolify, su rol de aplicación y la copia de seguridad programada.

Base propia de las webs, en la red `coolify`, sin puerto publicado. Nunca `coolify-db` ni la base de otra app.

1. Generar las contraseñas en el host, en un archivo de root con permisos 600 (y añadir su ruta al mapa `deploy-ops/references/credentials.md`):

   ```sh
   ssh voidcat-local 'umask 077; test -e /root/meekojs-produccion.secrets || { printf "POSTGRES_PASSWORD=%s\nAPP_PASSWORD=%s\n" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > /root/meekojs-produccion.secrets; }; stat -c "%a %U %n" /root/meekojs-produccion.secrets'
   ```

2. Crear la base (PostgreSQL 17, como el desarrollo; 1 GB de memoria) y anotar su `uuid`:

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); jq -n --arg pw "$POSTGRES_PASSWORD" "{server_uuid:\"<COOLIFY_SERVER_UUID>\", project_uuid:\"<COOLIFY_PROJECT_UUID>\", environment_name:\"production\", name:\"meekojs-postgres\", description:\"Base de meekojs.com (docs, moderación, métricas y sesiones del dashboard)\", image:\"postgres:17-alpine\", postgres_user:\"meekojs\", postgres_password:\$pw, postgres_db:\"meekojs\", is_public:false, limits_memory:\"1g\", instant_deploy:true}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:8000/api/v1/databases/postgresql | jq "{uuid}"; unset T POSTGRES_PASSWORD APP_PASSWORD'
   ```

   Si el entorno del proyecto no se llama `production`, consultarlo antes con `GET /api/v1/projects/<COOLIFY_PROJECT_UUID>`.

3. Crear el rol de la aplicación, solo con DML; las migraciones las aplica el propietario `meekojs` desde el release (`<db-uuid>` es el nombre del contenedor):

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; docker exec -i <db-uuid> psql -v ON_ERROR_STOP=1 -U meekojs -d meekojs -v app_password="$APP_PASSWORD" <<'"'"'SQL'"'"'
   CREATE ROLE meekojs_app LOGIN PASSWORD :'"'"'app_password'"'"';
   GRANT CONNECT ON DATABASE meekojs TO meekojs_app;
   GRANT USAGE ON SCHEMA public TO meekojs_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meekojs_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meekojs_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE meekojs IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meekojs_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE meekojs IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO meekojs_app;
   SQL
   unset POSTGRES_PASSWORD APP_PASSWORD'
   ```

4. Añadir al archivo de secretos las dos URL, que usan el nombre interno del contenedor:

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; umask 077; printf "OWNER_DATABASE_URL=postgresql://meekojs:%s@<db-uuid>:5432/meekojs\nAPP_DATABASE_URL=postgresql://meekojs_app:%s@<db-uuid>:5432/meekojs\n" "$POSTGRES_PASSWORD" "$APP_PASSWORD" >> /root/meekojs-produccion.secrets; unset POSTGRES_PASSWORD APP_PASSWORD; grep -c DATABASE_URL /root/meekojs-produccion.secrets'
   ```

   Después, crear en Woodpecker `meekojs_database_url` con `OWNER_DATABASE_URL` (como en el paso 0.3, con `--rawfile` sustituido por `--arg v "$OWNER_DATABASE_URL"`).

5. Copia de seguridad: en la UI de Coolify, base `meekojs-postgres` → **Backups** → programar `0 3 * * *` con 7 copias locales. Lanzar una copia manual y comprobar que termina.

**Verificación**: la base está `running:healthy`, `is_public=false` y sin puerto publicado; el rol de la app conecta y no puede crear tablas:

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/databases/<db-uuid> | jq "{status, is_public, public_port}"; docker port <db-uuid>; unset T'
ssh voidcat-local '. /root/meekojs-produccion.secrets; docker run --rm --network coolify -e DATABASE_URL="$APP_DATABASE_URL" postgres:17-alpine sh -c "psql \"\$DATABASE_URL\" -tAc \"select current_user\"; psql \"\$DATABASE_URL\" -tAc \"create table t(x int)\" 2>&1 | head -1"; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
```

## Paso 2. Apps en Coolify

- [ ] **Confirmar con el usuario**: crear las tres apps (`meekojs-site`, `meekojs-ui`, `meekojs-i18n`) con sus variables, sin desplegarlas, con `MEEKO_TRUST_PROXY=cloudflare` (ver «IP del cliente»).

Apps de tipo **Docker Image**: Coolify no construye, tira de la imagen del registry que fija `deploy/ci-deploy.sh`. Requiere imágenes ya publicadas (paso 0). `<sha>` es el commit verificado.

1. Crear cada app (ejemplo de `meekojs.com`; para las otras, `name`, imagen y `domains` de la tabla inicial):

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); jq -n "{project_uuid:\"<COOLIFY_PROJECT_UUID>\", server_uuid:\"<COOLIFY_SERVER_UUID>\", environment_name:\"production\", name:\"meekojs-site\", docker_registry_image_name:\"<REGISTRY>/meekojs/meeko\", docker_registry_image_tag:\"<sha>\", ports_exposes:\"3000\", domains:\"http://meekojs.com,http://www.meekojs.com\", instant_deploy:false}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:8000/api/v1/applications/dockerimage | jq "{uuid}"; unset T'
   ```

2. Healthcheck y memoria (regla de deploy-ops: `127.0.0.1`, nunca `localhost`):

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"health_check_enabled\":true,\"health_check_path\":\"/healthz\",\"health_check_host\":\"127.0.0.1\",\"health_check_port\":\"3000\",\"health_check_interval\":15,\"health_check_start_period\":30,\"limits_memory\":\"768m\"}" http://127.0.0.1:8000/api/v1/applications/<app-uuid> | jq "{uuid}"; unset T'
   ```

3. Variables, con `DATABASE_URL` leída del archivo de secretos (ejemplo de `meekojs.com`; `ui` e `i18n` sin `SITE_CANONICAL_ORIGIN` y con su origen):

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); for kv in "DATABASE_URL=$APP_DATABASE_URL" "MEEKO_PUBLIC_ORIGIN=https://meekojs.com" "SITE_CANONICAL_ORIGIN=https://meekojs.com" "MEEKO_TRUST_PROXY=cloudflare"; do jq -n --arg k "${kv%%=*}" --arg v "${kv#*=}" "{key:\$k, value:\$v, is_preview:false, is_literal:true}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:8000/api/v1/applications/<app-uuid>/envs | jq -r .uuid; done; unset T POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
   ```

4. Guardar los tres UUID como secretos de Woodpecker (`coolify_uuid_meekojs_site`, `_ui`, `_i18n`) y `coolify_local_token` (paso 0.3).

**Verificación**: las tres apps aparecen con `build_pack=dockerimage`, sus dominios, el healthcheck en `127.0.0.1:3000/healthz` y las claves de variables (sin valores):

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/applications | jq -c ".[] | select(.name|startswith(\"meekojs-\")) | {name, uuid, build_pack, fqdn, health_check_path, health_check_host}"; curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/applications/<app-uuid>/envs | jq -r ".[].key"; unset T'
```

## Paso 3. Túnel por hostname

- [ ] **Confirmar con el usuario** solo si hay que cambiar algo: hoy no hace falta tocar el túnel.

Las cinco reglas ya existen en la configuración remota del túnel `voidcat-local` y apuntan a `http://localhost` (Traefik); Traefik enruta por `Host` a la app cuyo dominio coincide. No crear reglas que apunten directamente a un contenedor: se perdería el enrutado y el healthcheck de Coolify.

**Verificación** (solo lectura):

```sh
ssh voidcat-local 'journalctl -u cloudflared -o cat --no-pager | grep "Updated to new configuration" | tail -1 | grep -oE "meekojs\.com[^,]*,[^,]*service[^,]*"'
curl -sI https://ui.meekojs.com/ | head -1    # antes del deploy: 404 de Traefik
```

## Paso 4. Primer deploy

- [ ] **Confirmar con el usuario**: lanzar el pipeline manual de Woodpecker sobre `main` con `MEEKOJS_DEPLOY=true` (y `MEEKOJS_TARGETS=meeko ui i18n`).

El pipeline ejecuta gates, imágenes, el release (paso 5) y el deploy de cada app en serie: fija la etiqueta `<sha>`, lanza el deploy y espera a `finished`. Coolify solo cambia el tráfico cuando el contenedor nuevo pasa su `HEALTHCHECK`.

Lanzarlo desde la UI de Woodpecker (**Run pipeline**, rama `main`, variables `MEEKOJS_DEPLOY=true`) o por API:

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/woodpecker_api_token); curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"branch\":\"main\",\"variables\":{\"MEEKOJS_DEPLOY\":\"true\",\"MEEKOJS_TARGETS\":\"meeko ui i18n\"}}" <WOODPECKER_URL>/api/repos/<repo-id>/pipelines | jq "{number, status}"; unset T'
```

**Verificación**: los pasos `release` y `deploy` en verde, cada app `running:healthy` con la etiqueta `<sha>`, y los logs sin errores:

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/applications | jq -c ".[] | select(.name|startswith(\"meekojs-\")) | {name, status, docker_registry_image_tag}"; unset T'
ssh voidcat-local 'for c in $(docker ps --filter label=coolify.name=<app-uuid> --format "{{.Names}}"); do docker logs --since 10m "$c" 2>&1 | grep -iE "error|\[docs-|\[healthz\]" | tail -20; done'
```

## Paso 5. Release: migrar, importar y sincronizar

- [ ] **Confirmar con el usuario**: ejecutar el release contra la base de producción (lo hace el paso `release` del pipeline manual; a mano, solo si el pipeline no está disponible).

`deploy/release.sh` aplica `db:migrate` → `docs:import` → `docs:sync`, cada uno con un límite de 15 min. Es idempotente: no repite migraciones, la importación no toca revisiones y el snapshot nuevo solo se activa si el render termina. Corre antes del deploy de las apps porque las migraciones son aditivas y las webs en marcha siguen funcionando con ellas.

A mano, con la imagen `content` del commit y la URL del propietario:

```sh
ssh voidcat-local '. /root/meekojs-produccion.secrets; DATABASE_URL="$OWNER_DATABASE_URL" docker run --rm --network coolify --memory 3g -e DATABASE_URL <REGISTRY>/meekojs/content:<sha>; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
```

**Verificación**: la salida termina en `[release] done`, con `Documentation schema is ready|up to date`, `Imported documentation sources: …` y `Published N documentation records as snapshot <id>`. El snapshot activo:

```sh
ssh voidcat-local '. /root/meekojs-produccion.secrets; DATABASE_URL="$OWNER_DATABASE_URL" docker run --rm --network coolify -e DATABASE_URL <REGISTRY>/meekojs/content:<sha> node apps/meeko/scripts/snapshots.mjs list; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
```

## Paso 6. Comprobación de cada dominio

Solo lectura; no requiere confirmación.

```sh
# Salud y base
for h in meekojs.com ui.meekojs.com i18n.meekojs.com; do printf '%s ' "$h"; curl -fsS "https://$h/healthz"; echo; done

# www → apex con 301, misma ruta y query
curl -sI 'https://www.meekojs.com/docs?x=1' | grep -iE '^(HTTP|location)'   # 301, location: https://meekojs.com/docs?x=1

# CSP y cabeceras
curl -sI https://meekojs.com/ | grep -iE '^(content-security-policy|x-content-type-options|referrer-policy|permissions-policy)'

# Compresión: meeko start no comprime, la pone Cloudflare
curl -s -o /dev/null -D - -H 'accept-encoding: br, gzip' https://meekojs.com/docs/framework | grep -i '^content-encoding'   # br o gzip

# Páginas, sitemap, robots, llms y búsqueda
for p in / /docs /docs/reference /sitemap.xml /robots.txt /llms.txt '/api/docs/search?q=signal'; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "https://meekojs.com$p")" "$p"; done
curl -s https://meekojs.com/sitemap.xml | grep -c '<loc>https://meekojs.com/'
curl -s 'https://meekojs.com/api/docs/search?q=signal' | head -c 300

# UI e i18n
for u in https://ui.meekojs.com/ https://ui.meekojs.com/buttons https://i18n.meekojs.com/ https://i18n.meekojs.com/plurals; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"; done

# El dashboard sigue sin publicarse
curl -s -o /dev/null -w '%{http_code}\n' https://dashboard.meekojs.com/   # 404 de Traefik
```

Esperado: `{"status":"ok","database":"up"}` en las tres; `301` con la `location` exacta; la CSP de `apps/meeko/meeko.config.ts` (`default-src 'self'`, `frame-ancestors 'none'`…) con `nosniff` y `strict-origin-when-cross-origin`; `200` en todas las rutas; el sitemap con URLs de `https://meekojs.com/`. En el navegador: navegar por la documentación, buscar `signal` en el diálogo y responder «¿Te sirvió?» en una página (un `204`/agradecimiento, no un `403`).

Sin `content-encoding`, la web se sirve sin comprimir (`/docs/framework` y sus recursos pesan 2.220 KB en lugar de 419 KB): hay que activar la compresión en Cloudflare antes de dar el paso por bueno.

## Paso 7. Rollback

- [ ] **Confirmar con el usuario**: cualquier rollback de imagen o de snapshot en producción.

- **Imagen de una app**: volver a la etiqueta anterior (la `docker_registry_image_tag` que tenía) y desplegar. Las migraciones son aditivas, así que una imagen anterior funciona con el esquema nuevo; comprobarlo en el CHANGELOG si una migración no lo fuera.

  ```sh
  ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"docker_registry_image_tag\":\"<sha-anterior>\"}" http://127.0.0.1:8000/api/v1/applications/<app-uuid> >/dev/null; curl -fsS -X POST -H "Authorization: Bearer $T" "http://127.0.0.1:8000/api/v1/deploy?uuid=<app-uuid>" | jq -c ".deployments[0]"; unset T'
  ```

- **Contenido**: volver al snapshot anterior sin redeploy (`apps/meeko/scripts/snapshots.mjs`, la misma operación que el botón del dashboard):

  ```sh
  ssh voidcat-local '. /root/meekojs-produccion.secrets; DATABASE_URL="$OWNER_DATABASE_URL" docker run --rm --network coolify -e DATABASE_URL <REGISTRY>/meekojs/content:<sha> node apps/meeko/scripts/snapshots.mjs activate <id>; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
  ```

- **Sitio entero**: el sitio estático anterior sigue en la app `meeko-site` (`meeko.diegootayza.com`). Para devolverle `meekojs.com`, quitar los dominios de `meekojs-site` y añadirlos a `meeko-site`, y desplegar ambas.
- **Base**: restaurar la última copia de Coolify solo con autorización explícita, tras identificar la copia y conservar la base actual.

Después de cualquier rollback, repetir el paso 6 y anotar qué revisión quedó activa.

## Paso 8. El dashboard, cuando F5 esté listo

**Bloqueado por F5** (login de administrador). Hasta entonces no se crea la app ni se despliega la imagen `dashboard`; `deploy/ci-common.sh` rechaza el destino sin `MEEKOJS_DASHBOARD_READY=true`.

- [ ] **Confirmar con el usuario**: F5 terminado y revisado, migración 005 incluida en el release.
- [ ] **Confirmar con el usuario**: crear la app `meekojs-dashboard` y sus secretos.
- [ ] **Confirmar con el usuario**: primer deploy del dashboard.

1. Generar el hash de la contraseña en local (`pnpm exec meeko auth hash`, que la pide sin mostrarla) y guardarlo con el usuario en `/root/meekojs-produccion.secrets` (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`) sin pegarlo en el chat.
2. Crear la app como en el paso 2: imagen `<REGISTRY>/meekojs/dashboard`, dominio `http://dashboard.meekojs.com`, healthcheck `/healthz` en `127.0.0.1:3000`, `limits_memory` `2560m` (el worker de vista previa se recicla al pasar de 1,5 GB) y las variables de su tabla.
3. Añadir a `.woodpecker/web.yml`, en el paso `deploy`, `COOLIFY_UUID_MEEKOJS_DASHBOARD` desde el secreto `coolify_uuid_meekojs_dashboard`, y lanzar el pipeline manual con `MEEKOJS_TARGETS=dashboard` y `MEEKOJS_DASHBOARD_READY=true`.
4. **Verificación**: `/healthz` responde, `/` redirige a `/login`, un login con una contraseña errónea falla y el sexto intento por usuario se rechaza por límite, un `Host` distinto de `dashboard.meekojs.com` recibe `421`, las respuestas llevan `X-Robots-Tag: noindex, nofollow`, y publicar un snapshot desde «Snapshots» termina y se ve en `meekojs.com`.

## Verificación local de las imágenes

Sin publicar puertos, en el Docker de `voidcat-local` (comprobar antes `docker context show` y `docker info --format '{{.Name}}'`) y contra la base de desarrollo:

```sh
docker build -f deploy/Dockerfile --target web --build-arg APP=meeko -t meekojs-test/meeko:local .
docker run -d --name meekojs-test-meeko --network postgres17_default --env-file <archivo temporal con DATABASE_URL de meeko_site_dev> meekojs-test/meeko:local
docker exec meekojs-test-meeko node -e "fetch('http://127.0.0.1:3000/healthz').then(async (r) => console.log(r.status, await r.text()))"
docker rm -f meekojs-test-meeko && docker image rm meekojs-test/meeko:local
```
