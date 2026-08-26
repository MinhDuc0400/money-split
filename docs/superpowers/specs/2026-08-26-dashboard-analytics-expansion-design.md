# Dashboard Analytics Expansion Design

## Context

The group Dashboard (`money-split-app/src/components/Dashboard.tsx`) already shows one chart — a donut breakdown of spending by category (`SpendingByCategoryCard.tsx`, recharts `PieChart`/`Pie`/`Cell` plus a manual legend), fed by `GET /groups/:groupId/expenses/by-category` and a matching `categorySpending` slice in `groupSlice.ts`. There is no per-person spending view anywhere in the app today — only balance/debt views (`getBalances`, `getUserBalance`, `getSettlements`), which answer "who owes whom" but not "who spent what."

This design adds three new analytics cards that answer the second question: how much each person paid vs. is responsible for, how that breaks down by category per person, and which individual expenses are largest. All three reuse the existing category donut's visual/data patterns rather than introducing a new charting approach.

## Goals

- Add a **Spending by Person** donut chart with a Paid/Share toggle.
- Add a **Category breakdown per person** stacked bar chart (Share amounts only).
- Add a **Top Expenses** ranked list (top 5, clickable, opens the existing edit-expense modal).
- Give these three cards, plus the existing category donut, a home on the Dashboard page without cluttering the default view.
- Keep currency handling identical to the existing `by-category` endpoint: single-currency filter, no cross-currency conversion/aggregation.
- Keep member-to-color mapping consistent between the two charts that key color by person.

## Non-goals

- A "spending over time" trend chart — explicitly deferred, see Backlog below.
- Cross-currency aggregation or conversion in any new endpoint. All three endpoints filter to one currency at a time, exactly like `getSpendingByCategory` does today. The separate `GET /exchange-rates` endpoint (informational, client-side conversion for Settle All) is not used here.
- A dedicated expense-detail route/page. Top Expenses reuses the existing `EditExpenseModal.tsx`, opened the same way `GroupDetail.tsx` already opens it.
- Any change to how `SpendingByCategoryCard.tsx` fetches or renders its own data — it keeps its current props, thunk, and behavior unchanged; it only moves (see Placement below).
- Frontend automated test infrastructure. Confirmed in this pass: `money-split-app/package.json` has no test runner (`scripts` are only `dev`/`build`/`lint`/`preview`; no `jest`/`vitest`/`@testing-library/*` dependency), and no `SpendingByCategoryCard` test file exists anywhere in `money-split-app/src`. This repo's established frontend verification is `tsc --noEmit`, lint, and manual/live-preview click-through (confirmed by the `2026-07-07-multi-currency-settle-all` plan's Global Constraints and reconfirmed here) — the three new cards follow that same verification path, not new test files.

## Placement: Analytics tab on the Dashboard

No in-page tab/segmented-content component exists anywhere in this app today (`Layout.tsx`'s tabs are the bottom app-level nav — Overview/Groups/etc. — a different thing). Rather than stacking four charts into the always-visible Dashboard body (which is already a fairly tall page: summary cards, group details, quick stats), this design adds a small new two-way segmented control at the point where the category chart currently sits:

- **"Overview"** (default, selected on load) — the Dashboard exactly as it is today, ending with the Quick Stats row. No charts.
- **"Analytics"** — reveals all four cards in this order: Spending by Category (existing, unchanged), Spending by Person, Category breakdown per person, Top Expenses.

This is a new, small local component (e.g. `money-split-app/src/components/dashboard/AnalyticsTabs.tsx`), a pill-style toggle matching the app's existing segmented/pill visual language (the same `bg-secondary`/`bg-primary` two-state pattern already used for e.g. the "Optimized" badge and the Settle All modal's currency-picker link) — not a new dependency, not a generic tabs primitive. State is local `useState` in `Dashboard.tsx` (`const [dashboardTab, setDashboardTab] = useState<'overview' | 'analytics'>('overview')`), not persisted or synced to the URL — reopening the page always starts on Overview, matching how the rest of Dashboard state (e.g. no scroll position memory) already behaves.

