# Auto Checker

Monitors DataAnnotation projects API on a random 10-30 minute schedule (during 7AM–11PM local time) and sends WhatsApp alerts via WAHA when new paid projects or qualifications with available tasks are detected.

## Quick Start (Local Development)

```bash
# Start WAHA (WhatsApp bridge)
docker compose up -d waha

npm install
cp .env.local.example .env.local
# Fill in .env.local with your values
npm run dev
```

**WAHA runs on port 3001.** Open http://localhost:3001 to configure your WhatsApp session.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | Yes |
| `WAHA_URL` | WAHA API base URL (e.g. http://localhost:3001) | Yes |
| `WAHA_API_KEY` | WAHA API key (optional) | No |
| `JWT_SECRET` | Secret for signing session JWT (min 32 chars) | Yes |
| `CRON_SECRET` | Secret token for GitHub Actions cron calls | Yes |
| `ADMIN_PASSWORD` | Login password (set via Railway env vars) | No |
| `TIMEZONE_OFFSET` | Timezone offset in hours from UTC (default: 7 for WIB) | No |
| `DAY_START_HOUR` | Earliest hour to run checks (default: 7) | No |
| `DAY_END_HOUR` | Latest hour to run checks (default: 23) | No |

## Deployment (Railway)

Everything deploys to Railway as Docker containers.

### 1. Upstash Redis

1. Create free account at [upstash.com](https://upstash.com)
2. Create a new Redis database
3. Go to REST API tab → copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### 2. Deploy to Railway

1. Push to GitHub (code is already on GitHub)
2. Go to [railway.app](https://railway.app) → auto-checker project
3. In the `auto-checker-app` service, configure source to use GitHub repo `bryanbernigen/auto-checker`, branch `main`
4. Add environment variables:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `WAHA_URL` (use public URL: `https://auto-checker-waha-production.up.railway.app`)
   - `WAHA_API_KEY` (from WAHA dashboard)
   - `JWT_SECRET` — generate with `openssl rand -base64 32`
   - `CRON_SECRET` — any random string
5. Deploy

### 3. WAHA on Railway

1. In the same Railway project, add a new service with Docker image: `devlikeapro/waha:latest`
2. Add environment variables: `WAHA_SESSION=default`, `WAHA_DASHBOARD_USERNAME=admin`, `WAHA_DASHBOARD_PASSWORD=<your-password>`, `WAHA_API_KEY=<your-key>`
3. Note the public URL from Railway (e.g. `https://auto-checker-waha-production.up.railway.app`)
4. Update `auto-checker-app` `WAHA_URL` to the public WAHA URL

After WAHA deploys, open the WAHA dashboard URL, configure your WhatsApp session, and generate an API key if needed.

### 4. GitHub Actions (for random scheduling)

1. In your GitHub repo, go to Settings > Secrets and variables > Actions
2. Add `CRON_SECRET` matching the value in Railway
3. The workflow `.github/workflows/check.yml` runs every 1 minute and calls your Railway app URL

## Architecture

- **Next.js 15** (App Router, TypeScript) — UI and API routes
- **Upstash Redis** — cookie storage, last-seen state, activity log
- **GitHub Actions** — fires every 1 minute, Railway app handles scheduling logic
- **WAHA** (Docker) — sends WhatsApp messages

## Adding New Checkers

Create a new module in `lib/checkers/` implementing the `Checker` interface, then add it to `lib/checkers/index.ts`:

```typescript
// lib/checkers/mychecker/index.ts
export const myChecker: Checker = {
  name: 'MyChecker',
  async run() {
    // fetch, diff, notify logic
    return { checkerName: 'MyChecker', newItems: [], errors: [] };
  },
};
```

```typescript
// lib/checkers/index.ts
import { myChecker } from './mychecker';
export const checkers: Checker[] = [
  dataAnnotationChecker,
  myChecker, // add here
];
```
