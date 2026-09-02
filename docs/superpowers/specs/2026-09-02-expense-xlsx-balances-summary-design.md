# Expense .xlsx Balances/Settlement Summary Design

## Context

`ExpensesService.exportExpenses` (`money-split-backend/src/expenses/expenses.service.ts:709-792`) already ships a `GET /groups/:groupId/expenses/export` endpoint (backend commits `6772c04`, `8fc4e91`; design at `docs/superpowers/specs/2026-09-02-expense-xlsx-export-design.md`, plan at `docs/superpowers/plans/2026-09-02-expense-xlsx-export.md`) that streams a single-sheet `.xlsx` workbook: a bold header row (`Date`, `Description`, `Amount`, `Currency`, `Category`, `Payer(s)`, `Split type`, plus one dynamic column per distinct member who ever appeared in the group's expense history) followed by one row per non-deleted expense.

That export tells you *what happened* but not *who owes whom right now*. The same service already computes exactly that, via two existing, already-tested methods used elsewhere in the app (balances/settle-up UI):

- `getBalances(groupId, userId)` (`expenses.service.ts:794-849`) → `Promise<BalancesByCurrency>`, i.e. `{ [currency: string]: BalanceInfo[] }` where `BalanceInfo = { memberId, name, avatarUrl, balance }`. `balance` is `Number(mb.balance)` read directly off the `MemberBalance.balance` Prisma `Decimal` column — **already in major units** (e.g. `42.5`, not `4250`). Positive = the member is owed money; negative = the member owes money. Only currently-active group members are included (the query is `groupMember.findMany({ where: { groupId, deletedAt: null } })`); a member with no balance row yet for a currency that has *any* activity is backfilled at `balance: 0` by the method's own "ensure all members included" pass.
- `getSettlements(groupId, userId)` (`expenses.service.ts:893-976`) → `Promise<RecommendedSettlement[]>`, i.e. `{ from: Participant, to: Participant, amount: number, currency: string }[]`, computed from `getBalances`'s output via a debtor/creditor greedy-matching algorithm. **`amount` is `fromCents(settleAmountCents)` — already in major units**, same convention as `getBalances`. (The original brainstorm flagged uncertainty over whether this field was named `amountCents` and needed a `/100` conversion; it is not — the field is `amount`, already converted, confirmed by reading the method's return statement at `expenses.service.ts:951-964`.)

This design adds a **Balances** and **Settlement plan** summary block to the top of the *same* worksheet the expense list already lives on — not a second sheet (explicitly rejected in favor of a single-sheet summary block during brainstorming) — by calling these two existing methods and rendering their output as extra rows before the expense list. No new endpoint, no frontend change, no new balance/settlement math.

## Goals

- Prepend a summary block to the top of the existing `Expenses` worksheet, above the (unchanged) expense list, containing:
  1. A **Balances** section: one row per `(member, currency)` pair with a non-trivial balance.
  2. A **Settlement plan** section: one row per recommended payment from `getSettlements`.
- Reuse `getBalances`/`getSettlements` as-is for all balance/settlement math — `exportExpenses` only formats their existing output into rows.
- Values in the summary block are in major units, matching the expense list's own `Amount` column convention (both source methods already return major units, so no conversion is needed).
- The change degrades gracefully for a group with no expenses, no balance activity, or no settlements needed — never an error, never a confusing empty table.
- Every place in the current implementation that assumed the expense-list header sits at row 1 is found and updated to the new dynamic offset.

## Non-goals

