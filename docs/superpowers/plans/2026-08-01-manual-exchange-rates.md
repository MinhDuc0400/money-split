# Manual Exchange Rates for Settle All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live exchange-rate API call behind the "Settle All" modal's reference-only total with manual, ephemeral rate entry, since the live API is unreliable.

**Architecture:** `SettleAllModal.tsx` (money-split-app) gains local `manualRates` state and an inline "Conversion rates" input block; its `rates`/`ratesBase` props are removed. `GroupDetail.tsx` stops fetching/passing live rates. A follow-up cleanup task deletes the now-unused `fetchExchangeRates` thunk, `exchangeRates` state, `EXCHANGE_RATES` API constant, and `ExchangeRatesResponse` type. The backend (`ExchangeRatesService`, cron, `GET /exchange-rates`, `ExchangeRate` table) is explicitly left untouched.

**Tech Stack:** React + TypeScript + Redux Toolkit (money-split-app), Vite build, no test runner configured in this package.

## Global Constraints

- Scope is `money-split-app` only. Do not touch `money-split-backend` or `money-split-mobile`.
- Manual rates are **not persisted** — component-local state only, reset when the modal's `displayCurrency` changes.
- Manual rates affect **only** the reference-only total. The real settlement payments (`onConfirm` / `handleConfirmSettleAll`) are untouched — still one payment per currency, unchanged by this feature.
- `money-split-app` has no test framework installed (confirmed: no `vitest`/`jest`/`@testing-library` in `package.json`, no `*.test.ts(x)` files exist). Do not introduce one as part of this plan — that's out of scope. Verification steps use the dev server (`npm run dev`) and manual interaction in the browser instead of automated tests, consistent with the rest of this package.
- Settle All button must never be disabled by missing/incomplete manual rates (matches today's non-blocking behavior for unconverted currencies).

---

### Task 1: Manual rate entry in Settle All modal

**Files:**
- Modify: `money-split-app/src/components/group-detail/SettleAllModal.tsx`
- Modify: `money-split-app/src/components/GroupDetail.tsx:19,60,64-70,501-502`

**Interfaces:**
- Consumes: `GroupSettlement` type (`money-split-app/src/types/group.types.ts:71-76`, fields `from`, `to`, `amount`, `currency`), `Currency`/`CURRENCIES` from `money-split-app/src/lib/currency.ts`, `formatAmount` from the same file.
- Produces: `SettleAllModalProps` no longer includes `rates` or `ratesBase`. Every other prop (`isOpen`, `onClose`, `onConfirm`, `items`, `fromMember`, `toMember`, `displayCurrency`, `onDisplayCurrencyChange`, `isLoading`, `error`, `title`) is unchanged, so `GroupDetail.tsx` is the only other file that needs updating in this task.

- [ ] **Step 1: Rewrite `SettleAllModal.tsx` to use local manual rates instead of props**

Replace the entire file contents with:

```tsx
import { Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useMemo, useEffect } from 'react';
import { formatAmount, CURRENCIES, type Currency } from '../../lib/currency';
import type { GroupSettlement } from '../../types/group.types';
import { Avatar } from '../Avatar';

interface SettleAllModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
    items: GroupSettlement[];
    fromMember: { name: string; avatar?: string };
    toMember: { name: string; avatar?: string };
    displayCurrency: Currency;
    onDisplayCurrencyChange: (currency: Currency) => void;
    isLoading?: boolean;
    error?: string | null;
    title?: string;
}

/** manualRates[fromCurrency] = how many units of `toCurrency` one unit of `fromCurrency` is worth. */
function convert(amount: number, fromCurrency: string, toCurrency: string, manualRates: Record<string, number>): number | null {
    if (fromCurrency === toCurrency) return amount;
    const rate = manualRates[fromCurrency];
    if (!rate) return null;
    return amount * rate;
}

export function SettleAllModal({
    isOpen,
    onClose,
    onConfirm,
    items,
    fromMember,
    toMember,
    displayCurrency,
    onDisplayCurrencyChange,
    isLoading = false,
    error = null,
    title = 'Settle all',
}: SettleAllModalProps) {
    const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
    const [manualRates, setManualRates] = useState<Record<string, number>>({});

    // Old manual rates were entered against the previous display currency and
    // no longer mean the same thing once the target changes — clear them
    // rather than silently reusing a rate against the wrong currency.
    useEffect(() => {
        setManualRates({});
    }, [displayCurrency]);

    const currenciesNeedingRate = useMemo(
        () => [...new Set(items.map((i) => i.currency))].filter((c) => c !== displayCurrency),
        [items, displayCurrency]
    );

    const { total, hasUnconverted } = useMemo(() => {
        let sum = 0;
        let unconverted = false;
        for (const item of items) {
            const converted = convert(item.amount, item.currency, displayCurrency, manualRates);
            if (converted === null) {
                unconverted = true;
            } else {
                sum += converted;
            }
        }
        return { total: sum, hasUnconverted: unconverted };
    }, [items, displayCurrency, manualRates]);

    function handleRateChange(currency: string, value: string) {
        setManualRates((prev) => {
            const next = { ...prev };
            if (value === '') {
                delete next[currency];
            } else {
                const parsed = Number(value);
                if (!Number.isNaN(parsed)) {
                    next[currency] = parsed;
                }
            }
            return next;
        });
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-card w-full max-w-md rounded-2xl p-6 relative z-10 border border-border/50 shadow-2xl"
                    >
                        <div className="flex justify-between items-start mb-6">
                            <h2 className="text-xl font-bold">{title}</h2>
                            <button onClick={onClose} disabled={isLoading} className="p-2 hover:bg-secondary rounded-full transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="flex items-center justify-between bg-secondary/30 p-4 rounded-2xl border border-border/50">
                                <div className="flex flex-col items-center gap-2">
                                    <Avatar name={fromMember.name} src={fromMember.avatar} className="w-14 h-14 border-2 border-primary/20" />
                                    <span className="text-sm font-bold truncate max-w-[80px]">{fromMember.name}</span>
                                </div>
                                <span className="text-muted-foreground text-xs">pays</span>
                                <div className="flex flex-col items-center gap-2">
                                    <Avatar name={toMember.name} src={toMember.avatar} className="w-14 h-14 border-2 border-primary/20" />
                                    <span className="text-sm font-bold truncate max-w-[80px]">{toMember.name}</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">This records {items.length} separate payments</p>
                                {items.map((item) => (
                                    <div key={`${item.currency}`} className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">{item.currency}</span>
                                        <span className="font-bold tabular-nums">{formatAmount(item.amount, item.currency)}</span>
                                    </div>
                                ))}
                            </div>

                            {currenciesNeedingRate.length > 0 && (
                                <div className="space-y-2 border-t border-border/50 pt-3">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Conversion rates</p>
                                    {currenciesNeedingRate.map((c) => (
                                        <div key={c} className="flex items-center gap-2 text-sm">
                                            <span className="text-muted-foreground whitespace-nowrap">1 {c} =</span>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                step="any"
                                                min="0"
                                                value={manualRates[c] ?? ''}
                                                onChange={(e) => handleRateChange(c, e.target.value)}
                                                placeholder="rate"
                                                className="w-24 bg-secondary/50 border border-border/50 rounded-lg px-2 py-1 text-xs tabular-nums"
                                            />
                                            <span className="text-muted-foreground whitespace-nowrap">{displayCurrency}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="border-t border-border/50 pt-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                        For reference only{hasUnconverted ? ' (some currencies not converted)' : ''}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrencyPicker((v) => !v)}
                                        className="text-xs text-primary underline"
                                    >
                                        shown in {displayCurrency}
                                    </button>
                                </div>
                                <p className="text-sm font-medium text-muted-foreground tabular-nums mt-1">
                                    ≈ {formatAmount(total, displayCurrency)} total
                                </p>
                                {showCurrencyPicker && (
                                    <select
                                        value={displayCurrency}
                                        onChange={(e) => onDisplayCurrencyChange(e.target.value as Currency)}
                                        className="mt-2 w-full bg-secondary/50 border border-border/50 rounded-lg px-2 py-1 text-xs"
                                    >
                                        {CURRENCIES.map((c) => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {error && (
                                <p className="text-sm text-destructive">{error}</p>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={onClose}
                                    disabled={isLoading}
                                    className="flex-1 px-4 py-3 rounded-xl border border-border font-bold text-sm hover:bg-secondary transition-all disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={onConfirm}
                                    disabled={isLoading}
                                    className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-black text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50"
                                >
                                    {isLoading ? (
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <Check className="w-4 h-4" />
                                            Settle all
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
```

- [ ] **Step 2: Remove the live-rates plumbing from `GroupDetail.tsx`**

In `money-split-app/src/components/GroupDetail.tsx`, line 19, change:

```tsx
import { settleAllApi, fetchExchangeRates, settleGuestApi, fetchTransactionsNextPage } from '../store/slices/groupSlice';
```

to:

```tsx
import { settleAllApi, settleGuestApi, fetchTransactionsNextPage } from '../store/slices/groupSlice';
```

Delete line 60:

```tsx
    const exchangeRates = useAppSelector((state) => state.groups.exchangeRates);
```

Delete lines 64-70 (the comment block and the `useEffect` that fetches rates):

```tsx
    // Always fetch with base=USD - the scheduled backend job only ever caches
    // rates with USD as the base (see Task 2), so this must not depend on
    // displayCurrency. SettleAllModal's convert() computes arbitrary
    // cross-rates (rate(A->B) = rates[B]/rates[A]) from this single table,
    // regardless of which currency the user picks to view the total in.
    useEffect(() => {
        dispatch(fetchExchangeRates('USD'));
    }, [dispatch]);
```

In the `<SettleAllModal ... />` JSX (around line 500), delete these two lines:

```tsx
                    rates={exchangeRates?.rates ?? {}}
                    ratesBase={exchangeRates?.base ?? 'USD'}
```

- [ ] **Step 3: Type-check**

Run: `cd money-split-app && npx tsc --noEmit`
Expected: no errors. (This confirms `SettleAllModalProps` and its one call site in `GroupDetail.tsx` agree — the TS excess-property check on JSX would fail the build if the two were out of sync.)

- [ ] **Step 4: Manual verification in the browser**

Run: `cd money-split-app && npm run dev`

In the running app, open a group that has balances in two different currencies (or create expenses in two currencies, e.g. one USD expense and one EUR expense, so two members owe each other in both). Open "Settle All":
- Confirm the "Conversion rates" block appears with one row per currency other than the currently displayed one, each with an empty numeric input.
- Type a rate (e.g. `1.08` for `1 EUR = 1.08 USD`) and confirm "≈ ... total" updates immediately and "(some currencies not converted)" disappears.
- Clear the input and confirm the total reverts to showing that currency as unconverted, and the "Settle all" button stays enabled the whole time.
- Click "shown in {currency}" and switch the display currency; confirm the rate input(s) reset to empty (per Step 1's `useEffect`).
- Click "Settle all" and confirm it still records one payment per currency as before (unchanged from pre-existing behavior).

- [ ] **Step 5: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add money-split-app/src/components/group-detail/SettleAllModal.tsx money-split-app/src/components/GroupDetail.tsx
git commit -m "feat(web): manual exchange rate entry in Settle All modal

Replace the live exchange-rate API dependency with inline manual rate
entry, scoped to the reference-only total. Real settlement payments
are unaffected — still one payment per currency, unchanged."
```

---

### Task 2: Remove now-unused live exchange-rate plumbing

**Files:**
- Modify: `money-split-app/src/store/slices/groupSlice.ts:4,33,55,165-170,540-543`
- Modify: `money-split-app/src/constants/api.constants.ts:35`
- Modify: `money-split-app/src/types/group.types.ts:95-100`

**Interfaces:**
- Consumes: nothing from Task 1 — this task only deletes code that Task 1 made unreachable (`fetchExchangeRates` thunk, `exchangeRates` state field, `EXCHANGE_RATES` endpoint constant, `ExchangeRatesResponse` type). Confirmed via repo-wide search that after Task 1 lands, none of these four symbols have any remaining reference.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Confirm nothing else references the symbols being removed**

Run: `cd /Users/ducnguyen/code/money-split && grep -rn "fetchExchangeRates\|exchangeRates\|EXCHANGE_RATES\|ExchangeRatesResponse" money-split-app/src`
Expected: only matches inside `money-split-app/src/store/slices/groupSlice.ts`, `money-split-app/src/constants/api.constants.ts`, and `money-split-app/src/types/group.types.ts` (the three files this task edits). If `GroupDetail.tsx` still shows up, Task 1 wasn't fully applied — stop and redo Task 1 first.

- [ ] **Step 2: Remove `EXCHANGE_RATES` from `api.constants.ts`**

In `money-split-app/src/constants/api.constants.ts`, delete line 35:

```ts
    EXCHANGE_RATES: (base: string) => `${API_BASE_URL}/exchange-rates?base=${base}`,
```

- [ ] **Step 3: Remove `ExchangeRatesResponse` from `group.types.ts`**

In `money-split-app/src/types/group.types.ts`, delete lines 95-100:

```ts
export interface ExchangeRatesResponse {
    base: string;
    date: string | null;
    rates: Record<string, number>;
    stale: boolean;
}
```

- [ ] **Step 4: Remove the thunk, state field, and reducer case from `groupSlice.ts`**

In `money-split-app/src/store/slices/groupSlice.ts`, line 4, change:

```ts
import type { UserBalanceResponse, GroupSettlement, GroupBalancesResponse, CreateSettlementRequest, ExchangeRatesResponse, SettleAllRequest, SettleGuestRequest } from '../../types/group.types';
```

to:

```ts
import type { UserBalanceResponse, GroupSettlement, GroupBalancesResponse, CreateSettlementRequest, SettleAllRequest, SettleGuestRequest } from '../../types/group.types';
```

Delete line 33 (inside the `GroupState` interface):

```ts
    exchangeRates: ExchangeRatesResponse | null;
```

Delete line 55 (inside `initialState`):

```ts
    exchangeRates: null,
```

Delete lines 165-170 (the thunk definition):

```ts
export const fetchExchangeRates = createAsyncThunk(
    'groups/fetchExchangeRates',
    async (baseCurrency: string) => {
        return await api.get<ExchangeRatesResponse>(API_ENDPOINTS.EXCHANGE_RATES(baseCurrency));
    }
);
```

Delete lines 540-543 (the reducer case), including its comment:

```ts
            // Fetch Exchange Rates
            .addCase(fetchExchangeRates.fulfilled, (state, action) => {
                state.exchangeRates = action.payload;
            })
```

- [ ] **Step 5: Type-check**

Run: `cd money-split-app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification in the browser**

Run: `cd money-split-app && npm run dev`

Repeat the Settle All check from Task 1 Step 4 (multi-currency group, open Settle All, type a manual rate, confirm total updates). This confirms the cleanup didn't regress the feature — the modal never depended on any of the removed symbols after Task 1.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducnguyen/code/money-split
git add money-split-app/src/store/slices/groupSlice.ts money-split-app/src/constants/api.constants.ts money-split-app/src/types/group.types.ts
git commit -m "chore(web): remove unused live exchange-rate plumbing

fetchExchangeRates, the exchangeRates Redux state, the EXCHANGE_RATES
endpoint constant, and the ExchangeRatesResponse type were all made
dead code by the move to manual rate entry in Settle All."
```
