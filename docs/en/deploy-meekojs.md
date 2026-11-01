---
source-hash: d66af7623151d834ec31e81d55334d7664767d3e2b5fc7f08a73876edf3b9067
---

# Deploy meekojs.com on voidcat-local

Runbook for publishing the Meeko sites in Coolify on `voidcat-local`, behind the `voidcat-local` Cloudflare tunnel and Traefik. Every step touching infrastructure has a **Confirm with the user** checkbox: do not execute it without that explicit confirmation, even if previous steps are complete. Secrets are never written in this document, the console or logs: they come from the host's secrets file or Woodpecker secrets.

| Domain                  | App              | Package             | Image (`<registry>/meekojs/…`) | Status                       |
| ----------------------- | ---------------- | ------------------- | ------------------------------ | ---------------------------- |
| `meekojs.com`           | `apps/meeko`     | `meeko-site`        | `meeko`                        | Ready to deploy              |
| `www.meekojs.com`       | `apps/meeko`     | —                   | — (301 to `meekojs.com`)       | Ready to deploy              |
| `ui.meekojs.com`        | `apps/ui`        | `meeko-ui-site`     | `ui`                           | Ready to deploy              |
| `i18n.meekojs.com`      | `apps/i18n`      | `meeko-i18n-site`   | `i18n`                         | Ready to deploy              |
| `dashboard.meekojs.com` | `apps/dashboard` | `meeko-dashboard`   | `dashboard`                    | **Blocked by F5**            |
| —                       | release          | `deploy/release.sh` | `content`                      | One execution per deployment |

`<registry>` is the value of the `registry_host` secret (see “Values kept out of version control”).

## How it fits together

```text
navegador ─TLS─ Cloudflare ── túnel voidcat-local (cloudflared) ── http://localhost:80 (Traefik, coolify-proxy)
                                                                     └─ Host → contenedor de la app :3000 (red coolify)
                                                                                └─ PostgreSQL de producción (red coolify, sin puerto publicado)
```

- **Images** (`deploy/Dockerfile`, a single file with one target per image):
  - `web` (`--build-arg APP=meeko|ui|i18n`): the `meeko build` output and the app's production dependencies (`pnpm deploy --prod`), on `node:24-bookworm-slim`, user `node`, `meeko start`, port 3000 and `HEALTHCHECK` against `/healthz`. About 475 MB.
  - `content`: the entire monorepo, because `docs:import` and `docs:sync` render with Vite from `docs/**`, package code (JSDoc), taxonomy and `apps/*/app/utils/navigation.ts`. Its `CMD` is `deploy/release.sh`.
  - `dashboard`: `content` plus the dashboard build. Its jobs (import, publish, health and preview) are child processes loading `meeko-docs-content` with Vite over the same tree, so the image needs the repository and development dependencies. It does not include `.git`: file history for resolving revision conflicts (`findGitVersion`) is unavailable and the detail view compares only Git with the revision.
- **Health**: `GET /healthz` responds `200` with `{"status":"ok","database":"up|down|unconfigured"}` and `Cache-Control: no-store` while the process is serving (`meeko-docs-content/liveness`). The database does not decide health, because the sites degrade without it; its state travels in the body. At most one `SELECT 1` query every 5 s, in a one-connection pool with a 2 s limit.
- **CI/CD**: `.woodpecker/web.yml`. A push to `main` runs gates, SonarQube (`meekojs-web`) and publishes images with the commit SHA. A **manual** pipeline on `main` with `MEEKOJS_DEPLOY=true` also performs the content release (`deploy/ci-release.sh`) and Coolify deployment (`deploy/ci-deploy.sh`). GitHub Actions (`.github/workflows/ci.yml`) remains the full framework and npm verification; Woodpecker only delivers the sites, because it needs the Docker socket, registry, `coolify` network and voidcat-local's local Coolify API.

## Verified infrastructure status (2026-10-31, read-only)

