# Background Worker — Phase 5 Design: Rename (partial) + Root Cleanup

**Date:** 2026-07-01
**Status:** Approved (brainstorm) — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-background-worker-platform-design.md` (§10a, §10b)
**Builds on:** Phases 1–4 (merged to `main`).

## 1. Goal

Finish the `auto-checker → background-worker` reframing: rename the parts that are
fully internal to the repo and clean up the root, while leaving anything coupled
to an external rename (GitHub repo, Northflank project/DB, local folder) as a
documented checklist to perform in lockstep with those external actions.

## 2. Locked Decision

**Internal-safe changes now; external-coupled renames as a checklist.** Nothing
executed in-session may 404 a link or break a deploy that depends on an external
name that hasn't been changed yet.

## 3. Changes to Execute Now

1. **`package.json` `"name"`** → `"background-worker"`; update the top-level
   `"name"` in `package-lock.json` to match (the lockfile's root package entry).
2. **Root cleanup:**
   - Move `example_response.html` → `lib/jobs/data-annotation/fixtures/example_response.html`
     (it's the `DATAANNOTATION_USE_LOCAL` dev fixture). It is **untracked** (gitignored
     by name) — move with `mv`, then `git add -f` the new path so the fixture is
     versioned with the module it belongs to. Update the `.gitignore` entry if it
     names the old root path.
   - Update `lib/jobs/data-annotation/fetch.ts`: the fixture path becomes
     `join(process.cwd(), 'lib/jobs/data-annotation/fixtures/example_response.html')`.
   - `git rm example_headers.txt cron_response.json` (unreferenced debug leftovers;
     both tracked).
3. **README product name:** update the title/description prose to "Background Worker".
   Do **not** touch the literal `bryanbernigen/auto-checker` repo slug, the
   `auto_checker` DB name, or the Northflank references (those are in the checklist).

## 4. Deferred Checklist (perform with the external renames — NOT in this session)

Recorded here so nothing is lost; each is coupled to an out-of-session action:

- **Local folder** `X:/playground/auto-checker` → `X:/playground/background-worker`
  (do it when no process/editor/terminal holds the directory).
- **GitHub repo** rename `auto-checker` → `background-worker`, then
  `git remote set-url origin https://github.com/bryanbernigen/background-worker.git`.
- **`lib/services.ts`**: `GITHUB_REPO_URL` and the Northflank project URL → the new
  slugs (flip only once the GitHub repo + Northflank project are actually renamed,
  or the dashboard's commit-footer links and the services list will 404).
- **README**: the `bryanbernigen/auto-checker` deploy reference and the
  `auto_checker` local-DB name.
- **Northflank**: service name + `DATABASE_URL` database name (`auto_checker`);
  cosmetic, can trail.

## 5. Testing

- `npx tsc --noEmit` + `npm run build` succeed; full Vitest suite stays green.
- The fixture-path change is only exercised under `DATAANNOTATION_USE_LOCAL=true`
  (a dev flag, not used in tests); confirm the new path resolves by a quick local
  check (optional).

## 6. Out of Scope

- No behavior/feature changes; DataAnnotation and the console work exactly as
  after Phase 4.
- The external-coupled renames (§4) are explicitly *not* executed here.

## 7. Open Questions

None.
