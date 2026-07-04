# Product Review: Money-Split App (Design & Architecture Audit)

## Context

`money-split` is a bill-splitting app (React/Redux frontend in `split-money-app`, NestJS backend in `money-split-backend`) with Google OAuth login, group expense tracking, four split modes, real-time updates via websockets, and settlement/debt tracking.

The app is about to move from personal use to real use by friends and family. This spec defines a structured review — run as three independent role perspectives (Designer, Product Owner, Solution Architect) — to surface weaknesses before that happens, and to redesign the highest-priority UX issues.

## Goals

- Identify concrete weaknesses in business/product fit and UX, grounded in actually using the running app rather than reading code alone.
- Identify architecture weaknesses (security, data integrity, scale, ops readiness) that matter now that real users are involved.
- Produce a single prioritized findings list, not three disconnected reports.
- For the highest-priority UX findings, produce redesigned screen/flow concepts — not just written recommendations.

## Non-goals

- Mobile app (`money-split-mobile`) is out of scope for this review.
- No monetization/business-model review — this is a free tool for friends/family, not a commercial product.
- This spec does not implement any fixes. It defines the review process; fixes are scoped and executed afterward.

## Review structure

Three role-based passes, sequenced to avoid dev-server/browser contention (only one live preview session can run at a time):

**Phase 1 — Designer (live app, runs first)**
Starts the dev server and actually walks through the app as a user would, capturing screenshots at friction points. Focus: clarity, friction, visual consistency, mobile responsiveness, accessibility basics, empty/error states.

**Phase 2 — Product Owner + Solution Architect (parallel, after Phase 1)**
Both work from code plus the Designer's findings; neither needs the live app.

- **Product Owner** — evaluates through the lens "would a real friend group actually adopt this over Splitwise or mental math, and keep using it?" Focus: onboarding friction, feature completeness against the core job-to-be-done (splitting and settling shared expenses), missing/broken features that block adoption, copy clarity, trust signals.
- **Solution Architect** — reviews `money-split-backend` for real-user readiness. Focus: auth/security soundness (Google OAuth + JWT + websocket auth), data integrity under concurrent use, error handling and failure modes, query/scale patterns, operational readiness (logging, deploy setup).

## Designer walkthrough scope

Click through on both desktop and a mobile viewport, screenshotting each friction point:

1. First-time experience: `/login` → Google sign-in → empty dashboard (no groups yet). Does it guide the user toward creating/joining a group?
2. Group creation and joining via invite code.
3. Dashboard (`/`): aggregate balances across groups, currency handling, "you owe / you're owed" clarity.
4. Group list (`/groups`) and per-group dashboard (`/group/:id`): navigation clarity between global and group-scoped views.
5. **Add expense**: all four split modes (Even, Exact, Percentage, Shares). Also verify: can an expense be recorded involving someone who isn't a registered app user (a placeholder/guest participant)? The backend currently has no API for adding members outside the invite-code join flow — confirm what happens when a user tries (silent failure, unclear message, or the option simply doesn't exist).
6. **Edit expense** (separately from create): changing split type, payers, and amount on an existing expense; confirm balances and settlement plan recalculate correctly and the UI clearly signals "editing" vs. "creating."
7. Group detail (`/group/:id/details`): member balances, settlement plan, expense history — is it obvious who owes whom and why?
8. Settle up: recording a payment between two members.
9. Member management (`/group/:id/members`): add/rename member are currently disabled stubs (no backend endpoint) — document how this reads to a real user encountering a dead-looking control.
10. Leave/delete group: the balance-guard flow — does the UI clearly explain why an action is blocked?
11. Dark mode toggle; general empty and error states.

## Synthesis & prioritization

1. Collect all three reports.
2. Dedupe by root cause, not by role — if two roles flag the same underlying gap from different angles (e.g., Designer notices dead member-management UI, PO notices no way to split with a non-app-user), merge into one finding citing both perspectives.
3. Each finding records: which role(s) flagged it, a concrete example (screenshot for UX, code reference for architecture), a recommended fix, and a rough effort estimate (small/medium/large).
4. Bucket into three tiers:
   - **Must-fix before real users** — blocks trust, causes financial/data errors, or is a hard adoption blocker.
   - **Should-fix soon** — meaningfully improves the experience but isn't launch-blocking.
   - **Backlog** — polish and edge cases worth tracking but not urgent.

## Redesign deliverable

For "Must-fix" findings that are UX/design in nature, produce actual improved screen/flow concepts (mockups via the visual companion, offered at that point since layout comparisons are easier shown than described) rather than prose-only recommendations. Backend architecture findings remain written recommendations with code-level detail — "redesign" isn't the right shape for those.

## Output

A single consolidated report written to `docs/superpowers/reviews/2026-07-04-product-review-findings.md`, containing the ranked findings list and the redesign mockups for top UX items, plus this spec as the record of how the review was structured.