- Coolify 4.5.3 with one server (`localhost`) and the **`meeko`** project already created. Host apps use the `coolify` network, `http://` domains (TLS at Cloudflare) and, when they have a healthcheck, `health_check_host=127.0.0.1`.
- The **`meeko-site`** Coolify app currently serves the static site (nginx) at `meeko.diegootayza.com`. It remains as a rollback option: do not delete it.
- The `voidcat-local` tunnel (cloudflared with remote configuration) **already routes** `meekojs.com`, `www.meekojs.com`, `ui.meekojs.com`, `i18n.meekojs.com` and `dashboard.meekojs.com` to `http://localhost` (Traefik). Until Traefik has a router for a host, it responds `404`.
- The host's Docker already trusts the registry and is logged in: Coolify can pull `<registry>/meekojs/*` images.
- Woodpecker: `meekojs/meeko` **is not activated** yet. Official SonarQube (`sonarqube-dev`): no meeko project.
- Traefik has no `forwardedHeaders.trustedIPs` on the `http` entrypoint (see “Client IP”).

## Per-app variables

No real values: secrets are loaded from the host's `/root/meekojs-produccion.secrets` (step 1) with `jq`, without printing them. Images already set `NODE_ENV=production`, `MEEKO_HOST=0.0.0.0` and `MEEKO_PORT=3000`.

### `apps/meeko` (meekojs.com)

| Variable                | Value                                               | Notes                                                                     |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`          | `postgresql://meekojs_app:…@<db-uuid>:5432/meekojs` | App role (DML only). Secret.                                              |
| `MEEKO_PUBLIC_ORIGIN`   | `https://meekojs.com`                               | Metrics POSTs compare `Origin` against it.                                |
| `SITE_CANONICAL_ORIGIN` | `https://meekojs.com`                               | Enables the `301` from `www.meekojs.com`. An invalid value stops startup. |
| `MEEKO_TRUST_PROXY`     | `cloudflare`                                        | See “Client IP”. Reads `CF-Connecting-IP` (Meeko 1.8).                    |
| `DOCS_METRICS`          | unset                                               | `off` disables views, searches and “¿Te sirvió?” (was this helpful?).     |

### `apps/ui` and `apps/i18n`

| Variable              | Value                                                 | Notes                                           |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `DATABASE_URL`        | same as `apps/meeko`                                  | Optional: without it, no moderation or metrics. |
| `MEEKO_PUBLIC_ORIGIN` | `https://ui.meekojs.com` / `https://i18n.meekojs.com` |                                                 |
| `MEEKO_TRUST_PROXY`   | same as `apps/meeko`                                  |                                                 |
| `DOCS_METRICS`        | unset                                                 |                                                 |

### `apps/dashboard` (when F5 is ready)

| Variable                                                                           | Value                           | Notes                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                     | the `meekojs_app` URL           | F5 sessions live in the same database (migration 005).                           |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`                                            | from the secrets file           | The hash comes from `pnpm exec meeko auth hash`. Without them it does not start. |
| `MEEKO_PUBLIC_ORIGIN`                                                              | `https://dashboard.meekojs.com` |                                                                                  |
| `DASHBOARD_ALLOWED_HOSTS`                                                          | `dashboard.meekojs.com`         | Other hosts receive `421`.                                                       |
| `MEEKO_TRUST_PROXY`                                                                | same as the sites               | Per-IP login limits depend on it.                                                |
| `DASHBOARD_SESSION_TTL`, `DASHBOARD_SESSION_IDLE`, `DASHBOARD_SESSION_SAMESITE`    | defaults `12h`, `30m`, `Strict` | See `apps/dashboard/.env.example`.                                               |
| `DASHBOARD_LOGIN_IP_LIMIT`, `DASHBOARD_LOGIN_USER_LIMIT`, `DASHBOARD_LOGIN_WINDOW` | defaults `20`, `5`, `15m`       |                                                                                  |
| `DASHBOARD_AUTHOR`                                                                 | optional                        | Default revision signature.                                                      |

### Woodpecker secrets (repository `meekojs/meeko`)

| Secret                                                                              | Source                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `registry_host`, `registry_username`, `registry_password`                           | Same as mt, cdn, Quantum and Vuno (`deploy-ops/references/credentials.md`).             |
| `sonar_host_url`, `sonar_token`                                                     | `<SONAR_CI_URL>` and `sonarqube_ci_token`.                                              |
| `meekojs_database_url`                                                              | URL of the **owner** `meekojs` (migrations). Only `manual` events.                      |
| `coolify_local_token`                                                               | Host's `coolify_local_api_token`. Only `manual` events.                                 |
| `coolify_local_api_url`                                                             | `<COOLIFY_API_URL_CI>`: Coolify API reachable from CI containers. Only `manual` events. |
| `coolify_uuid_meekojs_site`, `coolify_uuid_meekojs_ui`, `coolify_uuid_meekojs_i18n` | UUID of each Coolify app (step 2).                                                      |

