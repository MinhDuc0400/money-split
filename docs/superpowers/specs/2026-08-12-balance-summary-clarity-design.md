# Overview Balance Summary Clarity — Design Spec

Date: 2026-08-12
Status: Approved

## Problem 1: Confusing multi-currency layout

The Overview page's balance summary (`GlobalDashboard.tsx:54-87`) renders three tiers of text for a user with balances in multiple currencies:

1. A large hero number for the user's primary currency (`text-5xl`)
2. A small owed/owing sub-breakdown for that same primary currency (`text-sm`), which can show "$0.00 you owe" when one side is zero
3. A small net-only line per secondary currency (`text-sm`), with no label distinguishing it from line 2

The result reads as duplicated or contradictory — e.g. "$0.00 you owe" immediately followed by "you owe ¥111.00" — even though they're for different currencies, because nothing visually separates them and the size hierarchy implies line 1 is "the real total."

## Solution 1

Replace the three-tier structure with a single, uniform list: one line per currency with a non-settled net balance, all at the same size and weight.

```tsx
{currencyBalances.length === 0 ? (
    <>
        <p className="text-sm text-muted-foreground">Your balance</p>
        <p className="text-2xl font-bold mt-1">All settled</p>
    </>
) : (
    <div className="space-y-1">
        {currencyBalances.map(b => (
            <p key={b.currency} className={cn('text-xl font-bold', b.net > 0 ? 'text-positive' : 'text-negative')}>
                {b.net > 0 ? "You're owed" : 'You owe'} {formatAmount(Math.abs(b.net), b.currency)}
            </p>
        ))}
    </div>
)}
```

- One line per currency: "You're owed {amount}" (green) or "You owe {amount}" (red).
- `text-xl font-bold` for every line, regardless of sign or magnitude — matches the existing convention already used for per-currency balance amounts in `BalanceCard.tsx:25` (medium size, chosen for mobile-first readability over the previous oversized 5xl hero).
- No owed/owing sub-breakdown — this removes the zero-amount line entirely, since a currency only ever shows its net.
- Settled currencies render nothing (relies on the existing `currencyBalances` array, which already filters via `isBalanceSettled`).
- Sort order unchanged: largest `Math.abs(net)` first.
- "All settled" fallback retained, unchanged, for when every currency is settled.

## Scope

Only the "Hero balance" `<section>` in `money-split-app/src/components/GlobalDashboard.tsx` changes. The "Add expense" button, the groups list below, and every other component are untouched. The `primary`/`others` split (lines 49-50) and the old sub-breakdown/others-loop (lines 69-78) are removed since the new design treats every currency identically — no more primary/secondary distinction in the rendering.

## Problem 2: Ambiguous currency symbols

Investigation finding: `formatAmount`/`CURRENCY_SYMBOLS` in `money-split-app/src/lib/currency.ts` already map VND to `₫` correctly (suffix style, e.g. `"111.00₫"`) — the `¥` seen in a screenshot was not a VND bug. It was a genuine JPY or CNY balance, and those two currencies share the same `¥` glyph in `CURRENCY_SYMBOLS` (`JPY: '¥'`, `CNY: '¥'`), so a balance in either is indistinguishable from the other at a glance. The same collision also exists for `SEK`, `NOK`, and `DKK`, which all map to `'kr'`.

## Solution 2

Generalize rather than hardcode the two currencies noticed: derive which currency codes share a symbol with at least one other currency, and prefix those (only those) with their 3-letter code.

```ts
const SYMBOL_COUNTS = CURRENCIES.reduce<Record<string, number>>((acc, c) => {
    const sym = CURRENCY_SYMBOLS[c];
    acc[sym] = (acc[sym] ?? 0) + 1;
    return acc;
}, {});

const AMBIGUOUS_CURRENCIES = new Set(
    CURRENCIES.filter(c => SYMBOL_COUNTS[CURRENCY_SYMBOLS[c]] > 1)
);
```

In `formatAmount`, before the existing VND/THB suffix branch, add a prefix-with-code branch for any currency in `AMBIGUOUS_CURRENCIES`: `"{CODE} {symbol}{formatted}"`, e.g. `"CNY ¥111.00"`, `"JPY ¥50.00"`, `"SEK kr200.00"`. Unambiguous currencies (USD, EUR, VND, etc.) are unaffected — this only changes rendering for the codes that actually collide, computed once from the existing symbol table rather than a hardcoded pair, so it stays correct if more currencies are added later.

## Scope (both problems)

- Problem 1: `money-split-app/src/components/GlobalDashboard.tsx`, the "Hero balance" `<section>` only.
- Problem 2: `money-split-app/src/lib/currency.ts`, `formatAmount` (and a small addition near `CURRENCY_SYMBOLS`) only. `getCurrencySymbol` (used elsewhere for bare symbol lookups, e.g. input prefixes) is unchanged — this only affects `formatAmount`'s full amount+symbol output.
