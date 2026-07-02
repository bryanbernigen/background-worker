# Background Worker — Phase 5: Partial Rename + Root Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rename the fully-internal parts of `auto-checker → background-worker` and tidy the repo root, leaving externally-coupled renames as a documented checklist.

**Architecture:** Three mechanical tasks — package name, root cleanup (move the DA fixture into its module, delete debug leftovers), README product name — each ending in a build/test check + commit. No behavior changes.

**Tech Stack:** Next.js 16, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-background-worker-phase-5-design.md`.

## Global Constraints

- No behavior/feature changes. Full suite + `tsc --noEmit` + `npm run build` stay green.
- Do **not** touch external-coupled identifiers (`GITHUB_REPO_URL`, Northflank URL, README repo slug, `auto_checker` DB name) — those are the spec §4 checklist.
- Commit per task; end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Rename the package

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Edit `package.json`**

Change the name field:

```json
  "name": "background-worker",
```

- [ ] **Step 2: Match `package-lock.json`**

Update the two top-of-file `"name": "auto-checker"` occurrences (the root `"name"` and the `"packages": { "": { "name": ... } }` entry) to `"background-worker"`. Run: `npx json -I -f package-lock.json -e 'this.name="background-worker"; this.packages[""].name="background-worker"'` — or edit both by hand. Then verify no stale root name:

Run: `grep -n '"name": "auto-checker"' package.json package-lock.json || echo clean`
Expected: `clean`.

- [ ] **Step 3: Verify install integrity + commit**

Run: `npm install --package-lock-only 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no errors (`0`); lockfile stays consistent.

```bash
git add package.json package-lock.json
git commit -m "chore: rename package to background-worker"
```

---

### Task 2: Root cleanup — move fixture, delete debug files

**Files:** `.gitignore`, `example_response.html` → `lib/jobs/data-annotation/fixtures/example_response.html`, `lib/jobs/data-annotation/fetch.ts`, delete `example_headers.txt` + `cron_response.json`

- [ ] **Step 1: Un-ignore the fixture path**

In `.gitignore`, remove the line `example_response.html` (line ~48) so the fixture can be versioned inside the module.

- [ ] **Step 2: Move the fixture**

Run:
```bash
mkdir -p lib/jobs/data-annotation/fixtures
mv example_response.html lib/jobs/data-annotation/fixtures/example_response.html
```

- [ ] **Step 3: Update `fetch.ts` path**

In `lib/jobs/data-annotation/fetch.ts`, change the fixture path line:

```ts
      const examplePath = join(process.cwd(), 'lib/jobs/data-annotation/fixtures/example_response.html');
```

- [ ] **Step 4: Delete the debug leftovers**

Run: `git rm example_headers.txt cron_response.json`
Expected: both removed (they are tracked).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS" && npm run build 2>&1 | grep -E "Compiled|error TS" | head -2`
Expected: `0` errors; build compiles.

Optionally confirm the fixture resolves under the dev flag:
Run: `DATAANNOTATION_USE_LOCAL=true node -e "const fs=require('fs');const p='lib/jobs/data-annotation/fixtures/example_response.html';console.log('fixture exists:', fs.existsSync(p))"`
Expected: `fixture exists: true`.

```bash
git add .gitignore lib/jobs/data-annotation/fetch.ts lib/jobs/data-annotation/fixtures/example_response.html
git rm --cached example_headers.txt cron_response.json 2>/dev/null || true
git commit -m "chore: move DA fixture into module; drop root debug files"
```

---

### Task 3: README product name + full verification

**Files:** `README.md`

- [ ] **Step 1: Update the README title**

Change line 1 heading to the product name (leave the `bryanbernigen/auto-checker` repo slug and `auto_checker` DB name — those are the deferred checklist):

```md
# Background Worker
```

- [ ] **Step 2: Full verification**

Run: `npx vitest run 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | grep -c "error TS" && npm run build 2>&1 | grep -E "Compiled|error TS" | head -2`
Expected: all tests PASS; `0` type errors; build compiles.

- [ ] **Step 3: Confirm no stray in-scope references remain**

Run: `grep -rn "example_response.html\|example_headers\|cron_response" lib app --include=*.ts | grep -v fixtures || echo clean`
Expected: `clean` (the only `example_response.html` mention is the updated fetch.ts path pointing at `fixtures/`).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rename product to Background Worker in README"
```

---

## Self-Review

**Spec coverage:** §3.1 package name → Task 1 ✓; §3.2 root cleanup (fixture move + fetch.ts + delete debug) → Task 2 ✓; §3.3 README product name → Task 3 ✓. §4 deferred checklist correctly NOT executed. §5 testing → Tasks 1–3 verification steps ✓.

**Placeholder scan:** No TBD/TODO; exact files, edits, and commands throughout.

**Type consistency:** Only string/path edits; `fetch.ts` keeps the same `join(process.cwd(), <path>)` shape with the new relative path. No signatures change.