### Values kept out of version control

The `<…>` placeholders in this runbook are internal host topology (Coolify UUIDs, registry host, Tailscale addresses). Their real values are in the deployment operator's private `deploy-ops/references/meekojs.md` reference, not in this repository.

| Placeholder              | Meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `<REGISTRY>`             | Image registry host and port (same as the `registry_host` secret).     |
| `<COOLIFY_SERVER_UUID>`  | UUID of Coolify's `localhost` server.                                  |
| `<COOLIFY_PROJECT_UUID>` | UUID of Coolify's `meeko` project.                                     |
| `<COOLIFY_API_URL_CI>`   | Coolify API URL from CI (value of the `coolify_local_api_url` secret). |
| `<SONAR_CI_URL>`         | SonarQube URL from CI (value of the `sonar_host_url` secret).          |
| `<WOODPECKER_URL>`       | Woodpecker base URL.                                                   |

## Client IP

The chain is Cloudflare → cloudflared → Traefik → app. Cloudflare writes the reader's IP into `X-Forwarded-For`, but Traefik does not trust the `X-Forwarded-*` headers arriving from cloudflared (its `http` entrypoint has no `forwardedHeaders.trustedIPs`) and replaces them: the app receives only cloudflared's address in `X-Forwarded-For`. With `MEEKO_TRUST_PROXY=1`, all requests would have the same IP, and per-client `rateLimit` values (120 views per minute, 30 searches per minute, 10 “¿Te sirvió?” responses every 10 minutes and, in the dashboard, per-IP login) would become global limits for the entire site.

Options, to decide before step 2:

Decision: **option B**, without changing Traefik. Since Meeko 1.8, `MEEKO_TRUST_PROXY=cloudflare` reads the reader's IP from `CF-Connecting-IP`, the header set by Cloudflare, but only if the connection and every `X-Forwarded-For` hop come from trusted networks (`MEEKO_TRUSTED_PROXIES`; by default loopback, RFC 1918 and `fc00::/7`, where Traefik, the `coolify` network and cloudflared live). If someone reaches Traefik's public entrypoint directly with a fabricated header, Traefik writes their IP into `X-Forwarded-For` and Meeko uses it. See [Cloudflare Tunnel and Traefik](framework.md#cloudflare-tunnel-and-traefik).

```dotenv
MEEKO_TRUST_PROXY=cloudflare
# Opcional. Si se restringe, debe incluir la red de Traefik y la IP con la que cloudflared llega a Traefik:
# MEEKO_TRUSTED_PROXIES=<subred de coolify>, <IP de cloudflared vista por Traefik>
```

Rejected alternatives: **A**, trusting cloudflared on Traefik's `http` entrypoint (`forwardedHeaders.trustedIPs`) and `MEEKO_TRUST_PROXY=2`, which changes the proxy for all host apps; and **C**, `MEEKO_TRUST_PROXY=1` with global limits. The `www` `301` does not depend on this: Traefik preserves `Host`, and the `apps/meeko` redirect only reads `X-Forwarded-Host` with a number or `true`.

Still to verify live after the first deployment: that `CF-Connecting-IP` reaches the app intact and the Traefik IP seen by the container is in a private network.

## Step 0. Woodpecker and SonarQube

- [ ] **Confirm with the user**: activate `meekojs/meeko` in Woodpecker, mark it _trusted_ for volumes and create its secrets.

1. Activate the repository (the Woodpecker account must see the `meekojs` organization on GitHub):

   ```sh
   ID=$(gh api repos/meekojs/meeko --jq .id)
   ssh voidcat-local "T=\$(cat /srv/development/shared-services/secrets/woodpecker_api_token); curl -fsS -X POST -H \"Authorization: Bearer \$T\" '<WOODPECKER_URL>/api/repos?forge_remote_id=$ID' | jq '{id, full_name}'"
   ```

2. Mark it _trusted_ for volumes (`<repo-id>` from the previous step):

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/woodpecker_api_token); curl -fsS -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"trusted\":{\"volumes\":true,\"network\":false,\"security\":false}}" <WOODPECKER_URL>/api/repos/<repo-id> | jq .trusted'
   ```

3. Create each secret on the host, reading its value from its file without printing it. Example with `sonar_token`:

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/woodpecker_api_token); jq -n --rawfile v /srv/development/shared-services/secrets/sonarqube_ci_token "{name:\"sonar_token\", value:(\$v|rtrimstr(\"\n\")), events:[\"push\",\"manual\"], images:[]}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- <WOODPECKER_URL>/api/repos/<repo-id>/secrets | jq .name'
   ```

   `meekojs_database_url` and `coolify_local_token` use `events:["manual"]`, so a push never receives them.

