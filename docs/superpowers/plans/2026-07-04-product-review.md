# Product Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a structured 3-role review (Designer, Product Owner, Solution Architect) of the money-split app and produce one consolidated, prioritized findings report with redesign mockups for the top UX issues.

**Architecture:** Sequential-then-parallel: the Designer does a live-app walkthrough first (owns the one available dev-server/browser session) and writes findings to a file. The Product Owner and Solution Architect then each read that file plus the codebase independently and write their own findings files. A final synthesis task merges all three into one ranked report, and a redesign task produces mockups for the highest-priority UX findings.

**Tech Stack:** split-money-app (React 19 + Vite + Redux, dev server via Vite on port 5173), money-split-backend (NestJS, dev server via `start:dev` on port 3000), Claude Preview MCP tools for the live walkthrough, the `mcp__visualize` MCP for redesign mockups.

## Global Constraints

- Scope is `split-money-app` (live walkthrough) and `money-split-backend` (architecture review only, no live walkthrough) — `money-split-mobile` is explicitly out of scope.
- Business framing for the Product Owner pass: this is a free tool for friends/family, no monetization. Evaluate against "would a real friend group adopt this over Splitwise or mental math, and keep using it."
- The only configured database is a real remote Neon Postgres instance (`DATABASE_URL` in `money-split-backend/.env`) — there is no separate test database. All test data created during the live walkthrough MUST be named with a `[QA]` prefix and deleted at the end of Task 1.
- Frontend has no local `.env` (only `.env.production`, pointing at the deployed API). Task 1 creates a local `.env` (gitignored, confirmed via `.gitignore` lines 27-28) with `VITE_API_URL=http://localhost:3000` and `VITE_API_PUBLIC_URL=http://localhost:3000`.
- Backend dev server: `npm run start:dev` in `money-split-backend`, listens on port 3000 (from `.env`: `PORT=3000`).
- Frontend dev server: `npm run dev` in `split-money-app`, Vite default port 5173. Backend's `.env` already has `FRONTEND_URL=http://localhost:5173` and `GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback`, so Google OAuth login works against this local pairing without further config changes.
- All report files live under `docs/superpowers/reviews/` in the `money-split` repo (create the directory in Task 1 if missing).
- Task 1 must fully complete (including committing its report) before Tasks 2 and 3 start, since both read Task 1's output file.

---

## File Structure

- Create: `docs/superpowers/reviews/2026-07-04-designer-review.md` (Task 1 output)
- Create: `docs/superpowers/reviews/2026-07-04-po-review.md` (Task 2 output)
- Create: `docs/superpowers/reviews/2026-07-04-architect-review.md` (Task 3 output)
- Create: `docs/superpowers/reviews/2026-07-04-product-review-findings.md` (Task 4 output — consolidated ranked report)
- Create: `docs/superpowers/reviews/mockups/*.svg` (Task 5 output — one file per redesigned screen)
- Modify: `docs/superpowers/reviews/2026-07-04-product-review-findings.md` (Task 5 appends mockup references)
- Create (untracked, local only): `split-money-app/.env`

---

### Task 1: Designer — live-app walkthrough

**Files:**
- Create: `split-money-app/.env` (untracked)
- Create: `docs/superpowers/reviews/2026-07-04-designer-review.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `docs/superpowers/reviews/2026-07-04-designer-review.md` with the exact section structure below. Tasks 2 and 4 read this file and depend on that structure being present.

- [ ] **Step 1: Create local frontend env file**

```bash
cat > /Users/ducnguyen/code/split-money-app/.env <<'EOF'
VITE_API_URL=http://localhost:3000
VITE_API_PUBLIC_URL=http://localhost:3000
EOF
```

- [ ] **Step 2: Start the backend dev server**

Use `mcp__Claude_Preview__preview_start` (or, if `.claude/launch.json` doesn't yet have a `backend` entry, create one first):

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "backend", "runtimeExecutable": "npm", "runtimeArgs": ["run", "start:dev"], "port": 3000 },
    { "name": "frontend", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 }
  ]
}
```

