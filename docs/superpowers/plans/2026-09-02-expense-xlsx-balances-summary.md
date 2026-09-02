# Expense .xlsx Balances/Settlement Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepend a "Balances" section and a "Settlement plan" section to the top of the already-shipped `GET /groups/:groupId/expenses/export` endpoint's worksheet, above the existing (unchanged) expense list, by reusing the existing `getBalances`/`getSettlements` methods — no new endpoint, no new balance/settlement math, no frontend change.

**Architecture:** A single change to `ExpensesService.exportExpenses` (`money-split-backend/src/expenses/expenses.service.ts`): call the existing `getBalances`/`getSettlements` methods, remove the `header` property from the worksheet's column definitions (so `sheet.columns = [...]` no longer auto-writes header text into row 1), write the Balances and Settlement plan rows via `sheet.addRow(...)`, then write the expense-list header as its own explicit `addRow` call (instead of the automatic side effect it used to be), followed by the unchanged per-expense row-building loop. Because every row — summary and expense-list alike — is written via sequential `addRow` calls, the expense list's start row falls out naturally with no manual row-index bookkeeping.

**Tech Stack:** NestJS 11, Prisma 7 (existing `PrismaService`, no schema changes), `exceljs` (already a dependency), Jest (TDD, mocked `PrismaService` + real `exceljs` round-trip reads, same conventions as the existing `describe('exportExpenses', ...)` block).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-02-expense-xlsx-balances-summary-design.md`. Read it for full rationale; this plan implements it exactly.
- Backend-only change, one file (`money-split-backend/src/expenses/expenses.service.ts`) plus its test file (`money-split-backend/src/expenses/expenses.service.spec.ts`). No controller, DTO, frontend, or schema change of any kind.
- `getBalances(groupId, userId)` and `getSettlements(groupId, userId)` are used exactly as they exist today, unmodified — no refactor, no shared-fetch optimization. `getBalances` returns `BalancesByCurrency` (`{ [currency: string]: BalanceInfo[] }`, `BalanceInfo = { memberId, name, avatarUrl, balance }`) with `balance` already in **major units**. `getSettlements` returns `RecommendedSettlement[]` (`{ from: Participant, to: Participant, amount: number, currency: string }`) with `amount` already in **major units** (`fromCents`-converted internally). Neither needs a `/100` conversion when writing to spreadsheet cells.
- New worksheet layout, top to bottom, all in the existing `Expenses` sheet: `"Balances"` title (bold) → `Member | Currency | Net balance` header (bold) → one row per `(member, currency)` pair, only for currencies where at least one member has a non-zero balance (a currency where every member is at exactly 0 is omitted entirely; a currency that clears the non-zero bar shows **every** member for that currency, including any member at exactly 0) → one blank row → `"Settlement plan"` title (bold) → `From | To | Amount | Currency` header (bold) → one row per recommended settlement, or a single `"Everyone is settled up"` row if `getSettlements` returns `[]` → one blank row → the existing expense-list header (bold, unchanged column set) → the existing expense-list data rows (byte-for-byte unchanged row-building logic).
- Zero-balance check uses `toCents(b.balance) !== 0` (the existing `toCents` helper, already imported in this file), not a raw `=== 0` comparison, for the same float-precision-safety reason `getSettlements` already uses `cents < 0`/`cents > 0` internally.
- `sheet.columns` column definitions keep their `key`/`width` but drop `header` — setting `header` makes exceljs write header text straight into row 1 the instant `sheet.columns = [...]` runs (confirmed against `node_modules/exceljs/lib/doc/column.js`'s `set header`), which would collide with the new summary block. The expense-list header becomes an explicit `sheet.addRow({...}).font = { bold: true }` call instead.
- No column-width redesign, no cell merging, no number formats, no freeze panes — bold section titles/headers only, matching the existing header row's own styling (`.font = { bold: true }`).
- Testing: Jest, TDD (RED then GREEN), mocked `PrismaService`, real `exceljs` for round-trip buffer-content assertions (`new ExcelJS.Workbook().xlsx.load(buffer as unknown as ArrayBuffer)`, matching the exact cast already used in this test file). No live DB.
- Every existing `exportExpenses` test's row-number assertions shift by a constant **+7** once the test's `describe`-level `beforeEach` mocks `groupMember.findMany`/`memberBalance.findMany` to resolve `[]` by default (making `balancesByCurrency` `{}` and `settlements` `[]`, which fixes the summary-block preamble at exactly 7 rows: title, header, blank, title, header, "Everyone is settled up", blank).

---

## File Structure

**Backend (`money-split-backend/`):**
- Modify: `src/expenses/expenses.service.ts` (rewrite `exportExpenses`, lines 709-792 as of this session) — Task 1
- Modify: `src/expenses/expenses.service.spec.ts` (rewrite the `describe('exportExpenses', ...)` block, lines 713-899 as of this session) — Task 1

**Root repo (`money-split/`):**
- Modify: `money-split-backend` submodule pointer — Task 2 (review/verification, runs after Task 1 is committed)

---

### Task 1: Balances/Settlement summary block in `exportExpenses`

**Files:**
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.spec.ts`