4. SonarQube: the first analysis creates `meekojs-web` (the `dev-agents` user has `provisioning`). **Verification**: `mcp__sonarqube__search_my_sonarqube_projects` with `q=meekojs` after the first push, and the `sonarqube` step green or showing the Gate verdict.

**Step verification**: a push to `main` leaves `install`, `gates`, `images` green and images in the registry:

```sh
ssh voidcat-local 'P=$(cat /opt/woodpecker/secrets/registry-password); curl -fsS --cacert /opt/woodpecker/certs/registry-ca.crt -u "registry:$P" https://<REGISTRY>/v2/meekojs/meeko/tags/list; unset P'
```

## Step 1. Production PostgreSQL database

- [ ] **Confirm with the user**: create the PostgreSQL resource in Coolify's `meeko` project, its application role and scheduled backup.

A dedicated database for the sites, on the `coolify` network, with no published port. Never `coolify-db` or another app's database.

1. Generate passwords on the host, in a root file with permissions 600 (and add its path to the `deploy-ops/references/credentials.md` map):

   ```sh
   ssh voidcat-local 'umask 077; test -e /root/meekojs-produccion.secrets || { printf "POSTGRES_PASSWORD=%s\nAPP_PASSWORD=%s\n" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > /root/meekojs-produccion.secrets; }; stat -c "%a %U %n" /root/meekojs-produccion.secrets'
   ```

2. Create the database (PostgreSQL 17, like development; 1 GB memory) and record its `uuid`:

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); jq -n --arg pw "$POSTGRES_PASSWORD" "{server_uuid:\"<COOLIFY_SERVER_UUID>\", project_uuid:\"<COOLIFY_PROJECT_UUID>\", environment_name:\"production\", name:\"meekojs-postgres\", description:\"Base de meekojs.com (docs, moderación, métricas y sesiones del dashboard)\", image:\"postgres:17-alpine\", postgres_user:\"meekojs\", postgres_password:\$pw, postgres_db:\"meekojs\", is_public:false, limits_memory:\"1g\", instant_deploy:true}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:8000/api/v1/databases/postgresql | jq "{uuid}"; unset T POSTGRES_PASSWORD APP_PASSWORD'
   ```

   If the project environment is not named `production`, query it first with `GET /api/v1/projects/<COOLIFY_PROJECT_UUID>`.

3. Create the application role, with DML only; migrations are applied by owner `meekojs` from the release (`<db-uuid>` is the container name):

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

4. Add both URLs, using the container's internal name, to the secrets file:

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; umask 077; printf "OWNER_DATABASE_URL=postgresql://meekojs:%s@<db-uuid>:5432/meekojs\nAPP_DATABASE_URL=postgresql://meekojs_app:%s@<db-uuid>:5432/meekojs\n" "$POSTGRES_PASSWORD" "$APP_PASSWORD" >> /root/meekojs-produccion.secrets; unset POSTGRES_PASSWORD APP_PASSWORD; grep -c DATABASE_URL /root/meekojs-produccion.secrets'
   ```

   Then create `meekojs_database_url` in Woodpecker with `OWNER_DATABASE_URL` (as in step 0.3, replacing `--rawfile` with `--arg v "$OWNER_DATABASE_URL"`).

5. Backup: in the Coolify UI, database `meekojs-postgres` → **Backups** → schedule `0 3 * * *` with 7 local copies. Run a manual backup and check it completes.

