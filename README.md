# SplitMoney – Monorepo

A full-stack expense-splitting application.

| Layer    | Tech                           |
|----------|--------------------------------|
| Frontend | React 19 + Vite + Tailwind CSS |
| Backend  | NestJS + Prisma ORM            |
| Database | PostgreSQL 15                  |
| Proxy    | nginx (production only)        |

---

## Repository Layout

```
money-split/
├── money-split-app/         # React / Vite frontend
├── money-split-backend/     # NestJS backend
├── docker-compose.yml       # Base service definitions (do not run directly)
├── docker-compose.dev.yml   # Development overrides  (hot-reload, exposed ports)
├── docker-compose.prod.yml  # Production overrides   (nginx, no exposed ports)
├── nginx.conf               # nginx reverse-proxy config (production)
├── .env.docker.dev          # Dev environment template   — edit before use
└── .env.docker.prod         # Prod environment template  — edit before use
```

---

## Prerequisites

- [Docker Engine 24+](https://docs.docker.com/engine/install/)
- [Docker Compose V2](https://docs.docker.com/compose/install/) — use `docker compose` (with a space), **not** the legacy `docker-compose`

Verify your installation:

```bash
docker --version          # Docker version 24.x or higher
docker compose version    # Docker Compose version v2.x
```

---

## Quick Start

### Step 1 — Clone the repo

```bash
git clone <repo-url>
cd money-split
```

### Step 2 — Choose your environment file

| Goal              | File                  |
|-------------------|-----------------------|
| Local development | `.env.docker.dev`     |
| Production deploy | `.env.docker.prod`    |

Open the relevant file and fill in any placeholder values (search for `your-` or `change-me`).  
At minimum for **development**, the defaults work out of the box — Google OAuth will be disabled until you supply real credentials.

### Step 3 — Start the stack

See **Development** or **Production** sections below.

---

## Development

Hot-reload is enabled for both frontend and backend. Source files are mounted
into the containers so changes are reflected immediately — no rebuild needed.

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  --env-file .env.docker.dev \
  up --build
```

Add `-d` to run in the background (detached mode):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.dev.yml \
  --env-file .env.docker.dev \
  up -d --build
```

### Services in dev mode

| Service  | URL                   | Notes                           |
|----------|-----------------------|---------------------------------|
| Frontend | http://localhost:5173 | Vite dev server with HMR        |
| Backend  | http://localhost:3000 | NestJS watch mode (auto-reload) |
| Database | localhost:5432        | Exposed for local tools         |

### Swagger API Docs (dev only)

```
http://localhost:3000/api
```

### Prisma Studio (dev only)

Browse and edit the database in a browser:

```bash
cd money-split-backend
npx prisma studio
```

> Make sure the `db` container is running (`docker compose ... up -d`) before
> launching Prisma Studio locally.

---

## Production

In production, **nginx** is the single public entry point on port **80**.

- `GET /` and all static assets → served by nginx from the React build
- `GET /api/*` → proxied to NestJS (the `/api` prefix is stripped before forwarding)
- The backend and database are **not** exposed on the host

### Step 1 — Configure production secrets

```bash
# Never commit real secrets — create a local override file
cp .env.docker.prod .env.docker.prod.local
```

Edit `.env.docker.prod.local` and replace every placeholder:

| Variable | What to set |
|----------|-------------|
| `POSTGRES_PASSWORD` | A strong, unique database password |
| `JWT_SECRET` | A random string of at least 32 characters |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From [Google Cloud Console](https://console.cloud.google.com/) |
| `GOOGLE_CALLBACK_URL` | `https://your-domain.com/api/auth/google/callback` |
| `FRONTEND_URL` | `https://your-domain.com` |
| `VITE_API_URL` / `VITE_API_PUBLIC_URL` | `https://your-domain.com/api` |

> `.env.docker.prod.local` is already in `.gitignore` — it is safe to store real credentials there.

### Step 2 — Build and start

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  --env-file .env.docker.prod.local \
  up -d --build
```

The application will be available at `http://your-domain.com` (or `http://localhost` if running locally).

### Services in production mode

| Service            | URL                           |
|--------------------|-------------------------------|
| Application (UI)   | http://your-domain.com        |
| API (via nginx)    | http://your-domain.com/api    |
| Database           | not exposed to the host       |

---

## Useful Commands

All commands below use the dev compose files as an example.  
For production, replace `-f docker-compose.dev.yml --env-file .env.docker.dev` with
`-f docker-compose.prod.yml --env-file .env.docker.prod.local`.

```bash
# Follow live logs for all services
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev logs -f

# Follow logs for a single service (api | frontend | db)
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev logs -f api

# Stop containers (DB volume is kept)
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev down

# Stop containers AND delete the database volume ⚠ ALL DATA WILL BE LOST
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev down -v

# Rebuild a single service without restarting the others
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev up -d --build api

# Open a shell inside the running backend container
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev exec api sh

# Check container status and health
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev ps
```

---

## Database Migrations

Migrations run **automatically** when the `api` container starts (`prisma migrate deploy`).

To create a **new** migration during development, run from the host:

```bash
cd money-split-backend
npx prisma migrate dev --name descriptive_name
```

Or directly inside the running container:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker.dev \
  exec api npx prisma migrate dev --name descriptive_name
```

---

## Environment Variables Reference

| Variable | Used by | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | db, api | PostgreSQL username |
| `POSTGRES_PASSWORD` | db, api | PostgreSQL password |
| `POSTGRES_DB` | db, api | Database name |
| `JWT_SECRET` | api | Secret for signing JWT tokens (min 32 chars in prod) |
| `JWT_EXPIRES_IN` | api | Token expiry, e.g. `7d` |
| `GOOGLE_CLIENT_ID` | api | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | api | Google OAuth 2.0 client secret |
| `GOOGLE_CALLBACK_URL` | api | Redirect URI registered in Google Cloud Console |
| `FRONTEND_URL` | api | Browser-facing URL; used for CORS and OAuth redirects |
| `VITE_API_URL` | frontend | Backend URL as seen from the **browser** (baked into the build) |
| `VITE_API_PUBLIC_URL` | frontend | Public URL for Google OAuth redirect (browser-facing) |

> ⚠️ **Never commit real secrets.** The `.env.docker.prod` file in this repo
> contains only placeholders. Keep real credentials in `.env.docker.prod.local`
> (already ignored by `.gitignore`).

---

## Troubleshooting

### Port already in use

Stop any local process using ports `3000`, `5173`, or `5432`, then restart the stack.

### Backend fails to start (`ECONNREFUSED` to Postgres)

The database container may still be initialising. Wait a few seconds and check:

```bash
docker compose ... ps        # db should show "healthy"
docker compose ... logs db   # look for "database system is ready to accept connections"
```

### Google OAuth not working

In **development**, Google OAuth is disabled if `GOOGLE_CLIENT_ID` is set to `your-google-client-id`.  
Replace it with a real credential from [Google Cloud Console](https://console.cloud.google.com/).  
Make sure the **Authorized redirect URI** in your OAuth app matches `GOOGLE_CALLBACK_URL` exactly.

### Frontend shows blank page or API errors

1. Check that the backend is healthy: `curl http://localhost:3000` should return `Hello World!`
2. Verify `VITE_API_URL` in the env file points to where the browser can reach the backend.
3. Rebuild the frontend image after any `.env` change: `docker compose ... up -d --build frontend`

### View all running containers

```bash
docker ps
```

---

## Running Without Docker

See the individual project READMEs for local (non-Docker) setup:

- [`money-split-backend/README.md`](./money-split-backend/README.md)
- [`money-split-app/README.md`](./money-split-app/README.md)