Write this to `/Users/ducnguyen/code/money-split-backend/.claude/launch.json` for the backend, and `/Users/ducnguyen/code/split-money-app/.claude/launch.json` for the frontend (each repo needs its own launch.json with just its own entry, since `preview_start` resolves relative to the working directory it's invoked from). Then call `preview_start` with name `"backend"` from the backend repo context, and `"frontend"` from the frontend repo context.

Verify: `mcp__Claude_Preview__preview_logs` on the backend server shows `Nest application successfully started` (or equivalent) with no error-level lines.

- [ ] **Step 3: Start the frontend dev server and load it**

Call `preview_start` with name `"frontend"`. Then `preview_list` to get the `serverId`. Then `mcp__Claude_Preview__preview_screenshot` to confirm the login page renders.

Verify: screenshot shows a login screen with a Google sign-in control, and `mcp__Claude_Preview__preview_console_logs` (level: `error`) shows no errors.

- [ ] **Step 4: Walk through and document each flow**

For each item below, interact with the app via `preview_click`/`preview_fill`/`preview_navigate`, then capture evidence via `preview_screenshot` and `preview_snapshot`, and via `preview_resize` (preset `mobile`) for the mobile pass. Write one `### Finding` entry per concrete issue found (friction, confusing copy, missing feedback, inconsistent styling, broken control) using this exact template:

```markdown
### Finding: <short title>
- **Flow:** <which numbered flow below>
- **Viewport:** desktop | mobile
- **What happened:** <concrete description of what you did and saw>
- **Why it's a problem:** <user-facing impact>
- **Severity guess:** high | medium | low
```

Flows to walk (desktop first, then repeat 3, 5, 5a, 7, 9 on mobile via `preview_resize` preset `mobile`):

1. First-time experience: sign in with Google, land on empty dashboard with zero groups. Does it guide you to create/join a group?
2. Create a group named `[QA] Walkthrough Group`, and separately create a second account/browser-profile-less path is not available — instead test the "join via invite code" UI by copying the invite code and confirming the UI for sharing it is clear (you won't be able to fully join as a second user without a second Google account; note this limitation in the report if it blocks verification, and inspect the code/copy for clarity instead).
3. Dashboard (`/`): aggregate balance display, currency handling, "you owe / you're owed" clarity.
4. Group list (`/groups`) and per-group dashboard (`/group/:id`): navigation clarity.
5. Add an expense in each of the four split modes (Even, Exact, Percentage, Shares) inside `[QA] Walkthrough Group`. Also: while on the add-expense screen, look for any way to add a participant who isn't an existing joined member (a guest/placeholder). Record exactly what happens (option absent, disabled, or present).
5a. Edit one of the expenses you just created: change its split type, change the amount, change payers. Confirm the settlement plan and balances update, and that the UI clearly indicates you're editing (not creating a duplicate).
6. Group detail (`/group/:id/details`): member balances, settlement plan, expense history clarity.
7. Settle up: record a payment between two members (use your own account against itself if only one real member exists; note this limitation in the report).
8. Group detail again: confirm the settlement plan updates after settling.
9. Member management (`/group/:id/members`): attempt to add a member and rename a member; confirm both are disabled, and document the exact UI state (tooltip text, disabled styling) a real user would see.
10. Leave/delete group: attempt to delete `[QA] Walkthrough Group` while it still has any non-zero balance from Step 7's settlement testing if applicable; confirm the block message is clear.
11. Toggle dark mode; check one screen in dark mode for contrast/readability issues.

- [ ] **Step 5: Clean up test data**

Delete the `[QA] Walkthrough Group` (this requires all balances to be settled first — settle any remaining non-zero balances, then delete). Verify via the dashboard that the group no longer appears.

- [ ] **Step 6: Write the report file**

Write `docs/superpowers/reviews/2026-07-04-designer-review.md` with this structure:

```markdown
# Designer Review — Live App Walkthrough

**Date:** 2026-07-04
**Environment:** local frontend (localhost:5173) + local backend (localhost:3000), real Neon DB with `[QA]`-prefixed test data (deleted after review)

## Flows Walked
<list the 11 flows from Step 4, each marked Done, with a one-line note if a flow couldn't be fully verified (e.g., "could not test second-user join — only one Google account available")>

## Findings
<all `### Finding` entries from Step 4, in the order encountered>

## Summary
<3-5 sentence overview of the biggest patterns observed>
```

Verify: `grep -c "^### Finding" docs/superpowers/reviews/2026-07-04-designer-review.md` returns at least 1, and `grep -E "^## (Flows Walked|Findings|Summary)" docs/superpowers/reviews/2026-07-04-designer-review.md` returns all three headers.

- [ ] **Step 7: Stop the dev servers**

Use `mcp__Claude_Preview__preview_stop` on both server IDs.

- [ ] **Step 8: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add docs/superpowers/reviews/2026-07-04-designer-review.md
git commit -m "docs: add Designer live-app walkthrough findings"
```

(`split-money-app/.env` is gitignored and stays local — do not commit it.)

---

### Task 2: Product Owner review

**Files:**
- Read: `docs/superpowers/reviews/2026-07-04-designer-review.md`
- Read: `split-money-app/src/App.tsx`, `split-money-app/src/components/**`
- Create: `docs/superpowers/reviews/2026-07-04-po-review.md`

**Interfaces:**
- Consumes: `docs/superpowers/reviews/2026-07-04-designer-review.md` (from Task 1).
- Produces: `docs/superpowers/reviews/2026-07-04-po-review.md` with the section structure below. Task 4 reads this file.

- [ ] **Step 1: Read the Designer's findings**

Read `docs/superpowers/reviews/2026-07-04-designer-review.md` in full.

- [ ] **Step 2: Read the app's route/feature surface**

Read `split-money-app/src/App.tsx` for the full route list, and skim each component under `split-money-app/src/components/` (not the `dashboard/`, `group-detail/`, `member-manager/`, `expense-form/` sub-directories individually — those are implementation detail of the parent screens already covered) to confirm feature completeness against the core job-to-be-done: create a group, add expenses, split fairly, see who owes whom, settle up.

- [ ] **Step 3: Evaluate and write findings**

For each weakness found, write one `### Finding` entry using this template:

```markdown
### Finding: <short title>
- **Category:** onboarding | feature-gap | copy/trust | retention
- **Evidence:** <cite a Designer finding by title, or a specific file/route>
- **Why it matters for adoption:** <concrete reasoning tied to "would friends actually keep using this over Splitwise/mental math">
- **Recommendation:** <specific fix, not vague>
```

Explicitly evaluate: the guest/placeholder-participant gap surfaced in Designer Flow 5, the disabled member-management controls from Flow 9, and whether the empty first-time-experience (Flow 1) gives a new user enough guidance to succeed without external help.

- [ ] **Step 4: Write the report file**

```markdown
# Product Owner Review

**Date:** 2026-07-04
**Lens:** free tool for friends/family — adoption and retention against Splitwise/mental math as the alternative

## Findings
<all ### Finding entries>

## Summary
<3-5 sentence overview: is this ready for real users today, and what's the single biggest adoption risk>
```

Verify: `grep -c "^### Finding" docs/superpowers/reviews/2026-07-04-po-review.md` returns at least 1.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add docs/superpowers/reviews/2026-07-04-po-review.md
git commit -m "docs: add Product Owner review findings"
```

---

### Task 3: Solution Architect review

**Files:**
- Read: `money-split-backend/src/groups/groups.service.ts`, `money-split-backend/src/expenses/expenses.service.ts`, `money-split-backend/src/settlements/settlements.service.ts`, `money-split-backend/src/events/events.gateway.ts`, `money-split-backend/src/auth/**`
- Create: `docs/superpowers/reviews/2026-07-04-architect-review.md`

**Interfaces:**
- Consumes: nothing from Task 1 directly (runs independently; can execute in parallel with Task 2).
- Produces: `docs/superpowers/reviews/2026-07-04-architect-review.md`, read by Task 4.

- [ ] **Step 1: Review auth and security**

Read `money-split-backend/src/auth/` in full (Google OAuth strategy, JWT strategy/guards, `ws-jwt.guard.ts`). Check: are JWT secrets and Google credentials sourced only from environment variables (no hardcoded fallbacks)? Does the websocket gateway's `handleConnection` properly reject unauthenticated sockets (already reviewed once this session — confirm no regression)? Is CORS configured narrowly (`getAllowedOrigins()` in `events.gateway.ts`) rather than wide-open?

- [ ] **Step 2: Review data integrity under concurrency**

Read `groups.service.ts`, `expenses.service.ts`, `settlements.service.ts`. Confirm which money-affecting operations are wrapped in `$transaction` (this session already fixed `leave()`/`remove()` in `groups.service.ts` and extracted `updateDebtAtomic` — confirm those fixes are present) and flag any remaining check-then-write sequences that aren't transactional.

- [ ] **Step 3: Review error handling and operational readiness**

Check: does every controller endpoint have a corresponding NestJS exception filter or rely on default exception handling? Is there structured logging beyond ad-hoc `Logger` calls? Is there a health check endpoint (there is one, added recently — confirm what it actually checks, e.g. DB connectivity vs. just "process is up")? Is there any rate limiting on auth endpoints?

- [ ] **Step 4: Review scale patterns**

Grep for N+1 query patterns: any loop that calls `this.prisma.*` per-iteration instead of a single batched query (`findMany`/`createMany`). Check `getBalances`/`getGroupTransactions` in `expenses.service.ts` for whether they scale linearly with group size/expense count in a way that would matter for the group sizes this app realistically sees (friend groups, likely under 20 members).

- [ ] **Step 5: Write findings**

For each weakness, write one `### Finding` entry:

```markdown
### Finding: <short title>
- **Category:** security | data-integrity | error-handling | scale | ops
- **Location:** <exact file:line>
- **Risk:** <what breaks and under what condition>
- **Recommendation:** <specific fix>
- **Severity guess:** high | medium | low
```

- [ ] **Step 6: Write the report file**

```markdown
# Solution Architect Review

**Date:** 2026-07-04
**Scope:** money-split-backend only (code review, no live testing)

## Findings
<all ### Finding entries>

## Summary
<3-5 sentence overview: is the backend ready to hold real users' financial data today>
```

Verify: `grep -c "^### Finding" docs/superpowers/reviews/2026-07-04-architect-review.md` returns at least 1.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add docs/superpowers/reviews/2026-07-04-architect-review.md
git commit -m "docs: add Solution Architect review findings"
```

---

### Task 4: Synthesis — consolidated ranked findings

**Files:**
- Read: `docs/superpowers/reviews/2026-07-04-designer-review.md`, `docs/superpowers/reviews/2026-07-04-po-review.md`, `docs/superpowers/reviews/2026-07-04-architect-review.md`
- Create: `docs/superpowers/reviews/2026-07-04-product-review-findings.md`

**Interfaces:**
- Consumes: all three report files from Tasks 1-3.
- Produces: `docs/superpowers/reviews/2026-07-04-product-review-findings.md` with a `## Must-fix before real users` section whose entries Task 5 reads to decide which get mockups (only entries tagged `[UX]` there get a mockup; entries tagged `[Architecture]` do not).

- [ ] **Step 1: Read all three reports**

Read all three files from Tasks 1-3 in full.

- [ ] **Step 2: Dedupe by root cause**

Identify findings that describe the same underlying gap from different roles (e.g., a Designer finding about dead member-management controls and a PO finding about no guest-participant support both trace to "no backend API for ad-hoc group membership"). Merge these into one entry that cites all contributing role findings by title.

- [ ] **Step 3: Write the consolidated report**

```markdown
# Product Review — Consolidated Findings

**Date:** 2026-07-04
**Sources:** Designer live-app walkthrough, Product Owner review, Solution Architect review

## Must-fix before real users

Each entry:
### [UX or Architecture] <title>
- **Raised by:** <role name(s)>
- **Evidence:** <cite the specific finding(s) from the source reports>
- **Why it blocks real users:** <reasoning>
- **Recommendation:** <specific fix>
- **Effort:** small | medium | large

## Should-fix soon
<same entry format>

## Backlog
<same entry format, can be terser — title + one-line reasoning is enough>
```

- [ ] **Step 4: Verify coverage**

Run `grep -c "^### \[" docs/superpowers/reviews/2026-07-04-product-review-findings.md` and confirm the count is >= the total number of `### Finding` entries across all three source files minus however many were merged as duplicates (spot-check: every source finding should be traceable to exactly one consolidated entry).

- [ ] **Step 5: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add docs/superpowers/reviews/2026-07-04-product-review-findings.md
git commit -m "docs: consolidate product review findings into ranked report"
```

---

### Task 5: Redesign mockups for top UX findings

**Files:**
- Read: `docs/superpowers/reviews/2026-07-04-product-review-findings.md`
- Create: `docs/superpowers/reviews/mockups/<slug>.svg` (one per `[UX]`-tagged entry under "Must-fix before real users")
- Modify: `docs/superpowers/reviews/2026-07-04-product-review-findings.md`

**Interfaces:**
- Consumes: the `## Must-fix before real users` section of `docs/superpowers/reviews/2026-07-04-product-review-findings.md`, filtering to entries tagged `[UX]`.
- Produces: mockup SVG files referenced from the findings doc; no later task depends on this one.

- [ ] **Step 1: Identify UX entries needing mockups**

From `docs/superpowers/reviews/2026-07-04-product-review-findings.md`, list every entry under "Must-fix before real users" tagged `[UX]`.

- [ ] **Step 2: Call read_me before the first mockup**

Call `mcp__visualize__read_me` with `modules: ["mockup"]` once, silently, before producing any mockup (per that tool's own instructions).

- [ ] **Step 3: For each UX entry, produce a mockup**

Design the improved screen/flow addressing the finding. Show it via `mcp__visualize__show_widget` (so the user sees it live), and also write the same SVG source to `docs/superpowers/reviews/mockups/<slug>.svg` (slug = kebab-case of the finding title) so it's a durable artifact.

- [ ] **Step 4: Append mockup references to the findings doc**

For each `[UX]` entry, add a line directly beneath its `- **Recommendation:**` bullet:

```markdown
- **Mockup:** `docs/superpowers/reviews/mockups/<slug>.svg`
```

- [ ] **Step 5: Verify**

```bash
grep -c "^- \*\*Mockup:\*\*" docs/superpowers/reviews/2026-07-04-product-review-findings.md
ls docs/superpowers/reviews/mockups/*.svg
```

Confirm the mockup-reference count matches the number of `[UX]` entries under "Must-fix before real users," and every referenced file exists on disk.

- [ ] **Step 6: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add docs/superpowers/reviews/mockups/ docs/superpowers/reviews/2026-07-04-product-review-findings.md
git commit -m "docs: add redesign mockups for top UX findings"
```