**Verification**: the database is `running:healthy`, `is_public=false` and has no published port; the app role connects and cannot create tables:

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/databases/<db-uuid> | jq "{status, is_public, public_port}"; docker port <db-uuid>; unset T'
ssh voidcat-local '. /root/meekojs-produccion.secrets; docker run --rm --network coolify -e DATABASE_URL="$APP_DATABASE_URL" postgres:17-alpine sh -c "psql \"\$DATABASE_URL\" -tAc \"select current_user\"; psql \"\$DATABASE_URL\" -tAc \"create table t(x int)\" 2>&1 | head -1"; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
```

## Step 2. Apps in Coolify

- [ ] **Confirm with the user**: create the three apps (`meekojs-site`, `meekojs-ui`, `meekojs-i18n`) with their variables, without deploying them, with `MEEKO_TRUST_PROXY=cloudflare` (see “Client IP”).

Apps of type **Docker Image**: Coolify does not build; it pulls the registry image set by `deploy/ci-deploy.sh`. This requires already published images (step 0). `<sha>` is the verified commit.

1. Create each app (example for `meekojs.com`; for the others, use `name`, image and `domains` from the initial table):

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); jq -n "{project_uuid:\"<COOLIFY_PROJECT_UUID>\", server_uuid:\"<COOLIFY_SERVER_UUID>\", environment_name:\"production\", name:\"meekojs-site\", docker_registry_image_name:\"<REGISTRY>/meekojs/meeko\", docker_registry_image_tag:\"<sha>\", ports_exposes:\"3000\", domains:\"http://meekojs.com,http://www.meekojs.com\", instant_deploy:false}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:8000/api/v1/applications/dockerimage | jq "{uuid}"; unset T'
   ```

2. Healthcheck and memory (deploy-ops rule: `127.0.0.1`, never `localhost`):

   ```sh
   ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"health_check_enabled\":true,\"health_check_path\":\"/healthz\",\"health_check_host\":\"127.0.0.1\",\"health_check_port\":\"3000\",\"health_check_interval\":15,\"health_check_start_period\":30,\"limits_memory\":\"768m\"}" http://127.0.0.1:8000/api/v1/applications/<app-uuid> | jq "{uuid}"; unset T'
   ```

3. Variables, with `DATABASE_URL` read from the secrets file (example for `meekojs.com`; `ui` and `i18n` without `SITE_CANONICAL_ORIGIN` and with their own origin):

   ```sh
   ssh voidcat-local '. /root/meekojs-produccion.secrets; T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); for kv in "DATABASE_URL=$APP_DATABASE_URL" "MEEKO_PUBLIC_ORIGIN=https://meekojs.com" "SITE_CANONICAL_ORIGIN=https://meekojs.com" "MEEKO_TRUST_PROXY=cloudflare"; do jq -n --arg k "${kv%%=*}" --arg v "${kv#*=}" "{key:\$k, value:\$v, is_preview:false, is_literal:true}" | curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:8000/api/v1/applications/<app-uuid>/envs | jq -r .uuid; done; unset T POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
   ```

4. Save the three UUIDs as Woodpecker secrets (`coolify_uuid_meekojs_site`, `_ui`, `_i18n`) and `coolify_local_token` (step 0.3).

**Verification**: all three apps appear with `build_pack=dockerimage`, their domains, the healthcheck at `127.0.0.1:3000/healthz` and variable keys (without values):

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/applications | jq -c ".[] | select(.name|startswith(\"meekojs-\")) | {name, uuid, build_pack, fqdn, health_check_path, health_check_host}"; curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/applications/<app-uuid>/envs | jq -r ".[].key"; unset T'
```

## Step 3. Tunnel by hostname

- [ ] **Confirm with the user** only if something needs changing: today the tunnel needs no changes.

All five rules already exist in the `voidcat-local` tunnel's remote configuration and point to `http://localhost` (Traefik); Traefik routes by `Host` to the app with the matching domain. Do not create rules pointing directly to a container: Coolify routing and healthchecks would be lost.

**Verification** (read-only):

```sh
ssh voidcat-local 'journalctl -u cloudflared -o cat --no-pager | grep "Updated to new configuration" | tail -1 | grep -oE "meekojs\.com[^,]*,[^,]*service[^,]*"'
curl -sI https://ui.meekojs.com/ | head -1    # antes del deploy: 404 de Traefik
```

## Step 4. First deployment

- [ ] **Confirm with the user**: run the manual Woodpecker pipeline on `main` with `MEEKOJS_DEPLOY=true` (and `MEEKOJS_TARGETS=meeko ui i18n`).

