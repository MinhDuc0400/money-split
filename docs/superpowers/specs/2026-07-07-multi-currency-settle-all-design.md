# Multi-Currency Support & "Settle All" Design

## Context

Money-split already tracks expenses/balances per currency as fully separate buckets (`MemberBalance` and `Debt` are both scoped by `(groupId, memberId/debtorId/creditorId, currency)`). The `Expense` model has a dead, never-read `exchangeRate` field — multi-currency conversion was never implemented. This was flagged as a gap in an earlier product audit this session.

The concrete pain point (screenshot-driven): a group with expenses in USD, GBP, and VND can end up with the same two members owing each other money in all three currencies simultaneously. Today the Settlement Plan shows three separate rows, each requiring its own "Settle" click. The user wants one "Settle All" action that batches all three into a single confirmation, with a combined-equivalent total shown for context.

## Goals

- Support a curated list of ~30-40 world currencies (not full ISO 4217), including VND.
- Source live daily exchange rates from a free, no-key public API, cached locally.
- Let a payer batch-settle every currency they owe a specific other member, in one action, with a combined total shown for reference.
- Never let currency conversion touch the actual ledger — every individual currency settlement still records its exact original amount. Conversion is informational only.

## Non-goals

- Converting/merging historical balances into a single currency permanently. Each currency's `MemberBalance`/`Debt`/`Settlement` history stays independently correct and reversible.
- Full ISO 4217 coverage (~180 currencies) — curated list only, expandable later.
- A paid/authenticated exchange-rate provider or a live fallback provider — identified as future work if the free source ever disappears, not built now.
- Changing how expenses are entered or how per-currency balances are calculated — this design only adds a new way to *settle* multiple currencies at once.

## Currency list

Maintained as static data in `money-split-app/src/lib/currency.ts` (extended from the current 6-currency list), not fetched from any API — currency codes/names/symbols are stable reference data that rarely changes.

Exact list (30 currencies — the current 6 plus 24 more covering major global, Southeast Asian, and other widely-used currencies), each confirmed present in ExchangeRate-API's rate table:

`USD, EUR, GBP, JPY, VND, THB, AUD, CAD, CHF, CNY, HKD, SGD, KRW, INR, IDR, MYR, PHP, NZD, SEK, NOK, DKK, PLN, CZK, TRY, ZAR, BRL, MXN, ILS, AED, SAR`