**Interfaces:**
- Consumes: `ExpensesService.getBalances(groupId: string, userId: string): Promise<BalancesByCurrency>` (existing, `expenses.service.ts:794-849`); `ExpensesService.getSettlements(groupId: string, userId: string): Promise<RecommendedSettlement[]>` (existing, `expenses.service.ts:893-976`); `toCents(amount: number): number` (existing, already imported from `../helpers/number.helper`).
- Produces: `ExpensesService.exportExpenses(groupId: string, userId: string): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }>` — same signature and return shape as today; only the worksheet's row content/order changes. No caller of this method (the controller) needs any change.

- [ ] **Step 1: Write the failing tests**

In `money-split-backend/src/expenses/expenses.service.spec.ts`, replace the entire `describe('exportExpenses', ...)` block (currently lines 713-899, immediately before `describe('updateExpense (category preserve-on-omit)', ...)`) with:

```typescript
  describe('exportExpenses', () => {
    const groupId = 'group-1';
    const userId = 'user-1';

    beforeEach(() => {
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        id: 'member-1',
        groupId,
        userId,
        deletedAt: null,
      });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: groupId,
        name: 'Trip to Japan',
        currency: 'USD',
      });
      // Default: no balance activity at all, so getBalances/getSettlements
      // (both called internally by exportExpenses) resolve to an empty
      // BalancesByCurrency ({}) and an empty settlements list ([]). This
      // fixes the Balances/Settlement summary block at exactly 7 rows
      // (title, header, blank, title, header, "Everyone is settled up",
      // blank) for every test below that doesn't override these mocks, so
      // the expense-list header always lands on row 8 in those tests.
      mockPrisma.groupMember.findMany.mockResolvedValue([]);
      mockPrisma.memberBalance.findMany.mockResolvedValue([]);
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(service.exportExpenses(groupId, userId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.expense.findMany).not.toHaveBeenCalled();
    });

    it('queries all non-deleted expenses for the group ordered by date ascending, with payers and splits included', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      await service.exportExpenses(groupId, userId);

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith({
        where: { groupId, deletedAt: null },
        include: {
          payers: { include: { member: true } },
          splits: { include: { member: true } },
        },
        orderBy: { date: 'asc' },
      });
    });

    it('produces a workbook with only the 7 fixed columns and a header row at row 8 for a zero-expense, zero-balance-activity group', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      const { buffer, filename, filenameUtf8 } = await service.exportExpenses(
        groupId,
        userId,
      );

      expect(filename).toBe('Trip to Japan-expenses.xlsx');
      expect(filenameUtf8).toBe('Trip to Japan-expenses.xlsx');

      const workbook = new ExcelJS.Workbook();
      // See the matching comment in expenses.service.ts: exceljs's bundled
      // types declare their own local Buffer interface that doesn't
      // structurally match Node's real Buffer, even though the runtime value
      // is a genuine Node Buffer.
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.rowCount).toBe(8);
      expect(sheet.columnCount).toBe(7);
      expect(sheet.getRow(1).getCell(1).value).toBe('Balances');
      expect(sheet.getRow(4).getCell(1).value).toBe('Settlement plan');
      expect(sheet.getRow(6).getCell(1).value).toBe('Everyone is settled up');
      expect(sheet.getRow(8).getCell(1).value).toBe('Date');
      expect(sheet.getRow(8).getCell(7).value).toBe('Split type');
    });

    it('produces one data row per expense at row 9+ with comma-joined payer names and the raw category/splitType enum values', async () => {
      const date = new Date('2026-01-15T00:00:00.000Z');
      mockPrisma.expense.findMany.mockResolvedValueOnce([
        {
          id: 'expense-1',
          description: 'Hotel',
          amount: 300,
          currency: 'USD',
          category: 'TRAVEL',
          splitType: 'EVEN',
          date,
          payers: [
            { memberId: 'member-a', member: { id: 'member-a', name: 'Alice' } },
            { memberId: 'member-b', member: { id: 'member-b', name: 'Bob' } },
          ],
          splits: [
            {
              memberId: 'member-a',
              amount: 150,
              member: { id: 'member-a', name: 'Alice' },
            },
            {
              memberId: 'member-b',
              amount: 150,
              member: { id: 'member-b', name: 'Bob' },
            },
          ],
        },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.rowCount).toBe(9);
      expect(sheet.columnCount).toBe(9); // 7 fixed + Alice + Bob
      expect(sheet.getRow(8).getCell(1).value).toBe('Date');
      const row = sheet.getRow(9);
      expect(row.getCell(1).value).toBe('2026-01-15');
      expect(row.getCell(2).value).toBe('Hotel');
      expect(row.getCell(3).value).toBe(300);
      expect(row.getCell(4).value).toBe('USD');
      expect(row.getCell(5).value).toBe('TRAVEL');
      expect(row.getCell(6).value).toBe('Alice, Bob');
      expect(row.getCell(7).value).toBe('EVEN');
    });

    it('includes a column for a member removed from the group, and leaves a blank (not 0) cell for a member who did not participate in a given expense', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([
        {
          id: 'expense-1',
          description: 'Groceries',
          amount: 40,
          currency: 'USD',
          category: 'FOOD',
          splitType: 'EVEN',
          date: new Date('2026-01-10'),
          payers: [
            {
              memberId: 'member-removed',
              member: { id: 'member-removed', name: 'Zack' },
            },
          ],
          splits: [
            {
              memberId: 'member-removed',
              amount: 40,
              member: { id: 'member-removed', name: 'Zack' },
            },
          ],
        },
        {
          id: 'expense-2',
          description: 'Taxi',
          amount: 20,
          currency: 'USD',
          category: 'TRANSPORT',
          splitType: 'EVEN',
          date: new Date('2026-01-11'),
          payers: [
            {
              memberId: 'member-active',
              member: { id: 'member-active', name: 'Amy' },
            },
          ],
          splits: [
            {
              memberId: 'member-active',
              amount: 20,
              member: { id: 'member-active', name: 'Amy' },
            },
          ],
        },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.rowCount).toBe(10);
      // Member columns sorted alphabetically: Amy (col 8), Zack (col 9)
      expect(sheet.getRow(8).getCell(8).value).toBe('Amy');
      expect(sheet.getRow(8).getCell(9).value).toBe('Zack');
      // Row for expense-1 (Zack's groceries): Amy's cell is blank, Zack's cell is 40
      const row1 = sheet.getRow(9);
      expect(row1.getCell(8).value).toBeNull();
      expect(row1.getCell(9).value).toBe(40);
      // Row for expense-2 (Amy's taxi): Amy's cell is 20, Zack's cell is blank
      const row2 = sheet.getRow(10);
      expect(row2.getCell(8).value).toBe(20);
      expect(row2.getCell(9).value).toBeNull();
    });

    it('shows one Balances row per member for a currency with a non-zero balance (including a member at exactly 0), and omits a currency where every member is exactly 0', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);
      mockPrisma.groupMember.findMany.mockResolvedValue([
        { id: 'member-a', name: 'Alice', avatarUrl: null, deletedAt: null },
        { id: 'member-b', name: 'Bob', avatarUrl: null, deletedAt: null },
        { id: 'member-c', name: 'Carol', avatarUrl: null, deletedAt: null },
      ]);
      mockPrisma.memberBalance.findMany.mockResolvedValue([
        { memberId: 'member-a', currency: 'USD', balance: 30 },
        { memberId: 'member-b', currency: 'USD', balance: -30 },
        { memberId: 'member-c', currency: 'USD', balance: 0 },
        { memberId: 'member-a', currency: 'EUR', balance: 0 },
        { memberId: 'member-b', currency: 'EUR', balance: 0 },
        { memberId: 'member-c', currency: 'EUR', balance: 0 },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.getRow(1).getCell(1).value).toBe('Balances');
      expect(sheet.getRow(2).getCell(1).value).toBe('Member');
      expect(sheet.getRow(2).getCell(2).value).toBe('Currency');
      expect(sheet.getRow(2).getCell(3).value).toBe('Net balance');
      // USD has a non-zero balance, so all 3 members show, Carol included at 0.
      expect(sheet.getRow(3).getCell(1).value).toBe('Alice');
      expect(sheet.getRow(3).getCell(2).value).toBe('USD');
      expect(sheet.getRow(3).getCell(3).value).toBe(30);
      expect(sheet.getRow(4).getCell(1).value).toBe('Bob');
      expect(sheet.getRow(4).getCell(3).value).toBe(-30);
      expect(sheet.getRow(5).getCell(1).value).toBe('Carol');
      expect(sheet.getRow(5).getCell(3).value).toBe(0);
      // EUR is entirely zero, so it's omitted — row 6 is the blank separator,
      // row 7 is "Settlement plan", not another currency's data.
      expect(sheet.getRow(6).getCell(1).value).toBeNull();
      expect(sheet.getRow(7).getCell(1).value).toBe('Settlement plan');
      // The expense-list header (row 11) still lands correctly after the
      // longer, real-data summary block.
      expect(sheet.getRow(11).getCell(1).value).toBe('Date');
      expect(sheet.rowCount).toBe(11);
    });

    it('shows one Settlement plan row per recommended payment, in major units', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);
      mockPrisma.groupMember.findMany.mockResolvedValue([
        { id: 'member-a', name: 'Alice', avatarUrl: null, deletedAt: null },
        { id: 'member-b', name: 'Bob', avatarUrl: null, deletedAt: null },
      ]);
      mockPrisma.memberBalance.findMany.mockResolvedValue([
        { memberId: 'member-a', currency: 'USD', balance: 50 },
        { memberId: 'member-b', currency: 'USD', balance: -50 },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.getRow(6).getCell(1).value).toBe('Settlement plan');
      expect(sheet.getRow(7).getCell(1).value).toBe('From');
      expect(sheet.getRow(7).getCell(2).value).toBe('To');
      expect(sheet.getRow(7).getCell(3).value).toBe('Amount');
      expect(sheet.getRow(7).getCell(4).value).toBe('Currency');
      const row = sheet.getRow(8);
      expect(row.getCell(1).value).toBe('Bob'); // debtor pays...
      expect(row.getCell(2).value).toBe('Alice'); // ...the creditor
      expect(row.getCell(3).value).toBe(50); // major units, not 5000 cents
      expect(row.getCell(4).value).toBe('USD');
      expect(sheet.getRow(10).getCell(1).value).toBe('Date');
      expect(sheet.rowCount).toBe(10);
    });

    it('shows "Everyone is settled up" when getSettlements returns no recommended payments, even with non-empty but fully-zero balance data', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);
      mockPrisma.groupMember.findMany.mockResolvedValue([
        { id: 'member-a', name: 'Alice', avatarUrl: null, deletedAt: null },
        { id: 'member-b', name: 'Bob', avatarUrl: null, deletedAt: null },
      ]);
      mockPrisma.memberBalance.findMany.mockResolvedValue([
        { memberId: 'member-a', currency: 'USD', balance: 0 },
        { memberId: 'member-b', currency: 'USD', balance: 0 },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      // The USD currency is present but fully zero, so it's omitted from
      // Balances (row 3 is the blank separator, not a data row).
      expect(sheet.getRow(3).getCell(1).value).toBeNull();
      expect(sheet.getRow(4).getCell(1).value).toBe('Settlement plan');
      const row = sheet.getRow(6);
      expect(row.getCell(1).value).toBe('Everyone is settled up');
      expect(row.getCell(2).value).toBeNull();
      expect(sheet.getRow(8).getCell(1).value).toBe('Date');
      expect(sheet.rowCount).toBe(8);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `FAIL` — the row-offset assertions (`rowCount` 8/9/10/11, `getRow(1).getCell(1).value` `'Balances'`, etc.) don't match the current implementation, which still writes the expense-list header at row 1 with no summary block above it.

- [ ] **Step 3: Implement the Balances/Settlement summary block**

In `money-split-backend/src/expenses/expenses.service.ts`, replace the entire `exportExpenses` method (currently lines 709-792, immediately before `getBalances` begins) with:

```typescript
  async exportExpenses(
    groupId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }> {
    await this.assertActiveMember(groupId, userId);

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
    });
    const { filename, filenameUtf8 } = buildExportFilename(
      group?.name ?? 'Group',
    );

    const expenses = await this.prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      include: {
        payers: { include: { member: true } },
        splits: { include: { member: true } },
      },
      orderBy: { date: 'asc' },
    });

    // Reuses the existing, already-tested getBalances/getSettlements methods
    // for all balance/settlement math — this method only formats their
    // output into rows. getSettlements calls getBalances again internally,
    // so this does re-run assertActiveMember and re-fetch the group's
    // members/balances a couple of extra times; accepted as a deliberate
    // simplicity-over-micro-optimization tradeoff (bounded by group size,
    // not expense count, and this endpoint isn't a hot path).
    const balancesByCurrency = await this.getBalances(groupId, userId);
    const settlements = await this.getSettlements(groupId, userId);

    // Distinct members who ever appeared as a payer or split participant across
    // this group's *entire* expense history — deliberately not filtered to
    // active members. Mirrors getTopExpenses' payerNames convention: each row
    // is a real historical record, so a member later removed from the group
    // should not have their historical amounts silently dropped or blanked.
    // Sorted by name for a stable, human-readable column order.
    const memberNameById = new Map<string, string>();
    for (const e of expenses) {
      for (const p of e.payers) memberNameById.set(p.memberId, p.member.name);
      for (const s of e.splits) memberNameById.set(s.memberId, s.member.name);
    }
    const memberColumns = Array.from(memberNameById.entries())
      .map(([memberId, name]) => ({ memberId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Expenses');

    // Column keys/widths only — no `header` property. Setting a column's
    // `header` makes exceljs write header text straight into row 1 the
    // moment `sheet.columns = [...]` runs (verified against
    // node_modules/exceljs/lib/doc/column.js's `set header`), which would
    // collide with the Balances/Settlement plan summary block written below.
    // The expense-list header is instead written explicitly, further down,
    // as its own addRow call once the summary block is done.
    sheet.columns = [
      { key: 'date', width: 14 },
      { key: 'description', width: 28 },
      { key: 'amount', width: 12 },
      { key: 'currency', width: 10 },
      { key: 'category', width: 14 },
      { key: 'payers', width: 24 },
      { key: 'splitType', width: 12 },
      ...memberColumns.map((m) => ({
        key: `member:${m.memberId}`,
        width: 14,
      })),
    ];

    // --- Balances section ---
    sheet.addRow(['Balances']).font = { bold: true };
    sheet.addRow(['Member', 'Currency', 'Net balance']).font = { bold: true };
    for (const [currency, balances] of Object.entries(balancesByCurrency)) {
      // Omit a currency entirely when every member's balance in it is
      // exactly zero (fully settled — nothing to report). toCents() avoids
      // float-precision false positives, the same reasoning getSettlements
      // already relies on for its own debtor/creditor split.
      const hasNonZeroBalance = balances.some(
        (b) => toCents(b.balance) !== 0,
      );
      if (!hasNonZeroBalance) continue;
      // Otherwise show every member for this currency, including anyone
      // sitting at exactly 0 — matches getBalances' own convention of
      // backfilling every active member per currency.
      for (const b of balances) {
        sheet.addRow([b.name, currency, b.balance]);
      }
    }
    sheet.addRow([]);

    // --- Settlement plan section ---
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

    // --- Expense list section (unchanged content, now below the summary block) ---
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
      const row: Record<string, unknown> = {
        date: e.date.toISOString().slice(0, 10),
        description: e.description,
        amount: Number(e.amount),
        currency: e.currency,
        category: e.category,
        payers: e.payers.map((p) => p.member.name).join(', '),
        splitType: e.splitType,
      };
      // A member's column key is only set when they participated in this
      // expense, so exceljs leaves the cell blank/undefined for everyone
      // else — never 0. A blank cell is visually distinct from "participated
      // with a zero-amount share," which a 0 would misrepresent.
      for (const split of e.splits) {
        row[`member:${split.memberId}`] = Number(split.amount);
      }
      sheet.addRow(row);
    }

    // exceljs's bundled index.d.ts declares its own local `Buffer` interface
    // (`extends ArrayBuffer`) that shadows Node's real Buffer type within its
    // own type declarations, even though writeBuffer() genuinely returns a
    // real Node Buffer instance at runtime (verified directly against the
    // installed exceljs version). Bridge the type-only mismatch here.
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename, filenameUtf8 };
  }