The pipeline runs gates, images, the release (step 5) and deployment for each app in sequence: it sets the `<sha>` tag, starts deployment and waits for `finished`. Coolify only switches traffic when the new container passes its `HEALTHCHECK`.

Run it from the Woodpecker UI (**Run pipeline**, branch `main`, variables `MEEKOJS_DEPLOY=true`) or through the API:

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/woodpecker_api_token); curl -fsS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"branch\":\"main\",\"variables\":{\"MEEKOJS_DEPLOY\":\"true\",\"MEEKOJS_TARGETS\":\"meeko ui i18n\"}}" <WOODPECKER_URL>/api/repos/<repo-id>/pipelines | jq "{number, status}"; unset T'
```

**Verification**: `release` and `deploy` steps green, each app `running:healthy` with the `<sha>` tag, and no errors in logs:

```sh
ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -H "Authorization: Bearer $T" http://127.0.0.1:8000/api/v1/applications | jq -c ".[] | select(.name|startswith(\"meekojs-\")) | {name, status, docker_registry_image_tag}"; unset T'
ssh voidcat-local 'for c in $(docker ps --filter label=coolify.name=<app-uuid> --format "{{.Names}}"); do docker logs --since 10m "$c" 2>&1 | grep -iE "error|\[docs-|\[healthz\]" | tail -20; done'
```

## Step 5. Release: migrate, import and sync

- [ ] **Confirm with the user**: run the release against the production database (the manual pipeline's `release` step does this; run manually only if the pipeline is unavailable).

`deploy/release.sh` applies `db:migrate` → `docs:import` → `docs:sync`, each with a 15 min limit. It is idempotent: migrations are not repeated, import does not touch revisions and the new snapshot activates only if rendering completes. It runs before app deployment because migrations are additive and running sites keep working with them.

Manually, with the commit's `content` image and the owner's URL:

```sh
ssh voidcat-local '. /root/meekojs-produccion.secrets; DATABASE_URL="$OWNER_DATABASE_URL" docker run --rm --network coolify --memory 3g -e DATABASE_URL <REGISTRY>/meekojs/content:<sha>; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
```

**Verification**: output ends in `[release] done`, with `Documentation schema is ready|up to date`, `Imported documentation sources: …` and `Published N documentation records as snapshot <id>`. The active snapshot:

```sh
ssh voidcat-local '. /root/meekojs-produccion.secrets; DATABASE_URL="$OWNER_DATABASE_URL" docker run --rm --network coolify -e DATABASE_URL <REGISTRY>/meekojs/content:<sha> node apps/meeko/scripts/snapshots.mjs list; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
```

## Step 6. Check each domain

Read-only; no confirmation required.

```sh
# Salud y base
for h in meekojs.com ui.meekojs.com i18n.meekojs.com; do printf '%s ' "$h"; curl -fsS "https://$h/healthz"; echo; done

# www → apex con 301, misma ruta y query
curl -sI 'https://www.meekojs.com/docs?x=1' | grep -iE '^(HTTP|location)'   # 301, location: https://meekojs.com/docs?x=1

# CSP y cabeceras
curl -sI https://meekojs.com/ | grep -iE '^(content-security-policy|x-content-type-options|referrer-policy|permissions-policy)'

# Páginas, sitemap, robots, llms y búsqueda
for p in / /docs /docs/reference /sitemap.xml /robots.txt /llms.txt '/api/docs/search?q=signal'; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "https://meekojs.com$p")" "$p"; done
curl -s https://meekojs.com/sitemap.xml | grep -c '<loc>https://meekojs.com/'
curl -s 'https://meekojs.com/api/docs/search?q=signal' | head -c 300

# UI e i18n
for u in https://ui.meekojs.com/ https://ui.meekojs.com/buttons https://i18n.meekojs.com/ https://i18n.meekojs.com/plurals; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"; done

# El dashboard sigue sin publicarse
curl -s -o /dev/null -w '%{http_code}\n' https://dashboard.meekojs.com/   # 404 de Traefik
```

Expected: `{"status":"ok","database":"up"}` on all three; `301` with the exact `location`; the CSP from `apps/meeko/meeko.config.ts` (`default-src 'self'`, `frame-ancestors 'none'`…) with `nosniff` and `strict-origin-when-cross-origin`; `200` on every route; sitemap URLs under `https://meekojs.com/`. In the browser: navigate documentation, search for `signal` in the dialog and answer “¿Te sirvió?” on a page (a `204`/thank-you, not a `403`).

