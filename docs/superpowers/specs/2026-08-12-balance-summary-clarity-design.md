# Overview Balance Summary Clarity — Design Spec

Date: 2026-08-12
Status: Approved

## Problem

The Overview page's balance summary (`GlobalDashboard.tsx:54-87`) renders three tiers of text for a user with balances in multiple currencies:

1. A large hero number for the user's primary currency (`text-5xl`)
2. A small owed/owing sub-breakdown for that same primary currency (`text-sm`), which can show "$0.00 you owe" when one side is zero
3. A small net-only line per secondary currency (`text-sm`), with no label distinguishing it from line 2

The result reads as duplicated or contradictory — e.g. "$0.00 you owe" immediately followed by "you owe ¥111.00" — even though they're for different currencies, because nothing visually separates them and the size hierarchy implies line 1 is "the real total."

## Solution

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

## Out of Scope

The VND amount rendering with a `¥`-style symbol (a possible `formatAmount`/`Intl.NumberFormat` currency-symbol mapping issue) is a separate, pre-existing concern unrelated to this layout fix — not addressed here.