- Any change to `getBalances`, `getSettlements`, their return types, or the balance/settlement math itself.
- A second worksheet/tab.
- Any endpoint, request/response shape, HTTP header, or frontend change — the route, auth, `Content-Type`/`Content-Disposition`, and the download flow in `GroupDetail.tsx` are all untouched.
- Currency conversion, filtering, or a group-currency default — the summary block shows every currency `getBalances`/`getSettlements` return, exactly like the expense list shows every currency in the group's history.
- Rich formatting beyond bold section titles/headers (no colors, borders, cell merging, number formats, or column-width changes beyond what's already there).
- Freeze panes, print layout, or any other spreadsheet-navigation affordance for the now-longer sheet.

## Current implementation: why row offset matters

`exportExpenses` currently does this (`expenses.service.ts:746-763`):

```typescript
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Expenses');

sheet.columns = [
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Description', key: 'description', width: 28 },
  { header: 'Amount', key: 'amount', width: 12 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Category', key: 'category', width: 14 },
  { header: 'Payer(s)', key: 'payers', width: 24 },
  { header: 'Split type', key: 'splitType', width: 12 },
  ...memberColumns.map((m) => ({
    header: m.name,
    key: `member:${m.memberId}`,
    width: 14,
  })),
];
sheet.getRow(1).font = { bold: true };
```

Two things hard-code "the header is row 1":

1. **`sheet.columns = [...]` with a `header` property on each column definition.** Verified directly against the installed `exceljs` package (`node_modules/exceljs/lib/doc/column.js`, `set header(value)`): setting a column's `header` immediately writes `this._worksheet.getCell(1, this.number).value = text` — i.e. it writes straight into **row 1** the moment `sheet.columns = [...]` runs, before any `addRow` call. This is the only place in the codebase that writes to row 1, and it happens automatically as a side effect of the assignment, not via an explicit `addRow`/`getRow(1)` call — easy to miss.
2. **`sheet.getRow(1).font = { bold: true };`** — hard-codes row 1 as "the header row" to bold.

Both must change: the header row moves to wherever the summary block ends (row `M`, not row 1), and no code path may write to row 1 unconditionally. Nothing else in `exportExpenses` references a hard-coded row number — the data rows use `sheet.addRow(row)`, which always appends at the next free row regardless of how many rows already exist, so they need no offset logic of their own. A grep of the file for `getRow(` and `getCell(1` confirms these are the only two row-1 references in the method.

## New layout

All in the one existing `Expenses` worksheet, top to bottom:

```
Row 1:        "Balances"                                          (bold)
Row 2:        Member | Currency | Net balance                     (bold)
Row 3+:       one row per (member, currency) balance               [only for currencies with ≥1 non-zero balance; see below]
Row (blank)
Row N:        "Settlement plan"                                   (bold)
Row N+1:      From | To | Amount | Currency                       (bold)
Row N+2+:     one row per recommended settlement,
              or a single "Everyone is settled up" row if none
Row (blank)
Row M:        Date | Description | Amount | Currency | Category |
              Payer(s) | Split type | <member columns>            (bold) — EXISTING header, unchanged content
Row M+1+:     EXISTING expense rows, completely unchanged
```

Because the exact row count of the Balances/Settlement blocks depends on the group's data, `M` is **not** a fixed number — it falls out naturally from calling `sheet.addRow(...)` in sequence for every row (title rows, section headers, data rows, blank separators) from the top of the method, in order, before the expense-list rows. No manual row-index bookkeeping is needed anywhere in the implementation: `sheet.addRow(...)` always appends at the next empty row, so as long as every row (summary and expense-list alike) is written via `addRow` calls in top-to-bottom order, `M` is simply "whatever row number the expense header row happens to land on."

### Column reuse, not column redefinition

The Balances/Settlement rows and the expense-list rows share the same physical worksheet columns (column A is column A for every row in the sheet — that's how spreadsheets work), but they don't share semantic meaning: column A holds a member's name in a Balances row and an expense date in an expense row. This is standard practice for multiple stacked tables in one sheet and requires no special handling — each row's cells are populated independently; a row simply leaves unused columns to its right blank.

Concretely: `sheet.columns` still needs to be set once (its `key`s are how expense data rows address specific columns via `row['member:<id>']`, and its `width`s size the whole sheet), but **without the `header` property** — since setting `header` is what writes to row 1 automatically (see above). The expense-list header text moves from being an automatic side effect of `sheet.columns = [...]` to being an explicit `sheet.addRow({...})` call, written wherever the running row cursor is when the expense-list section starts:

```typescript
sheet.columns = [
  { key: 'date', width: 14 },
  { key: 'description', width: 28 },
  { key: 'amount', width: 12 },
  { key: 'currency', width: 10 },
  { key: 'category', width: 14 },
  { key: 'payers', width: 24 },
  { key: 'splitType', width: 12 },
  ...memberColumns.map((m) => ({ key: `member:${m.memberId}`, width: 14 })),
];
```

The Balances/Settlement rows are written as plain positional arrays (`sheet.addRow(['Alice', 'USD', 50])`), which fill columns A, B, C... regardless of the `key`s defined above — `addRow` supports both keyed-object rows and positional-array rows on the same sheet. A title row like `sheet.addRow(['Balances'])` only populates column A; columns B onward for that row are simply left blank by exceljs, exactly like any row that doesn't supply a value for every defined column.

Column widths are **not** redesigned for the Balances/Settlement content (e.g. column A is 14 chars wide, sized for `Date`, which may truncate a long member name in a Balances row). This is an accepted, deliberate cosmetic tradeoff — the design goal is a correct, single-sheet summary using bold-only styling, not a full column-width redesign; Excel/Sheets/Numbers all let a viewer widen a column with two clicks, and this repo's own analytics feature made an equivalent "accepted cosmetic limitation" tradeoff for column-header name collisions (`2026-08-26-dashboard-analytics-expansion-design.md`).

## Balances section

```typescript
sheet.addRow(['Balances']).font = { bold: true };
sheet.addRow(['Member', 'Currency', 'Net balance']).font = { bold: true };
for (const [currency, balances] of Object.entries(balancesByCurrency)) {
  const hasNonZeroBalance = balances.some((b) => toCents(b.balance) !== 0);
  if (!hasNonZeroBalance) continue;
  for (const b of balances) {
    sheet.addRow([b.name, currency, b.balance]);
  }
}
sheet.addRow([]);
```

Decisions, made explicit:

- **A currency is omitted entirely from the Balances section when every member's balance in that currency is exactly zero** (fully settled in that currency — nothing to report). `toCents(...)` (existing helper, already imported in this file) is used for the zero-check rather than a raw `=== 0` on the float, for the same precision-safety reason `getSettlements` already checks `cents < 0`/`cents > 0` instead of comparing the raw `Decimal`-derived float.
- **If a currency has *any* non-zero balance, every member is shown for that currency, including a member sitting at exactly 0** — matching `getBalances`'s own existing behavior of including every active member per currency (it already backfills missing members at `balance: 0`), so "show all members" here requires no extra branching: it's just "don't filter the `balances` array" once the currency itself passes the non-zero check.
- **Row order**: currencies in `Object.entries(balancesByCurrency)` insertion order (the order `getBalances` builds them in, itself driven by `memberBalance.findMany`'s result order — not alphabetized; this matches the existing, already-shipped `getBalances`/`getSettlements` methods' own lack of currency sorting, so this pass doesn't introduce a new ordering guarantee that doesn't already exist elsewhere in the API). Within a currency, member row order is `balances`'s existing array order (also not re-sorted).
- **A group with zero balance activity at all** (`balancesByCurrency` is `{}` — a brand-new group, or one where `memberBalance.findMany` returns no rows): the `for...of Object.entries(...)` loop runs zero times, so the section is just the two bold title/header rows followed immediately by the blank separator. This requires no special-case branch — it's the natural result of an empty object.
- **Net balance value**: `b.balance` written as-is (already major units, already a `number` — no `fromCents`/`toCents` round-trip needed for display, only used internally for the zero-check).

## Settlement plan section

```typescript
sheet.addRow(['Settlement plan']).font = { bold: true };
sheet.addRow(['From', 'To', 'Amount', 'Currency']).font = { bold: true };
if (settlements.length === 0) {
  sheet.addRow(['Everyone is settled up']);
} else {
  for (const s of settlements) {
    sheet.addRow([s.from.name, s.to.name, s.amount, s.currency]);
  }
}
sheet.addRow([]);
```

Decisions, made explicit:

- **`amount` is `s.amount` as-is** — already major units (`fromCents`-converted inside `getSettlements` itself), no further conversion.
- **Zero settlements needed** (every currency is either fully settled or `balancesByCurrency` is empty) → a single row reading `Everyone is settled up` in column A, columns B-D left blank on that row. This satisfies "must not error or leave a confusing blank table" with the simplest option that needs no cell-merging: a reader sees the section title, the column header, and one plain-English row explaining why there's no data — not a title/header pair followed by nothing.
- **Row order**: `settlements` array order, i.e. `getSettlements`'s own existing per-currency, debtor-then-creditor greedy-matching order (`Object.entries(balancesByCurrency)` order for which currency's settlements come first, then within a currency the order the debtor/creditor greedy loop produces them) — unchanged, not re-sorted by this pass.

## Expense list section (unchanged content, new position)

```typescript
const headerRow: Record<string, unknown> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  currency: 'Currency',
  category: 'Category',
  payers: 'Payer(s)',
  splitType: 'Split type',
};
for (const m of memberColumns) headerRow[`member:${m.memberId}`] = m.name;
sheet.addRow(headerRow).font = { bold: true };

for (const e of expenses) {
  // ...unchanged from the current implementation (expenses.service.ts:765-783)...
  sheet.addRow(row);
}
```

The per-expense row-building loop body is **byte-for-byte unchanged** from the current implementation — only its position relative to the new summary-block rows changes (it now runs after the Balances/Settlement rows instead of immediately after `sheet.columns = [...]`), and the header row that used to be an automatic side effect of `sheet.columns = [...]` is now an explicit `addRow` call with the same header text as today, bolded the same way (`.font = { bold: true }` on the returned `Row`, same API already used elsewhere in this method — not a new pattern).

## Full method shape (data fetching)

```typescript
async exportExpenses(
  groupId: string,
  userId: string,
): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }> {
  await this.assertActiveMember(groupId, userId);

  const group = await this.prisma.group.findUnique({ where: { id: groupId } });
  const { filename, filenameUtf8 } = buildExportFilename(group?.name ?? 'Group');

  const expenses = await this.prisma.expense.findMany({ /* unchanged */ });

  const balancesByCurrency = await this.getBalances(groupId, userId);
  const settlements = await this.getSettlements(groupId, userId);

  // ...memberColumns computation unchanged...
  // ...workbook/sheet setup, Balances section, Settlement plan section,
  //    expense-list header + rows, as above...

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, filename, filenameUtf8 };
}
```

`getBalances` and `getSettlements` are called with the same `(groupId, userId)` the caller already passed to `exportExpenses`, sequentially (not `Promise.all`'d), matching this method's existing sequential-await style and keeping the mocked-Prisma test setup simple to reason about (call order stays deterministic).

**Accepted redundancy, called out explicitly:** `getSettlements` internally calls `getBalances` again (`expenses.service.ts:897`), and both `getBalances` calls (the direct one and `getSettlements`'s internal one) each re-run `assertActiveMember` and the `groupMember.findMany`/`memberBalance.findMany` queries. So `exportExpenses` ends up calling `assertActiveMember` three times total (once directly, once inside each `getBalances` invocation) and fetching the group's members/balances twice. This is a deliberate simplicity-over-micro-optimization tradeoff, explicitly directed by this design: reuse the existing, already-tested methods unmodified rather than reimplementing or refactoring them to share one fetch. A group's member/balance-row count is small (bounded by group size, not expense count), so the extra queries are cheap; this endpoint is not a hot path (an on-demand export, not a page-load call). No caching or refactor of `getBalances`/`getSettlements` is in scope for this change.

## Testing

Following `expenses.service.spec.ts`'s existing `describe('exportExpenses', ...)` conventions (mocked `PrismaService`, real `exceljs` round-trip via `new ExcelJS.Workbook().xlsx.load(buffer as unknown as ArrayBuffer)`):

- **`beforeEach` update**: the block's existing `beforeEach` (mocking `groupMember.findUnique` and `group.findUnique`) gains two more default mocks so `getBalances`/`getSettlements` don't crash on unmocked calls: `mockPrisma.groupMember.findMany.mockResolvedValue([])` and `mockPrisma.memberBalance.findMany.mockResolvedValue([])`. With these defaults, `balancesByCurrency` is `{}` and `settlements` is `[]` for every test that doesn't override them — which fixes the summary block at exactly 7 rows (Balances title, Balances header, blank, Settlement plan title, Settlement header, "Everyone is settled up", blank) before the expense-list header. This makes every existing test's row-number assertions shift by a **constant, predictable +7** without needing to reason about balance data in tests that aren't about balances.
- **Existing 4 tests, updated for the new offset** (content assertions unchanged, only row numbers move):
  - Zero-expense group: `rowCount` `1` → `8` (7-row preamble + 1 header row, 0 data rows); `columnCount` stays `7`; header-cell assertions move from `getRow(1)` to `getRow(8)`.
  - One expense, two payers: `rowCount` `2` → `9`; `columnCount` stays `9`; data-row assertions move from `getRow(2)` to `getRow(9)`.
  - Removed-member column / blank-vs-zero cell: `rowCount` `3` → `10`; header-cell assertions move from `getRow(1)` to `getRow(8)` (column letters unchanged — Amy stays column 8, Zack column 9); the two data rows move from `getRow(2)`/`getRow(3)` to `getRow(9)`/`getRow(10)`.
  - "Queries all non-deleted expenses..." test: no row-number assertions to update (it only checks the `expense.findMany` call args), but needs the new `beforeEach` defaults in place to avoid crashing.
- **New tests for the Balances section**:
  - A currency where every member has a non-zero balance shows one row per member, values in major units, positioned directly after the `Member | Currency | Net balance` header row (row 3+).
  - A currency where every member's balance is exactly 0 is omitted from the Balances section entirely (no rows for that currency; the next thing after the header row is the blank separator, if it's the only currency).
  - A currency with a mix of zero and non-zero balances shows **every** member for that currency, including the one at exactly 0.
  - A group with zero balance activity (`memberBalance.findMany` returns `[]`) produces just the title + header + blank separator, no data rows — verifies the empty-object case needs no special-case branch.
- **New tests for the Settlement plan section**:
  - `getSettlements` returning one or more settlements produces one row per settlement (`From`, `To`, `Amount`, `Currency`), values in major units, directly reflecting `RecommendedSettlement`'s field names/shapes (not `amountCents`).
  - `getSettlements` returning `[]` produces a single `Everyone is settled up` row instead of no rows.
- **Full-sheet ordering test**: one test with non-trivial balances, settlements, *and* expenses together, asserting the Balances section appears first, then Settlement plan, then the (unchanged) expense list — i.e. the sections are in the right relative order end-to-end, not just individually correct in isolation.
- Run `npx tsc --noEmit` and the full `npx jest --silent` suite (existing convention for every backend task in this repo's plans).

No frontend changes, so no frontend testing is in scope — the download mechanism, `Content-Type`/`Content-Disposition`, and `GroupDetail.tsx`'s handler are all unaffected; the frontend simply downloads whatever bytes the (now-larger) worksheet produces.