## Step 7. Rollback

- [ ] **Confirm with the user**: any production image or snapshot rollback.

- **App image**: return to the previous tag (its former `docker_registry_image_tag`) and deploy. Migrations are additive, so an earlier image works with the new schema; check the CHANGELOG if a migration is not additive.

  ```sh
  ssh voidcat-local 'T=$(cat /srv/development/shared-services/secrets/coolify_local_api_token); curl -fsS -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"docker_registry_image_tag\":\"<sha-anterior>\"}" http://127.0.0.1:8000/api/v1/applications/<app-uuid> >/dev/null; curl -fsS -X POST -H "Authorization: Bearer $T" "http://127.0.0.1:8000/api/v1/deploy?uuid=<app-uuid>" | jq -c ".deployments[0]"; unset T'
  ```

- **Content**: return to the previous snapshot without redeploying (`apps/meeko/scripts/snapshots.mjs`, the same operation as the dashboard button):

  ```sh
  ssh voidcat-local '. /root/meekojs-produccion.secrets; DATABASE_URL="$OWNER_DATABASE_URL" docker run --rm --network coolify -e DATABASE_URL <REGISTRY>/meekojs/content:<sha> node apps/meeko/scripts/snapshots.mjs activate <id>; unset POSTGRES_PASSWORD APP_PASSWORD OWNER_DATABASE_URL APP_DATABASE_URL'
  ```

- **Entire site**: the previous static site remains in the `meeko-site` app (`meeko.diegootayza.com`). To return `meekojs.com` to it, remove the domains from `meekojs-site`, add them to `meeko-site` and deploy both.
- **Database**: restore the latest Coolify backup only with explicit authorization, after identifying the backup and preserving the current database.

After any rollback, repeat step 6 and record which revision is active.

## Step 8. The dashboard, when F5 is ready

**Blocked by F5** (administrator login). Until then, do not create the app or deploy the `dashboard` image; `deploy/ci-common.sh` rejects the target without `MEEKOJS_DASHBOARD_READY=true`.

- [ ] **Confirm with the user**: F5 complete and reviewed, migration 005 included in the release.
- [ ] **Confirm with the user**: create the `meekojs-dashboard` app and its secrets.
- [ ] **Confirm with the user**: first dashboard deployment.

1. Generate the password hash locally (`pnpm exec meeko auth hash`, which prompts without displaying it) and save it with the username in `/root/meekojs-produccion.secrets` (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`) without pasting it into chat.
2. Create the app as in step 2: image `<REGISTRY>/meekojs/dashboard`, domain `http://dashboard.meekojs.com`, healthcheck `/healthz` at `127.0.0.1:3000`, `limits_memory` `2560m` (the preview worker is recycled above 1.5 GB) and its table's variables.
3. In `.woodpecker/web.yml`, add `COOLIFY_UUID_MEEKOJS_DASHBOARD` from the `coolify_uuid_meekojs_dashboard` secret to the `deploy` step, and run the manual pipeline with `MEEKOJS_TARGETS=dashboard` and `MEEKOJS_DASHBOARD_READY=true`.
4. **Verification**: `/healthz` responds, `/` redirects to `/login`, login with a wrong password fails and the sixth per-user attempt is rate-limited, a `Host` other than `dashboard.meekojs.com` receives `421`, responses carry `X-Robots-Tag: noindex, nofollow`, and publishing a snapshot from “Snapshots” completes and appears on `meekojs.com`.

## Local image verification

Without publishing ports, on `voidcat-local` Docker (first check `docker context show` and `docker info --format '{{.Name}}'`) and against the development database:

```sh
docker build -f deploy/Dockerfile --target web --build-arg APP=meeko -t meekojs-test/meeko:local .
docker run -d --name meekojs-test-meeko --network postgres17_default --env-file <archivo temporal con DATABASE_URL de meeko_site_dev> meekojs-test/meeko:local
docker exec meekojs-test-meeko node -e "fetch('http://127.0.0.1:3000/healthz').then(async (r) => console.log(r.status, await r.text()))"
docker rm -f meekojs-test-meeko && docker image rm meekojs-test/meeko:local
```
