# syntax=docker/dockerfile:1.7

# --- deps stage ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app
# git lets next.config.ts stamp the commit SHA into the build (.git is in context).
RUN apk add --no-cache git
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Next.js standalone output already bundles every prod dep transitively
# imported from the app — including instrumentation.ts which runs DB
# migrations on first boot, so no separate entrypoint step is needed.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migration SQL files are read at runtime by drizzle migrator.
COPY --from=build --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
