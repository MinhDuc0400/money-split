# Manual Exchange Rates for Settle All — Design

## Context

`money-split-app`'s "Settle All" modal (`src/components/group-detail/SettleAllModal.tsx`) shows a "for reference only" aggregate total when a group has balances in multiple currencies. That total is currently computed from live rates fetched via `GET /exchange-rates` (backed by `open.er-api.com`, cached daily by `money-split-backend/src/exchange-rates/exchange-rates.service.ts`).

The live API is unreliable. When rates are missing or stale, the modal shows "some currencies not converted" instead of a usable total. The actual settlement action is unaffected either way — each currency always settles as its own separate payment; exchange rates have never influenced real money movement, only this one display line.

Decision: replace the live-rate source with manual entry. Users type in the rate(s) they want, right when they're settling.

## Scope

- **In scope:** `money-split-app` only — `SettleAllModal.tsx` and its parent `GroupDetail.tsx`.
- **Out of scope:** Backend (`ExchangeRatesService`, cron, `GET /exchange-rates`, `ExchangeRate` table) — left in place, untouched, just no longer called from this modal. Mobile app — does not have this reference-total feature today, not adding it here.
- **Not persisted:** Manually entered rates live only for the lifetime of the open modal. Closing and reopening starts blank again. No new backend storage, no per-group settings, no permissions model needed — entering a rate is equivalent to typing an amount into any other transient form field.
- **Display-only:** Manual rates affect only the "reference only" aggregate total. They never change how many payments are recorded or in what currency — that remains one payment per currency pair, exactly as today.

## Design

### Removed
- `fetchExchangeRates` thunk call/dispatch in `GroupDetail.tsx`.
- `state.groups.exchangeRates` Redux slice state and its `fetchExchangeRates.fulfilled` reducer case.
- The `rates` / `ratesBase` props passed into `SettleAllModal`.
- The "Rates by ExchangeRate-API" attribution and any live/stale distinction.

### Added, inside `SettleAllModal.tsx`
- Local component state: `manualRates: Record<string, number>`, keyed by currency code. `manualRates['EUR'] = 1.08` means "1 EUR = 1.08 units of the current `displayCurrency`."
- A new "Conversion rates" block rendered between the payment breakdown and the reference total. One row per currency present in `items` that is not the current `displayCurrency`, each with a numeric input (defaults empty/blank).
- `convert(amount, fromCurrency, toCurrency, manualRates)` simplified: since there's only ever one hop (a given currency → the display currency), this drops the old base-currency triangulation (`rates[to]/rates[from]`) entirely. If `fromCurrency === toCurrency`, rate is `1`; otherwise look up `manualRates[fromCurrency]`, or treat as unconverted if absent.
- The reference total recomputes live as rates are typed.
- A currency with no rate entered keeps `hasUnconverted = true` for that row — same non-blocking behavior as today. The "Settle All" button is never disabled by missing/incomplete rates.
- The existing "shown in USD"-style display-currency selector is unchanged in behavior; switching it changes which currency the rate inputs convert into, and existing `manualRates` entries are interpreted against the newly selected display currency (i.e. switching display currency does not attempt to re-derive rates — the user re-enters them for the new target if needed).

### Data flow
No new API calls, no new backend types, no new database migration. `GroupDetail.tsx` stops fetching and passing rate data; `SettleAllModal` becomes self-contained for this feature.

## Testing

Component-level tests for `SettleAllModal`:
1. Typing a rate for a non-display currency updates the reference total.
2. Switching the display currency relabels the rate-entry rows (converting into the new target currency) rather than reusing old rate values against the new target.
3. Leaving a rate blank excludes that currency from the total (`hasUnconverted` stays true) without disabling "Settle All."
4. Submitting "Settle All" still records one payment per currency, unchanged by anything entered in the rate block.

## Self-review notes
- No placeholders remain; every requirement above maps to a concrete code change.
- Scope is a single, small, frontend-only change — no decomposition needed.
- Ambiguity resolved: switching display currency does NOT attempt to auto-recompute previously entered rates against the new base; user re-enters as needed (simplest, most predictable behavior, avoids silent wrong-rate math).
