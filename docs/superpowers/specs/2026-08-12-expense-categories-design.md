# Expense Categories + Spending Insights — Design Spec

Date: 2026-08-12
Status: Approved

## Problem & Goal

Every expense today is a flat line item — description, amount, who paid, how it's split. There's no way to answer "where does our group's money actually go" without manually reading the whole history. Goal: let users tag an expense with a category, and see a spending breakdown on the dashboard.

## Data Model

Extend the existing `Expense` model (`money-split-backend/prisma/schema.prisma:142`) the same way `SplitType` already works — a Prisma enum plus a column:

```prisma
enum ExpenseCategory {
  FOOD
  TRANSPORT
  RENT
  UTILITIES
  ENTERTAINMENT
  SHOPPING
  TRAVEL
  HEALTH
  OTHER
}

model Expense {
  ...
  category  ExpenseCategory @default(OTHER) @map("category")
  ...
}
```

`@default(OTHER)` means the migration backfills every existing row automatically — no data backfill script needed, no breaking change for the mobile app or in-flight branches that don't send `category`.

## Backend Changes

- `CreateExpenseDto` / `UpdateExpenseDto`: add optional `category` (`@IsEnum(ExpenseCategory)`), defaults to `OTHER` if omitted.
- `ExpenseResponse` / `TransactionHistoryItem`: include `category`.
- New endpoint: `GET /groups/:groupId/expenses/by-category?currency=USD&from=&to=` → `{ category, totalCents }[]`. This is a dedicated aggregation query (not computed from the paginated history endpoint, since that only returns one page at a time) — a straightforward Prisma `groupBy` on `category` with `deletedAt: null`.
- **Scoped to one currency per request.** Groups can hold multi-currency expenses; rather than converting currencies (that's the in-flight manual-exchange-rates feature's job), the endpoint takes a `currency` param and only sums expenses in that currency. Frontend defaults to the group's primary currency and can offer a switcher if the group has more than one.

## Frontend Changes

- `expense.types.ts`: add `ExpenseCategory` const + type, mirroring the existing `SplitType` pattern exactly.
- `ExpenseForm.tsx`: add a category picker (icon grid, `lucide-react` icons already installed) to the existing "what" step — optional, defaults to Other, so it doesn't force an extra step on anyone in a hurry.
- `HistoryItem.tsx`: small category icon badge next to each entry, same visual slot pattern as the existing split-type badge.
- New `SpendingByCategoryCard` on the Dashboard: donut or bar chart. **Needs a new dependency** — no chart library is currently installed; adding `recharts` (React-native, Tailwind-friendly, the library the stale REVIEW.md already suggested).

## Coordination Risk

`ExpenseForm.tsx` is the explicit target of the in-flight `worktree-money-split-redesign` branch (Task C: "Redesign Add Expense as 4-step flow"). Adding the category picker there risks a merge conflict. Sequencing: land the backend + types + history badge + dashboard chart first (all independent), and add the category picker to `ExpenseForm` last, coordinating with whoever owns that branch — or just target whichever `ExpenseForm.tsx` shape exists at implementation time.

## Error Handling & Edge Cases

- Legacy expenses: default to `OTHER`, no migration script needed.
- Invalid category from client: rejected at DTO validation (400), same as existing enum fields.
- Empty state: chart shows "No expenses yet this period" rather than a blank chart.
- Multi-currency groups: chart defaults to primary currency; no silent cross-currency summing.

## Testing

- Backend: unit tests for the `by-category` aggregation service (follows the existing `settlement.algo.spec.ts` / `groups.service.spec.ts` pattern) — verify soft-deleted expenses are excluded, verify currency filtering, verify default-to-OTHER behavior.
- Frontend: no existing FE test infra in this repo, so skip adding tests here unless requested.

## Out of Scope (this round)

Budgets/spending limits, recurring-expense detection, custom user-defined categories, cross-currency aggregation — all natural follow-ups, not blockers for v1.