Each entry needs: ISO code, display name, symbol, and decimal-place count (most are 2; note for whoever implements this that JPY and VND are zero-decimal currencies in real-world usage — the existing `toCents`/`fromCents` helpers assume 2 decimals universally, which is a pre-existing simplification this design does not change or fix. It only affects display/rounding cosmetics for those two currencies today, not correctness of the ledger, since all math stays internally consistent within `toCents`'s own assumption — flagged here as a known follow-up, not in scope for this feature).

## Exchange rate data

- **Source**: ExchangeRate-API's free open-access endpoint (`open.er-api.com`), verified directly this session: no API key required, 166 currencies including VND, updates every 24 hours, free for commercial use (redistribution of raw data prohibited, internal use for display/conversion explicitly allowed), requires a discreet attribution link in the UI.
- **Caching**: a scheduled backend job fetches the full day's rate table once daily and stores it in a new `ExchangeRate` table (`baseCurrency`, `targetCurrency`, `rate`, `date`). All application reads hit this cache — the live API is never called on a user-facing request path.
- **Staleness handling**: if the cached rate data is more than 48 hours old, any UI that would show a converted total instead hides/flags it rather than displaying a misleadingly-precise stale number. The fetch job logs and alerts on failure so staleness doesn't go unnoticed.
- **Fallback**: none built now. Frankfurter (`api.frankfurter.dev`, ECB-backed, no key) is identified as the fallback candidate if ExchangeRate-API's free tier ever changes terms or disappears — noted here for whoever picks this up later, not implemented.
- **Unsupported currencies**: if a group has an expense currency outside the curated list (e.g. legacy data), that currency is excluded from any informational combined total but settles normally on its own — the total is a convenience, never a gate on functionality.

## Settle All

### Backend

**Endpoint**: `POST /groups/:id/settlements/settle-all`

**Request body**: `{ fromId, toId, items: [{ currency, amount }] }` — the client sends the exact currency/amount pairs it displayed (sourced from the same settlement-plan computation, i.e. `calculateMinimalTransfers` per currency, filtered to rows where this specific pair appears), not just the two member IDs for the server to blindly recompute.

**Why the explicit items list matters**: `calculateMinimalTransfers` is a minimal-transfer-count optimizer across the whole group, not a pairwise-net algorithm. In a 3+ member group, its optimal plan is not guaranteed to route every currency where two specific members have a mutual balance through a direct edge between them — a fresh backend recompute at execution time could disagree with what the UI showed and grouped together. Sending the exact previewed set, then validating it, closes this gap.

**Validation** (inside the transaction, before any writes): recompute each currency's current transfer amount for this pair and compare to what the client sent.
- Any mismatch (an amount changed, or that currency/pair no longer has a matching transfer) aborts the entire batch — no partial settlement — with a clear error: "Your balances changed. Refresh and try again."
- This also closes the preview-to-confirm race: if someone else records an expense or settlement between when the user opened the confirmation and when they tapped confirm, the mismatch is caught here rather than silently settling stale amounts.

**Execution**: once validated, loop the exact validated set through the existing `applySettlementInternal(tx, groupId, fromId, toId, amount, currency, note)` — unchanged, one call per currency, all inside one transaction (all-or-nothing).

**Idempotency**: the `Idempotency-Key` header (built earlier this session) is **required** for this endpoint specifically — not optional as it is for the single-settlement endpoints — given a batch settles multiple currencies in one action and the blast radius of an accidental double-submit is proportionally larger.

**Response**: includes the list of created settlements (one per currency, in their original amounts) plus the combined total and the exact exchange rate/date used to compute it, so any confirmation UI echoes back the same number the user approved rather than recomputing (avoids a harmless-but-confusing mismatch if the daily rate refresh job runs between the preview request and the confirm request).

**New read endpoint**: `GET /exchange-rates` returns the day's cached rate table relative to one base currency (e.g. `{ base: "USD", date: "...", rates: { EUR: 0.92, VND: 25400, GBP: 0.79, ... } }`). The frontend computes cross-rates itself (`rate(A→B) = rates[B] / rates[A]`) so a currency change in the UI recomputes the preview instantly with no extra round-trip.

### Frontend

- Same-pair currency rows in the Settlement Plan collapse into **one grouped card** per (payer, receiver) pair. Each original amount is listed on its own line (tabular-nums, mobile-safe — no single wrapped/truncated inline string).
- **"Settle all" is the single primary action** on that card. A secondary "settle just this one" link sits next to each individual currency line for the case someone wants to pay one currency at a time — replacing the earlier draft's 3 equal-weight "Settle" buttons plus a 4th competing "Settle All" button, which would have violated this app's own one-primary-action-per-view rule.
- The combined total **defaults to the group's currency** (not a blocking dropdown), shown as secondary/muted text with a small "shown in ___" link to change the display currency. Chosen over an always-shown currency picker specifically to keep "Settle all" a fast, low-friction action, since the displayed currency never affects what actually settles.
- Copy is explicit that the total is informational, directly adjacent to the figure: e.g. "For reference only — this records 3 separate payments." The real per-currency amounts stay visually primary (larger/higher-contrast); the converted total is visually secondary.
- Sentence case, verb-first button label ("Settle all"), no exclamation marks — matching `design-system/MASTER.md`'s existing content-voice rules.
- Attribution: a discreet "Rates by ExchangeRate-API" link, placed near the combined-total display or in a settings/about area — not prominent, per the API's own permitted-attribution terms.

## Review history

This design went through an independent 3-agent review (financial correctness, third-party dependency risk, UX) before being finalized. Two findings were blocking and are incorporated above: the matching-logic/preview drift (fixed via explicit client-sent items + server-side validation) and the "combined total" copy ambiguity (fixed via explicit "for reference only" framing and visual demotion). Should-fix findings (required idempotency key, rate-snapshot-for-receipt, unsupported-currency fallback, mobile stacking, staleness detection, failure alerting) are all incorporated above. One should-fix recommendation (defaulting the display currency instead of a dropdork picker) reversed an earlier decision in this same session — done with explicit sign-off after the tradeoff was presented, not silently.

## Testing

- Backend: TDD per this session's established pattern — unit tests for the validation-mismatch-abort path (using a mocked Prisma client), the happy-path multi-currency batch settlement, and the exchange-rate cache read/staleness-flagging logic, following the same style as `idempotency.helper.spec.ts`.
- Frontend: no test runner exists in this repo (confirmed earlier this session) — verification is `tsc --noEmit`, lint, and manual/live-preview click-through in both light/dark and desktop/375px, per `design-system/remaining-work.md`'s established verification pattern.