```

No import changes are needed: `toCents` is already imported at the top of the file (`import { fromCents, toCents } from '../helpers/number.helper';`), and `ExcelJS`/`buildExportFilename` are already imported from the original feature.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `PASS`, all tests including the 7 `exportExpenses` tests (4 updated for the new row offset, 3 new for the Balances/Settlement content).

- [ ] **Step 5: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd money-split-backend
git add src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts
git commit -m "feat: prepend balances/settlement summary to expense xlsx export"
```

---

### Task 2: Review and verification (run after Task 1 is complete)

**Files:** none modified except the root repo's submodule pointer (Step 4).

**Interfaces:** None produced — this task only verifies Task 1's output and syncs the root repo's submodule pointer.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: `PASS`. No pre-existing test regresses; the `exportExpenses` block shows 7 passing tests (3 pre-existing behaviors — membership check, query args, per-expense row content/removed-member handling, spread across the 4 non-Balances/Settlement tests — plus the 3 new Balances/Settlement tests).

- [ ] **Step 2: Typecheck the backend**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Lint the backend**

```bash
cd money-split-backend && npx eslint src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts
```

Expected: no errors.

- [ ] **Step 4: Sync the root repo's submodule pointer**

```bash
cd /Users/ducnguyen/code/money-split
git -C money-split-backend log --oneline -3
git add money-split-backend
git commit -m "chore: update submodule pointer to latest commit"
git status
```

Expected: the backend log shows, at the top, the `feat: prepend balances/settlement summary to expense xlsx export` commit from Task 1; the root-repo commit succeeds; `git status` afterward shows a clean working tree with respect to the submodule pointer (other unrelated pre-existing local changes, if any, are untouched).

---