All four analytics cards' data fetches are gated behind `dashboardTab === 'analytics'` being reached at least once (fetch-on-first-reveal, not fetch-on-mount) to avoid firing three extra network requests for users who never open the tab. Once fetched, switching back to Overview and back to Analytics does not refetch (existing Redux state simply hasn't been cleared) — same caching behavior the category chart already has implicitly today via its `[id, currency, dispatch]` effect.

## Chart 1: Spending by Person

### Backend

**Endpoint**: `GET /groups/:groupId/expenses/by-person?currency=&from=&to=&metric=paid|share`

- `metric` defaults to `paid` when omitted or invalid.
- `currency`/`from`/`to` semantics are byte-for-byte identical to `getSpendingByCategory` (`money-split-backend/src/expenses/expenses.service.ts:491-527`): if `currency` is omitted, look up the group's own currency and use that; `from`/`to` build an optional `date: { gte, lte }` filter; results are filtered to `deletedAt: null`.
- **Paid** = `ExpensePayer.amount` grouped by `memberId`, filtered through the parent `Expense`'s `groupId`/`deletedAt`/`currency`/`date`. Implemented as a single Prisma `groupBy`:
  ```ts
  this.prisma.expensePayer.groupBy({
    by: ['memberId'],
    where: { expense: { groupId, deletedAt: null, currency: effectiveCurrency, ...dateFilter } },
    _sum: { amount: true },
  });
  ```
