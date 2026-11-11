# vibecodingonboard

> **中文简介**：vibecodingonboard 是一个小型 Node.js/TypeScript 平台，用 Docker 构建并部署用户上传的应用，通过 Traefik 把每个应用路由到 `<app>.<LZ_APPS_DOMAIN>` 域名。用户用 `npm run create-user` 创建账号并获取 API token，然后把项目打成 `.tgz` 上传即可部署。本仓库包含平台源码、`infra/` 下的 Traefik 配置、`.env.example` 环境变量模板，以及下文英文文档中的完整安装和使用说明。

A small Node.js/TypeScript platform that builds and deploys user apps with Docker, and routes them with [Traefik](https://traefik.io) at `http://<app>.<LZ_APPS_DOMAIN>`.

Users authenticate with a per-user API token, upload a project as a gzipped tar (`.tgz`), and the platform detects how to run it, builds a Docker image, starts the container, and exposes it on a per-app domain. Apps are isolated per user, count against a per-user quota, and their build logs are kept on disk.

## What it does

- **Token-based API.** Users are created with a CLI (`npm run create-user`). The API token is printed once and only stored as a SHA-256 hash. All `/v1` endpoints require `Authorization: Bearer <token>`.
- **Deploy by upload.** `POST /v1/apps/<name>/deployments` accepts a gzipped tar of a project (up to `LZ_MAX_UPLOAD_MB` MB). The deployment record is created immediately and the build runs in the background.
- **Project type detection** (when the project has no `Dockerfile`, one is generated):
  - A project with its own `Dockerfile` is built as-is (the app port is read from its `EXPOSE` line, default 3000).
  - A Node project with a `start` script is run as a Node server on port 3000.
  - A Node project with a `build` script (output in `dist/`, `build/` or `out/`) is served as a static site via nginx.
  - A folder with a plain `index.html` is served as a static site via nginx.
- **Routing.** Each app container is attached to the `lz-net` Docker network with Traefik labels, so Traefik (started by `infra:up`) routes requests to `http://<app>.<LZ_APPS_DOMAIN>`. With the default `LZ_APPS_DOMAIN=localhost` this works out of the box, since browsers resolve `*.localhost` to `127.0.0.1`.
- **Resource limits.** Every app container gets `--memory` / `--cpus` limits (from `LZ_APP_MEMORY` / `LZ_APP_CPUS`), a pids limit, and `no-new-privileges`. Apps that crash right after starting are detected and stopped.
- **Quotas.** Each user has an `app_limit`. Exceeding it returns `quota_exceeded` with the `LZ_UPGRADE_URL` where users are told to top up or upgrade.
- **Storage.** A SQLite database (`node:sqlite`, no external dependencies) plus `uploads/`, `builds/` and `logs/` directories, all under `LZ_DATA_DIR` (default `data/`). Build logs can be tailed via the API while a deployment is not yet running.

## Requirements

- **Node.js >= 24** (uses the built-in `node:sqlite` module and `--env-file-if-exists`).
- **Docker** with the Compose plugin (both the platform and Traefik shell out to the `docker` CLI).

## Setup

```bash
cp .env.example .env   # then edit values as needed
npm install
npm run infra:up       # start Traefik on the lz-net network
npm run create-user -- you@example.com 1   # prints the API token once — save it
npm start              # API on http://localhost:8787
```

### npm scripts

| Script | What it does |
| --- | --- |
| `npm run infra:up` | Start the Traefik edge router (`docker compose -f infra/docker-compose.yml up -d`) |
| `npm run infra:down` | Stop it (`docker compose -f infra/docker-compose.yml down`) |
| `npm start` | Run the platform API on `LZ_API_PORT` (default 8787) |
| `npm run create-user -- <email> [app_limit]` | Create a user and print their API token (default `app_limit` is 1) |
| `npm run typecheck` | Type-check the project with `tsc` |

### Configuration

All settings come from environment variables, loaded from `.env` if present. See [`.env.example`](.env.example) for the full list with comments: API port, apps domain, public scheme/port, data directory, upload size limit, app resource limits, and the upgrade URL shown on quota errors.

## API

| Method & path | Description |
| --- | --- |
| `GET /healthz` | Liveness check (no auth) |
| `GET /pricing` | Placeholder for the future top-up page (no auth) |
| `GET /v1/apps` | List your apps and your app quota |
| `GET /v1/apps/:name` | One app's details (live status, latest deployment) |
| `POST /v1/apps/:name/deployments` | Deploy: request body is the gzipped tar of the project |
| `GET /v1/apps/:name/logs?lines=100` | Tail the running app's container logs (max 1000 lines) |
| `GET /v1/deployments/:id` | Deployment status; includes the tail of the build log unless running |

App names are 3-40 characters of lowercase letters, digits and hyphens (no leading/trailing hyphen), and a few names like `api` and `www` are reserved.

### Deploy example

```bash
tar czf app.tgz -C my-project .
curl -X POST http://localhost:8787/v1/apps/my-app/deployments \
  -H "Authorization: Bearer lz_..." \
  -H "Content-Type: application/gzip" \
  --data-binary @app.tgz
```

The response has status `building`; poll `GET /v1/deployments/<id>` until the status is `running` (then visit `http://my-app.localhost/`) or `failed` (then read `build_log_tail`).

## Repository layout

```
src/
  server.ts         HTTP API, routing, upload handling
  deploy.ts         Deployment pipeline: unpack -> detect -> build -> run
  detect.ts         Project type detection and generated Dockerfiles
  docker.ts         docker CLI wrapper
  db.ts             SQLite schema and queries
  auth.ts           Token creation and hashing
  config.ts         Environment configuration
  cli/create-user.ts
infra/
  docker-compose.yml  Traefik edge router on the lz-net network
```

## License

[MIT](LICENSE)
