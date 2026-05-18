# Auto Checker

Monitors DataAnnotation projects API on a random 5-30 minute schedule and sends WhatsApp alerts via WAHA when new paid projects or qualifications are detected.

## Quick Start (Local Development)

```bash
npm install
cp .env.local.example .env.local
# Fill in .env.local with your values
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `KV_REST_API_URL` | Vercel KV REST API URL | Yes |
| `KV_REST_API_TOKEN` | Vercel KV REST API token | Yes |
| `WAHA_URL` | WAHA API base URL (e.g. http://localhost:3001) | Yes |
| `WAHA_API_KEY` | WAHA API key (optional) | No |
| `JWT_SECRET` | Secret for signing session JWT (min 32 chars) | Yes |
| `CRON_SECRET` | Secret token for GitHub Actions cron calls | Yes |
| `ADMIN_PASSWORD` | Login password (default: P@assword123) | No |

## Deployment

### 1. Vercel

1. Push to GitHub
2. Import project in Vercel dashboard
3. Add environment variables in Vercel project settings:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `WAHA_URL`
   - `WAHA_API_KEY` (if using)
   - `JWT_SECRET`
   - `CRON_SECRET`
4. Deploy

### 2. Vercel KV Setup

1. Go to Storage in Vercel dashboard
2. Create a new KV database (Vercel KV)
3. Copy the REST API URL and token
4. Add to Vercel environment variables

### 3. GitHub Actions (for random scheduling)

1. In your GitHub repo, go to Settings > Secrets and variables > Actions
2. Add these secrets:
   - `VERCEL_CRON_URL` — your Vercel app URL (e.g. https://auto-checker.vercel.app)
   - `CRON_SECRET` — must match the CRON_SECRET env var in Vercel
3. The workflow `.github/workflows/check.yml` runs every 1 minute and calls your Vercel API

### 4. WAHA Setup

WAHA must be running and accessible. Options:
- **Local** (for development): Run WAHA locally on port 3001
- **Production**: Deploy WAHA on Railway, Render, or similar

Set `WAHA_URL` to the accessible URL of your WAHA instance.

## Architecture

- **Next.js 15** (App Router, TypeScript) — UI and API routes
- **Vercel KV** — cookie storage, last-seen state, activity log
- **GitHub Actions** — fires every 1 minute, Vercel API handles scheduling logic
- **WAHA** — sends WhatsApp messages

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