- **Share** = the same shape, against `this.prisma.expenseSplit.groupBy(...)` instead of `expensePayer`.
- After the `groupBy`, join in member names: `this.prisma.groupMember.findMany({ where: { groupId, deletedAt: null } })`, map `memberId → name`, and **drop** any aggregate row whose `memberId` no longer resolves to an active member — this mirrors `getBalances`' existing convention (`expenses.service.ts:536-563`) of silently excluding removed members rather than surfacing a name-less row. (A removed member's historical paid/share amounts simply no longer appear in this chart; this is consistent with how balances already behave, not a new gap this design introduces.)
- Response type `PersonSpending`, added to `money-split-backend/src/expenses/types/expense-responses.type.ts` next to `CategorySpending`:
  ```ts
  export interface PersonSpending {
    memberId: string;
    name: string;
    totalCents: number;
  }
  ```
  Response: `PersonSpending[]`, one entry per active member with a non-zero sum for the selected metric (members with zero paid/share in the filtered range are simply absent from the array — same convention as `CategorySpending[]`, which only includes categories with `totalCents > 0` after the frontend's own filter in `SpendingByCategoryCard.tsx`; here the omission happens because `groupBy` only returns groups that exist).
- Controller method `getSpendingByPerson` added to `ExpensesController` (`money-split-backend/src/expenses/expenses.controller.ts`), directly after `getSpendingByCategory`, following its exact `@Query()` param style (no new DTO — this endpoint's query params are as simple as `by-category`'s, so it stays consistent rather than introducing a validated DTO only here).
- Service method `getSpendingByPerson(groupId, userId, currency?, from?, to?, metric?: 'paid' | 'share')` added to `ExpensesService`, directly after `getSpendingByCategory`, reusing the exact same `assertActiveMember` + `effectiveCurrency` + `dateFilter` logic (extract no shared helper for this pass — the existing code doesn't have one either, and introducing one is out of scope; each new method duplicates the ~10-line preamble the way `getSpendingByCategory` already stands alone).

### Frontend

- New component `money-split-app/src/components/dashboard/SpendingByPersonCard.tsx`, structurally a copy of `SpendingByCategoryCard.tsx`'s donut + legend, with these differences:
  - A `metric` toggle (two small pill buttons, "Paid" / "Share") above the chart. Local `useState<'paid' | 'share'>('paid')` inside the card — changing it triggers a new fetch (see thunk below), it does not filter client-side data already in memory, since paid vs. share are two different backend aggregations.
  - Chart segments keyed by `memberId` instead of `category`; colors from the new `getMemberColor(memberId)` helper (see Color consistency below) instead of `CATEGORY_COLORS`.
  - Legend rows show name, amount (`formatAmount`), and percentage of the total for the currently active metric (`(totalCents / sumOfAllTotalCents) * 100`, matching the existing category card's implicit visual proportion but making the percentage explicit as new text, since the task decision calls for showing it).
  - Same `data`/`isLoading`/`error` prop contract as `SpendingByCategoryCardProps`, so `data: PersonSpending[] | null`.
- Types: add `PersonSpending` to `money-split-app/src/types/expense.types.ts`, next to `CategorySpending`:
  ```ts
  export interface PersonSpending {
      memberId: string;
      name: string;
      totalCents: number;
  }
  ```
- API constant: `EXPENSES_BY_PERSON: (id: string, currency?: string, metric?: 'paid' | 'share') => ...` added to `API_ENDPOINTS.GROUPS` in `money-split-app/src/constants/api.constants.ts`, next to `EXPENSES_BY_CATEGORY`, building the query string the same way (`?currency=X&metric=Y`, omitting each param when undefined).
- Redux: in `money-split-app/src/store/slices/groupSlice.ts`, add `spendingByPerson: PersonSpending[] | null`, `spendingByPersonLoading: boolean`, `spendingByPersonError: string | null` to `GroupState`/`initialState`, and a `fetchSpendingByPerson` thunk taking `{ groupId, currency, metric }`, mirroring `fetchSpendingByCategory` (`groupSlice.ts:109-114`) and its three `.addCase` reducers (`groupSlice.ts:519-531`) exactly.
- `Dashboard.tsx` dispatches `fetchSpendingByPerson({ groupId: id, currency, metric })` once the Analytics tab is first revealed, and again whenever `metric` (lifted to `Dashboard.tsx` state, passed down as a prop + `onMetricChange` to `SpendingByPersonCard`) or `currency` changes — same `useEffect` dependency-array shape as the existing category-spending effect (`Dashboard.tsx:52-58`).

## Chart 2: Category breakdown per person

### Backend

**Endpoint**: `GET /groups/:groupId/expenses/by-person-category?currency=&from=&to=`

- Same `currency`/`from`/`to` semantics as above (single currency, group-default fallback, optional date range, `deletedAt: null`).
- **This is a member × category group-by that spans a relation** (`ExpenseSplit → Expense.category`). Prisma's `groupBy` cannot use a related model's field as a group key — `category` lives on `Expense`, not `ExpenseSplit`, and `by: [...]` may only reference fields on the model being queried. Per the explicit decision for this pass: do **not** reach for raw SQL. Instead, fetch the filtered `ExpenseSplit` rows with the parent expense's category included, then aggregate in application code:
  ```ts
  const splits = await this.prisma.expenseSplit.findMany({
    where: { expense: { groupId, deletedAt: null, currency: effectiveCurrency, ...dateFilter } },
    select: { memberId: true, amount: true, expense: { select: { category: true } } },
  });

  const totals = new Map<string, number>(); // key: `${memberId}::${category}`
  for (const s of splits) {
    const key = `${s.memberId}::${s.expense.category}`;
    totals.set(key, (totals.get(key) ?? 0) + toCents(Number(s.amount)));
  }
  ```
  Expense volume per group is small (this app has no pagination on the expense list itself — `Dashboard`/`GroupDetail` load a group's full expense list in one response), so fetching all matching splits and reducing in memory is simpler and safer than a raw SQL group-by, per the explicit decision for this chart.
- Same active-member filter/name-join and same silent-drop-if-removed convention as Chart 1.
- Response type `PersonCategorySpending`, added next to `PersonSpending`:
  ```ts
  export interface PersonCategorySpending {
    memberId: string;
    name: string;
    category: string;
    totalCents: number;
  }
  ```
  Response: `PersonCategorySpending[]`, one row per (member, category) combination that has a non-zero sum — i.e. a flat list, not pre-nested by member. The frontend pivots it into per-member stacked-bar segments (below).
- Service method `getSpendingByPersonCategory`, controller method `getSpendingByPersonCategory`, both placed directly after the Chart 1 additions, same structural conventions.

### Frontend

- New component `money-split-app/src/components/dashboard/CategoryByPersonCard.tsx` using recharts `BarChart` with `stackId` — new to this codebase (the existing chart is a `PieChart`), so this is the one genuinely new recharts usage pattern in this feature, not a copy of an existing component. Layout convention (card wrapper, loading/error/empty states, `ResponsiveContainer`, tabular-nums legend/tooltip amounts) still mirrors `SpendingByCategoryCard.tsx`.
- Frontend pivot: `PersonCategorySpending[]` → one row per member, one key per `ExpenseCategory` (using `CATEGORY_ORDER` from `expenseCategories.ts` for consistent stacking order), amount in major units (`totalCents / 100`) as the `Bar`'s `dataKey` value, `0` for any (member, category) pair absent from the response (no spending in that category).
- **Segment colors reuse `CATEGORY_COLORS` from `money-split-app/src/lib/expenseCategories.ts`** — one `<Bar dataKey={category} stackId="a" fill={CATEGORY_COLORS[category]} />` per category in `CATEGORY_ORDER`, so a category's color matches the existing donut chart exactly. The X axis is member name; bars are colored by category, not by member (member color from `memberColors.ts` is not used on this chart — it's reserved for charts that key color *by person*, i.e. Chart 1 here and nothing else, since this chart's segments are categories).
- Legend: a shared category legend (reuse `CATEGORY_LABELS`/`CATEGORY_ICONS`/`CATEGORY_COLORS`, same rendering as the category donut's own legend) below the chart, not a per-member legend.
- Types: add `PersonCategorySpending` to `money-split-app/src/types/expense.types.ts`.
- API constant: `EXPENSES_BY_PERSON_CATEGORY: (id: string, currency?: string) => ...`.
- Redux: `spendingByPersonCategory: PersonCategorySpending[] | null` + loading/error, `fetchSpendingByPersonCategory` thunk, mirroring the same pattern again.
- Fetched on first Analytics-tab reveal and on `currency` change, same as Chart 1 (no `metric` param here).

## Chart 3: Top Expenses

### Backend

**Endpoint**: `GET /groups/:groupId/expenses/top?currency=&from=&to=&limit=`

- Same `currency`/`from`/`to` semantics as the other two. `limit` defaults to `5` if omitted or non-numeric; clamped to a maximum of `20` (prevents an accidental huge payload; 20 is generous headroom over the "top 5" requirement without inventing unbounded pagination for a card that only ever shows a short list).
- Query: `this.prisma.expense.findMany({ where: { groupId, deletedAt: null, currency: effectiveCurrency, ...dateFilter }, include: { payers: { include: { member: true } } }, orderBy: { amount: 'desc' }, take: limit })`. Payer names are joined directly via the existing `payers.member` relation — no extra query needed.
- Response type `TopExpenseItem`, added next to `PersonCategorySpending`:
  ```ts
  export interface TopExpenseItem {
    id: string;
    description: string;
    amount: number;      // major units, e.g. 42.50 — matches ExpenseResponse.amount's convention, not totalCents (this is a list of individual records, not an aggregated sum)
    currency: string;
    category: string;
    date: Date;
    payerNames: string[]; // active + removed members both included by name, same as how ExpensePayer.member is joined elsewhere with no deletedAt filter (e.g. ExpenseResponse.payers already does this) — the "who paid" attribution for a specific past expense should not silently drop a name just because that member later left the group
  }
  ```
  Note the deliberate asymmetry with Chart 1/2's active-member-only filtering: those are group-by aggregates keyed by `memberId` where a name-less row would be meaningless, so removed members are dropped. This endpoint is a list of individual expense records where each one already has a well-defined identity independent of its payers — dropping or blanking a payer's name here would misrepresent a real past expense, so removed members' names are kept. This mirrors the existing `ExpenseResponse.payers` mapping in `getGroupTransactions`/`updateExpense`, which already includes payer names unconditionally.
- Service/controller methods `getTopExpenses`, same placement convention as the other two.

### Frontend

- New component `money-split-app/src/components/dashboard/TopExpensesCard.tsx`: a simple ranked list (rank number or medal-style styling optional, description, category icon, amount right-aligned tabular-nums, payer names as small muted subtext), each row a `<button>` (full-width, left-aligned, hover/active state matching the existing bordered-row density rule from `design-system/MASTER.md` — "dense lists use bordered rows, not a card wrapper per row" — so individual rows are `border-b border-border` inside the one card wrapper, not five separate cards).
- **Opening the edit modal**: clicking a row does not use the backend response's `TopExpenseItem` directly as `EditExpenseModal`'s `initialData` (that type is intentionally slim — id/description/amount/currency/category/date/payerNames — and does not carry full `splits`/`payers` detail needed by the edit form). Instead, the click handler looks up the full `Expense` object by `id` from the group's already-loaded `expenses` array (`useGroup()`'s `expenses`, which is `activeGroup.expenses` — the complete, unpaginated list `GET /groups/:id` already returns) and derives `initialFormData` the same way `GroupDetail.tsx` already does (`GroupDetail.tsx:298-325`: `expenseToEdit` lookup by id, then the `initialFormData` `useMemo` mapping `description`/`amount`/`currency`/`payerId`/`payers`/`splitType`/`category`/`splits`/`manualAmounts`). `Dashboard.tsx` needs its own `editingExpenseId` state, `updateExpense` from `useGroup()`, and its own `<EditExpenseModal>` render — this exact wiring does not currently exist on `Dashboard.tsx` (only `GroupDetail.tsx` has it today) and must be added there, duplicating the pattern rather than trying to lift it into a shared hook (out of scope for this pass — flagged as a reasonable follow-up refactor, not required here).
- Types: add `TopExpenseItem` to `money-split-app/src/types/expense.types.ts`.
- API constant: `EXPENSES_TOP: (id: string, currency?: string, limit?: number) => ...`.
- Redux: `topExpenses: TopExpenseItem[] | null` + loading/error, `fetchTopExpenses` thunk, mirroring the same pattern (called with `limit: 5` from `Dashboard.tsx` — the card's fixed top-5 requirement, even though the backend supports up to 20, keeps the door open for a future "see more" without a new endpoint).

## Currency and date filtering semantics (all three endpoints)

Identical across `by-category` (existing), `by-person`, `by-person-category`, and `top`:

- `currency` query param, when provided, filters `Expense.currency` to exactly that value.
- When omitted, the effective currency defaults to the group's own `currency` (one extra `group.findUnique` lookup, exactly as `getSpendingByCategory` already does).
- Expenses in any other currency are **silently excluded** — there is no cross-currency conversion or a combined multi-currency total anywhere in this feature. This was an explicit decision to stay consistent with the existing `by-category` endpoint's behavior and avoid introducing new conversion logic (the separate `GET /exchange-rates` informational-conversion endpoint from the multi-currency/Settle-All feature is unrelated and unused here).
- `from`/`to`, when provided, build a `date: { gte: new Date(from), lte: new Date(to) }` filter (either bound may be provided alone). When neither is provided, no date filter is applied — full history.
- `deletedAt: null` is always applied to exclude soft-deleted expenses.
- None of the three new endpoints currently have a frontend UI for picking `from`/`to` or a non-default `currency` — the query params exist in the endpoint contract (for parity with `by-category`, which also accepts but doesn't yet expose them in the UI) but this pass's frontend thunks call them with only `groupId`/`currency` (defaulting to the group's currency, matching how `fetchSpendingByCategory` is called from `Dashboard.tsx` today). Date-range filtering UI is out of scope, same as it already is for the category chart.

## Color consistency

- **Member colors** (Chart 1 donut, keyed by person): new module `money-split-app/src/lib/memberColors.ts`, mirroring `expenseCategories.ts`'s structure — a fixed palette array of distinct, colorblind-tolerant hex hues (reuse the same 9 hues already vetted in `CATEGORY_COLORS` plus 3 more to give headroom for groups with more members than categories, e.g. add `#a855f7`, `#0ea5e9`, `#84cc16`) and one function:
  ```ts
  const MEMBER_COLOR_PALETTE = [
      '#f97316', '#3b82f6', '#8b5cf6', '#eab308', '#ec4899',
      '#14b8a6', '#06b6d4', '#ef4444', '#64748b', '#a855f7',
      '#0ea5e9', '#84cc16',
  ];

  export function getMemberColor(memberId: string): string {
      let hash = 0;
      for (let i = 0; i < memberId.length; i++) {
          hash = (hash * 31 + memberId.charCodeAt(i)) | 0;
      }
      return MEMBER_COLOR_PALETTE[Math.abs(hash) % MEMBER_COLOR_PALETTE.length];
  }
  ```
  Deterministic per `memberId` string (a stable UUID that doesn't change), so the same member always gets the same color across page loads, across the donut and — if a per-member color is ever needed elsewhere later — anywhere else in the app, with no server-side storage or assignment step needed. A 12-color palette with hash-mod assignment means two members can collide onto the same color in a large group; this is an accepted cosmetic limitation (same class of tradeoff `CATEGORY_COLORS` already accepts by being a fixed 9-color set) rather than building a collision-avoidance scheme.
- **Category colors** (Chart 2 stacked bars, keyed by category, and the existing donut): reuse `CATEGORY_COLORS` from `expenseCategories.ts` directly — no new palette, no changes to that file.
- Chart 1 and Chart 2 never need to agree on color with each other (one keys by person, the other by category) — the consistency requirement is only "Chart 1's donut and any other person-keyed view use the same person→color mapping," which `getMemberColor` alone satisfies since it's the only person-keyed chart in this pass.

## Loading / error / empty states

All three new cards follow `SpendingByCategoryCard.tsx`'s exact prop and rendering contract:

```ts
interface <X>CardProps {
    data: <ResponseType>[] | null;
    currency: string;
    isLoading: boolean;
    error?: string | null;
}
```

- `isLoading` → skeleton (`<div className="h-48 rounded-xl bg-muted animate-pulse" />`, or a proportionally taller one for the stacked-bar and list cards).
- `error` (truthy) → `<p className="text-sm text-destructive py-8 text-center">Couldn't load ...</p>` with a card-specific message.
- `data === null` or an empty array after any client-side filtering → `<p className="text-sm text-muted-foreground py-8 text-center">No expenses yet this period</p>` (or a card-specific variant, e.g. Top Expenses: "No expenses yet").
- Otherwise render the chart/list.

## State management

Four independent `{ data, loading, error }` triples added to `GroupState` in `money-split-app/src/store/slices/groupSlice.ts` (three new ones — `spendingByPerson`, `spendingByPersonCategory`, `topExpenses` — the existing `categorySpending` triple is unchanged), each with its own thunk (`fetchSpendingByPerson`, `fetchSpendingByPersonCategory`, `fetchTopExpenses`) and three `.addCase` reducers (`pending`/`fulfilled`/`rejected`), copied line-for-line in structure from `fetchSpendingByCategory`'s existing thunk (`groupSlice.ts:109-114`) and reducers (`groupSlice.ts:519-531`). No new slice file — these live in the same `groupSlice.ts` the category chart already uses, consistent with how `exchangeRates` and other recent additions were also folded into this one slice rather than split out.

## Backlog (not designed, not planned this pass)

**Spending over time** — a trend chart (e.g. total spend per week/month across the group's lifetime, or per-member over time) was raised during brainstorming and explicitly deferred. It would need its own endpoint (likely a date-bucketed `groupBy` on `Expense.date` truncated to week/month, which Prisma doesn't do natively — would need either raw SQL with `date_trunc` or in-app bucketing similar to Chart 2's approach here) and its own chart type (recharts `LineChart`/`AreaChart`, new to this codebase). Noted here only as a placeholder for a future design pass — no endpoint shape, no component, and no schema changes for it are decided or planned.

## Testing

- **Backend**: unit tests for `getSpendingByPerson`, `getSpendingByPersonCategory`, and `getTopExpenses` in `money-split-backend/src/expenses/expenses.service.spec.ts`, mirroring the existing `getSpendingByCategory` describe block (`expenses.service.spec.ts:171-295`) test-by-test: membership check (`ForbiddenException` when not an active member), currency-provided-vs-defaulted-from-group behavior, date-range filter presence/absence, soft-delete exclusion, and the aggregation/conversion-to-cents correctness itself (for Chart 1: paid vs. share produce different sums from the same fixture; for Chart 2: the in-memory member×category reduction sums correctly and a member/category combination with zero spend is simply absent; for Chart 3: sort-descending-by-amount, `limit` truncation, and default `limit=5` when omitted). Same mocked-`PrismaService` style already used throughout this file (`expenses.service.spec.ts:17-47`) — no live DB in unit tests.
- **Frontend**: no test runner exists in `money-split-app` (confirmed above under Non-goals) and no test file exists for `SpendingByCategoryCard` to mirror — so, consistent with the `2026-07-07-multi-currency-settle-all` plan's precedent, verification for all three new cards is `tsc --noEmit`, lint (`npx eslint`), and manual/live-preview click-through of each state (loading, error, empty, populated, and — for Chart 1 — both metric toggle positions) in both light/dark mode and at a 375px viewport. No new frontend test files are planned.
