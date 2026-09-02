# Expense .xlsx Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /groups/:groupId/expenses/export` endpoint that streams a group's full expense history as a binary `.xlsx` file, and an "Export" button on `GroupDetail.tsx`'s Overview header that downloads it via an authenticated Blob fetch.

**Architecture:** Backend: a new `ExpensesService.exportExpenses` method builds an `exceljs` workbook (one row per expense, fixed columns plus one dynamic column per distinct member who ever appeared in the group's history) and a new `ExpensesController.exportExpenses` handler streams it with `@Res()` instead of Nest's default JSON serialization. A small pure helper, `buildExportFilename`, produces an ASCII-safe and a UTF-8 filename variant. Frontend: a new `api.getBlob` request helper (sibling to the existing JSON-only `request<T>`), a `exportGroupExpenses` thunk with no reducer cases (the result is a one-off download, never rendered or cached), and a button/handler/local state block in `GroupDetail.tsx` following that file's existing `handleLeaveGroup`/`handleDeleteGroup` try/catch/finally pattern.

**Tech Stack:** Backend: NestJS 11, Prisma 7 (existing `PrismaService`, no schema changes), `exceljs` (new dependency), Jest (TDD, mocked `PrismaService` + real `exceljs` round-trip reads). Frontend: React 19, Redux Toolkit, native `fetch`/`Blob`/`URL.createObjectURL`, no new dependency.

## Global Constraints

- Repo paths are `money-split-backend/` and `money-split-app/` as git submodules under the `money-split/` root — each submodule is its own git repo; commits happen inside each submodule, then the root repo's submodule pointers are updated and committed separately as the final task (Task 5), matching this repo's existing `chore: update submodule pointers to latest commits` commits.
- **Endpoint contract** (binding for both backend and frontend tasks — see Task 2's and Task 3's Interfaces blocks for the full text): `GET /groups/:groupId/expenses/export`, no query params, same `JwtAuthGuard` + `assertActiveMember` auth as every other route on `ExpensesController`. Success is `200` with raw `.xlsx` bytes (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`), never JSON. Failure is Nest's standard JSON error body (403 for non-members).
- No currency, date-range, or member filtering anywhere in this feature — the export always includes the group's complete, unfiltered expense history, one row per expense (not per split-line).
- Dynamic per-member columns cover every distinct member who ever appeared as a payer or split participant in the group's entire history, **including members later removed from the group** (mirrors `getTopExpenses`' `payerNames` convention — a historical record shouldn't drop a name because that member later left). A member's cell for a given expense row is **blank** when they didn't participate in that expense — never `0`.
- `Amount` and the per-member share columns are in **major units** (e.g. `42.5`), matching `TopExpenseItem.amount`'s convention — not `totalCents`, since this is a list of individual records, not an aggregate. `Date` is a plain `YYYY-MM-DD` string, not a native Excel date cell. `Category` and `Split type` are the raw Prisma enum strings (`"FOOD"`, `"EVEN"`), not the frontend's display-label mapping.
- A zero-expense group (and a group with zero historical members) still produces a valid, non-error `.xlsx`: just the bold header row and the 7 fixed columns, no member columns, no data rows.
- New backend dependency: `exceljs` (no `@types/exceljs` — the package ships its own bundled `index.d.ts`).
- The frontend export thunk (`exportGroupExpenses`) gets **no `.addCase(pending/fulfilled/rejected)` reducers** — its `Blob` result is read via `.unwrap()` into local component state, never stored in Redux (a `Blob` isn't serializable and nothing else needs to read this result later).
- Backend testing: Jest, TDD (RED then GREEN), mocked `PrismaService` for membership/query assertions, real `exceljs` for round-trip buffer-content assertions (no live DB in unit tests). Frontend: no test runner exists in `money-split-app` (`package.json` scripts are only `dev`/`build`/`lint`/`preview`) — verification is `npx tsc --noEmit`, `npx eslint <changed files>`, and manual/live-preview click-through, consistent with every prior plan in this repo.
- Content voice (`money-split-app/design-system/MASTER.md`): sentence case, no exclamation marks — applies to the "Export"/"Exporting…" button text and the error banner message.

---

## File Structure

**Backend (`money-split-backend/`):**
- Modify: `package.json` (add `exceljs` dependency) — Task 1
- Create: `src/helpers/filename.helper.ts` — Task 1
- Create: `src/helpers/filename.helper.spec.ts` — Task 1
- Modify: `src/expenses/expenses.service.ts` (add `exportExpenses`) — Task 2
- Modify: `src/expenses/expenses.service.spec.ts` (add `describe('exportExpenses', ...)`) — Task 2
- Modify: `src/expenses/expenses.controller.ts` (add `GET expenses/export`) — Task 2

**Frontend (`money-split-app/`):**
- Modify: `src/lib/api.ts` (add `requestBlob`/`api.getBlob`) — Task 3
- Modify: `src/constants/api.constants.ts` (add `EXPENSES_EXPORT`) — Task 3
- Modify: `src/store/slices/groupSlice.ts` (add `exportGroupExpenses` thunk, no reducer cases) — Task 3
- Modify: `src/components/GroupDetail.tsx` (add Export button, handler, local state, error banner) — Task 4

**Root repo (`money-split/`):**
- Modify: `money-split-app` and `money-split-backend` submodule pointers — Task 5 (review/verification, runs after Tasks 1-4 are all complete)

---

### Task 1: Backend — `exceljs` dependency and filename helper

**Files:**
- Modify: `money-split-backend/package.json`
- Create: `money-split-backend/src/helpers/filename.helper.ts`
- Create: `money-split-backend/src/helpers/filename.helper.spec.ts`

**Interfaces:**
- Produces: `buildExportFilename(groupName: string): { filename: string; filenameUtf8: string }` — a pure function with no Prisma/DB dependency. Task 2 imports this exact name and signature from `../helpers/filename.helper`.

- [ ] **Step 1: Install `exceljs`**

```bash
cd money-split-backend && npm install exceljs
```

Expected: `package.json` gains a new `"exceljs": "^4.4.0"` (or current latest) entry under `dependencies`; `package-lock.json` updates. No `@types/exceljs` is installed — the package ships its own bundled type definitions (confirmed: its `index.d.ts` types `workbook.xlsx.writeBuffer()` as `Promise<Buffer>`), and the separate `@types/exceljs@1.3.2` on npm predates and conflicts with the current API.

- [ ] **Step 2: Write the failing tests**

Create `money-split-backend/src/helpers/filename.helper.spec.ts`:

```typescript
import { buildExportFilename } from './filename.helper';

describe('buildExportFilename', () => {
  it('keeps a normal ASCII group name unchanged in both variants', () => {
    expect(buildExportFilename('Trip to Japan')).toEqual({
      filename: 'Trip to Japan-expenses.xlsx',
      filenameUtf8: 'Trip to Japan-expenses.xlsx',
    });
  });

  it('strips filesystem-invalid characters from both variants', () => {
    expect(buildExportFilename('Rent/Bills?')).toEqual({
      filename: 'RentBills-expenses.xlsx',
      filenameUtf8: 'RentBills-expenses.xlsx',
    });
  });

  it('falls back to "group" when the name is entirely invalid characters', () => {
    expect(buildExportFilename('???')).toEqual({
      filename: 'group-expenses.xlsx',
      filenameUtf8: 'group-expenses.xlsx',
    });
  });

  it('falls back to "group" when the name is empty', () => {
    expect(buildExportFilename('')).toEqual({
      filename: 'group-expenses.xlsx',
      filenameUtf8: 'group-expenses.xlsx',
    });
  });

  it('keeps non-ASCII characters in filenameUtf8 but strips them from filename', () => {
    expect(buildExportFilename('Nhóm bạn 💰')).toEqual({
      filename: 'Nhm bn-expenses.xlsx',
      filenameUtf8: 'Nhóm bạn 💰-expenses.xlsx',
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest filename.helper --silent
```

Expected: `FAIL` — `Cannot find module './filename.helper'`.

- [ ] **Step 4: Implement `buildExportFilename`**

Create `money-split-backend/src/helpers/filename.helper.ts`:

```typescript
// eslint-disable-next-line no-control-regex -- deliberately stripping
// filesystem-invalid control characters (0x00-0x1F) from a filename
const FILESYSTEM_INVALID_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function stripInvalidChars(name: string): string {
  return name.replace(FILESYSTEM_INVALID_CHARS, '').trim().replace(/\s+/g, ' ');
}

export function buildExportFilename(
  groupName: string,
): { filename: string; filenameUtf8: string } {
  const stripped = stripInvalidChars(groupName);
  const safe = stripped.length > 0 ? stripped : 'group';

  const asciiOnly = safe.replace(/[^\x20-\x7E]/g, '').trim();
  const asciiSafe = asciiOnly.length > 0 ? asciiOnly : 'group';

  return {
    filename: `${asciiSafe}-expenses.xlsx`,
    filenameUtf8: `${safe}-expenses.xlsx`,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest filename.helper --silent
```

Expected: `PASS`, all 5 tests.

- [ ] **Step 6: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Lint**

```bash
cd money-split-backend && npx eslint src/helpers/filename.helper.ts src/helpers/filename.helper.spec.ts
```

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
cd money-split-backend
git add package.json package-lock.json src/helpers/filename.helper.ts src/helpers/filename.helper.spec.ts
git commit -m "feat: add exceljs dependency and buildExportFilename helper"
```

---

### Task 2: Backend — `exportExpenses` service method and controller endpoint

**Files:**
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`

**Interfaces:**
- Consumes: `buildExportFilename(groupName: string)` from Task 1 (`../helpers/filename.helper`); `assertActiveMember(groupId, userId)` (existing private method, `expenses.service.ts:245-260`).
- Produces: `ExpensesService.exportExpenses(groupId: string, userId: string): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }>`. `GET /groups/:groupId/expenses/export` — **the full endpoint contract, binding for Task 3's frontend implementation**: no query params; `Authorization: Bearer <token>` (existing `JwtAuthGuard`, class-level on `ExpensesController`); 200 response is raw `.xlsx` bytes with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="<ascii-safe-name>-expenses.xlsx"; filename*=UTF-8''<percent-encoded-full-name>-expenses.xlsx`; failure is Nest's standard JSON error body (403 `{ statusCode, message, error }` when the caller isn't an active member of the group).

- [ ] **Step 1: Write the failing tests**

In `money-split-backend/src/expenses/expenses.service.spec.ts`, add `import ExcelJS from 'exceljs';` to the top of the file (after the existing `import { SplitType } from '@prisma/client';` line).

Add this new `describe` block directly after the closing `});` of the `describe('getTopExpenses', ...)` block (after line 657, before `describe('updateExpense (category preserve-on-omit)', ...)`):

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

    it('produces a workbook with only the 7 fixed columns and a header row for a zero-expense group', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      const { buffer, filename, filenameUtf8 } = await service.exportExpenses(
        groupId,
        userId,
      );

      expect(filename).toBe('Trip to Japan-expenses.xlsx');
      expect(filenameUtf8).toBe('Trip to Japan-expenses.xlsx');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.rowCount).toBe(1);
      expect(sheet.columnCount).toBe(7);
      expect(sheet.getRow(1).getCell(1).value).toBe('Date');
      expect(sheet.getRow(1).getCell(7).value).toBe('Split type');
    });

    it('produces one data row per expense with comma-joined payer names and the raw category/splitType enum values', async () => {
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
            { memberId: 'member-a', amount: 150, member: { id: 'member-a', name: 'Alice' } },
            { memberId: 'member-b', amount: 150, member: { id: 'member-b', name: 'Bob' } },
          ],
        },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.rowCount).toBe(2);
      expect(sheet.columnCount).toBe(9); // 7 fixed + Alice + Bob
      const row = sheet.getRow(2);
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
            { memberId: 'member-removed', member: { id: 'member-removed', name: 'Zack' } },
          ],
          splits: [
            { memberId: 'member-removed', amount: 40, member: { id: 'member-removed', name: 'Zack' } },
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
            { memberId: 'member-active', member: { id: 'member-active', name: 'Amy' } },
          ],
          splits: [
            { memberId: 'member-active', amount: 20, member: { id: 'member-active', name: 'Amy' } },
          ],
        },
      ]);

      const { buffer } = await service.exportExpenses(groupId, userId);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      // Member columns sorted alphabetically: Amy (col 8), Zack (col 9)
      expect(sheet.getRow(1).getCell(8).value).toBe('Amy');
      expect(sheet.getRow(1).getCell(9).value).toBe('Zack');
      // Row for expense-1 (Zack's groceries): Amy's cell is blank, Zack's cell is 40
      const row1 = sheet.getRow(2);
      expect(row1.getCell(8).value).toBeNull();
      expect(row1.getCell(9).value).toBe(40);
      // Row for expense-2 (Amy's taxi): Amy's cell is 20, Zack's cell is blank
      const row2 = sheet.getRow(3);
      expect(row2.getCell(8).value).toBe(20);
      expect(row2.getCell(9).value).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `FAIL` — `service.exportExpenses is not a function`.

- [ ] **Step 3: Implement `exportExpenses`**

In `money-split-backend/src/expenses/expenses.service.ts`, add two new imports directly after the existing `import { EventsGateway } from '../events/events.gateway';` line:

```typescript
import ExcelJS from 'exceljs';
import { buildExportFilename } from '../helpers/filename.helper';
```

Add this method directly after `getTopExpenses` (which ends at line 702, immediately before `getBalances` begins):

```typescript
  async exportExpenses(
    groupId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }> {
    await this.assertActiveMember(groupId, userId);

    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    const { filename, filenameUtf8 } = buildExportFilename(group?.name ?? 'Group');

    const expenses = await this.prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      include: {
        payers: { include: { member: true } },
        splits: { include: { member: true } },
      },
      orderBy: { date: 'asc' },
    });

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

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer, filename, filenameUtf8 };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `PASS`, all tests including the 5 new `exportExpenses` tests.

- [ ] **Step 5: Add the controller endpoint**

In `money-split-backend/src/expenses/expenses.controller.ts`, change the express type import from:

```typescript
import type { Request } from 'express';
```

to:

```typescript
import type { Request, Response } from 'express';
```

Add this method to `ExpensesController`, directly after `getTopExpenses` (the last method in the class today, before the class's final closing `}`):

```typescript
  @Get('expenses/export')
  @ApiOperation({ summary: "Export a group's full expense history as an .xlsx file" })
  @ApiResponse({ status: 200, description: 'Returns a binary .xlsx file.' })
  async exportExpenses(
    @Param('groupId') groupId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user!.id;
    const { buffer, filename, filenameUtf8 } =
      await this.expensesService.exportExpenses(groupId, userId);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`,
    });
    res.send(buffer);
  }
```

Add `Res` to the existing `@nestjs/common` import block (currently `Controller, Post, Get, Patch, Delete, Body, Param, Headers, UseGuards, Req, Query`):

```typescript
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  UseGuards,
  Req,
  Res,
  Query,
} from '@nestjs/common';
```

- [ ] **Step 6: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: same pass count as before this task, plus the 5 new `exportExpenses` tests passing. Any pre-existing unrelated failures stay unchanged.

- [ ] **Step 8: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts
```

Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
cd money-split-backend
git add src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts
git commit -m "feat: add GET /groups/:groupId/expenses/export endpoint"
```

---

### Task 3: Frontend — Blob-returning API helper, endpoint constant, and export thunk

**Files:**
- Modify: `money-split-app/src/lib/api.ts`
- Modify: `money-split-app/src/constants/api.constants.ts`
- Modify: `money-split-app/src/store/slices/groupSlice.ts`

**Interfaces:**
- Consumes: `GET /groups/:groupId/expenses/export` — **the full endpoint contract this task builds against (do not look at or wait on the backend implementation; this is the sole source of truth):**
  - Method/path: `GET {API_BASE_URL}/groups/:groupId/expenses/export`.
  - Auth: same `Authorization: Bearer <token>` header every other call in this codebase already sends — `api.ts`'s existing token-attachment logic covers this with no special handling.
  - Request body/query: none.
  - Success: `200`, response body is **raw binary `.xlsx` bytes, never JSON** (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). A `Content-Disposition` header is present on the response but is **not read by the frontend** — the browser's default CORS-exposed-header safelist doesn't include it, and this design derives the download filename client-side instead (see Task 4).
  - Failure: standard Nest JSON error body (`{ statusCode, message, error }`), e.g. `403` if the caller isn't an active member of the group.
- Produces: `api.getBlob(url: string, options?: RequestOptions): Promise<Blob>`; `API_ENDPOINTS.GROUPS.EXPENSES_EXPORT(id: string): string`; `exportGroupExpenses({ groupId: string }): AsyncThunk` returning a `Blob`, with **no `.addCase` reducers** (its result is read via `.unwrap()`, never stored in `GroupState`). Task 4 dispatches this exact thunk name with this exact argument shape.

- [ ] **Step 1: Add the Blob-returning request helper**

In `money-split-app/src/lib/api.ts`, add this function directly after the existing `request<T>` function (before the `export const api = {` block):

```typescript
async function requestBlob(url: string, options: RequestOptions = {}): Promise<Blob> {
    const { params, headers, ...rest } = options;

    let finalUrl = url;
    if (params) {
        const searchParams = new URLSearchParams(params);
        finalUrl += `?${searchParams.toString()}`;
    }

    const token = authUtils.getToken();
    const defaultHeaders: Record<string, string> = {};
    if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(finalUrl, {
        headers: { ...defaultHeaders, ...headers },
        ...rest,
    });

    if (!response.ok) {
        if (response.status === 401) {
            onUnauthorized?.();
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }

    return response.blob();
}
```

`requestBlob` deliberately does not set a `Content-Type: application/json` default header (unlike `request<T>`) — this is always a bodyless `GET`, so there's no JSON request body to describe. The `!response.ok` branch still calls `response.json()` because a failed request (403, 500, etc.) gets Nest's normal JSON error body, not xlsx bytes.

Add `getBlob` to the exported `api` object:

```typescript
export const api = {
    get: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'GET' }),
    post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
        request<T>(url, { ...options, method: 'POST', body: JSON.stringify(body) }),
    patch: <T>(url: string, body?: unknown, options?: RequestOptions) =>
        request<T>(url, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
    getBlob: (url: string, options?: RequestOptions) => requestBlob(url, { ...options, method: 'GET' }),
};
```

- [ ] **Step 2: Add the API endpoint constant**

In `money-split-app/src/constants/api.constants.ts`, add to the `GROUPS` object, directly after the existing `EXPENSES_TOP` entry:

```typescript
        EXPENSES_EXPORT: (id: string) => `${API_BASE_URL}/groups/${id}/expenses/export`,
```

- [ ] **Step 3: Add the export thunk**

In `money-split-app/src/store/slices/groupSlice.ts`, add this directly after the existing `fetchTopExpenses` thunk (no `.addCase` reducers are added for it — its result is consumed via `.unwrap()` in `GroupDetail.tsx`, not through Redux state):

```typescript
export const exportGroupExpenses = createAsyncThunk(
    'groups/exportExpenses',
    async ({ groupId }: { groupId: string }) => {
        return await api.getBlob(API_ENDPOINTS.GROUPS.EXPENSES_EXPORT(groupId));
    }
);
```

- [ ] **Step 4: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Lint**

```bash
cd money-split-app && npx eslint src/lib/api.ts src/constants/api.constants.ts src/store/slices/groupSlice.ts
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
cd money-split-app
git add src/lib/api.ts src/constants/api.constants.ts src/store/slices/groupSlice.ts
git commit -m "feat: add Blob-returning api.getBlob and exportGroupExpenses thunk"
```

---

### Task 4: Frontend — Export button, handler, and local state on `GroupDetail.tsx`

**Files:**
- Modify: `money-split-app/src/components/GroupDetail.tsx`

**Interfaces:**
- Consumes: `exportGroupExpenses({ groupId: string })` and `api`/`API_ENDPOINTS` wiring from Task 3 (same submodule); existing `activeGroupId: string | null`, `groupName: string`, `dispatch` (from `useAppDispatch()`) already destructured/declared in this file (`GroupDetail.tsx:41,43,62`).
- Produces: nothing consumed by another task — this is the last user-facing piece. Task 5 (review) exercises it via manual click-through.

- [ ] **Step 1: Add the `Download` icon import**

Change line 4 of `money-split-app/src/components/GroupDetail.tsx` from:

```typescript
import { LogOut, Trash2 } from 'lucide-react';
```

to:

```typescript
import { LogOut, Trash2, Download } from 'lucide-react';
```

- [ ] **Step 2: Import the export thunk**

Change line 22 from:

```typescript
import { settleAllApi, settleGuestApi, fetchTransactionsNextPage } from '../store/slices/groupSlice';
```

to:

```typescript
import { settleAllApi, settleGuestApi, fetchTransactionsNextPage, exportGroupExpenses } from '../store/slices/groupSlice';
```

- [ ] **Step 3: Add the filename-sanitizing helper**

Add this module-level function directly after the imports, before `export function GroupDetail() {` (currently line 28):

```typescript
function sanitizeFilenamePart(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '').trim() || 'group';
}
```

This is a small, non-exported helper purely for the anchor's `download` attribute — it does not need to match the backend's `buildExportFilename` byte-for-byte. The frontend never reads the backend's `Content-Disposition` header (see Task 3's Interfaces block); it names the file itself from `groupName`, which is already in scope via `useGroup()`. Browsers also sanitize filesystem-invalid characters in the `download` attribute value on save regardless, so this is a defensive, not load-bearing, cleanup step.

- [ ] **Step 4: Add local state**

Add these two lines directly after the existing `const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null);` (currently line 57):

```typescript
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
```

- [ ] **Step 5: Add the export handler**

Add this directly after the existing `handleDeleteGroup` function (currently ends at line 288, before `handleUpdateExpense` begins):

```typescript
    const handleExport = async () => {
        if (!activeGroupId || isExporting) return;
        setIsExporting(true);
        setExportError(null);
        try {
            const blob = await dispatch(exportGroupExpenses({ groupId: activeGroupId })).unwrap();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${sanitizeFilenamePart(groupName)}-expenses.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to export expenses';
            setExportError(msg);
        } finally {
            setIsExporting(false);
        }
    };
```

- [ ] **Step 6: Add the Export button**

In the header action row (currently `GroupDetail.tsx:351-381`), insert this button directly after the `InvitationBox` block (currently lines 352-354) and before the "Manage members" button (currently lines 355-361):

```tsx
                    <button
                        onClick={() => void handleExport()}
                        disabled={isExporting || !activeGroupId}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border hover:bg-secondary rounded-xl transition-colors disabled:opacity-50 shrink-0"
                    >
                        <Download className="w-3.5 h-3.5" />
                        {isExporting ? 'Exporting…' : 'Export'}
                    </button>
```

- [ ] **Step 7: Add the error banner**

In the "Action error alerts" block (currently `GroupDetail.tsx:386-398`), add this directly after the existing `deleteGroupError` banner (currently lines 393-397), before the block's closing:

```tsx
            {exportError && (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{exportError}</p>
                    <button onClick={() => setExportError(null)} className="shrink-0 text-destructive/70 hover:text-destructive transition-colors">✕</button>
                </div>
            )}
```

- [ ] **Step 8: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 9: Lint**

```bash
cd money-split-app && npx eslint src/components/GroupDetail.tsx
```

Expected: no new errors.

- [ ] **Step 10: Manual verification via live preview**

Start the app (`preview_start` with the `frontend` and `backend` launch.json configs), sign in, and open a group that has at least one expense. Confirm:
- An "Export" button appears in the Overview tab's header row, between the invite-code pill and "Manage members".
- Clicking it shows "Exporting…" and disables the button while the request is in flight.
- A `.xlsx` file downloads named `<group name>-expenses.xlsx` (sanitized) and opens without a corruption warning in Excel/Numbers/Sheets.
- Opening the file on a group with expenses in more than one currency shows every expense across all currencies, each in its own currency, with per-member columns for every participant.
- Clicking Export on a brand-new group with zero expenses still downloads a valid (non-corrupt) `.xlsx` containing just the 7-column header row.
- Temporarily editing the dispatched thunk's URL (or throttling the network to force a failure) shows the dismissible red error banner instead of a silent failure; dismissing it via the ✕ clears it.
- Check both light and dark mode, and a 375px mobile viewport (the button should not overflow or wrap the header row awkwardly — the row already scrolls horizontally via `overflow-x-auto no-scrollbar`).

Revert any temporary throttling/URL edit used for the error-state check before moving on.

- [ ] **Step 11: Commit**

```bash
cd money-split-app
git add src/components/GroupDetail.tsx
git commit -m "feat: add Export button to GroupDetail header for xlsx expense export"
```

---

### Task 5: Review and verification (run after Tasks 1-4 are all complete)

**Files:** none modified except the root repo's submodule pointers (Step 8).

**Interfaces:** None produced — this task only verifies Tasks 1-4's combined output and syncs submodule pointers. It assumes both the backend track (Tasks 1-2) and the frontend track (Tasks 3-4) have already been committed independently, by different workers, with no coordination beyond the endpoint contract fixed in Task 2/Task 3's Interfaces blocks.

- [ ] **Step 1: Verify both submodules are on their expected commits**

```bash
cd /Users/ducnguyen/code/money-split
git -C money-split-backend log --oneline -3
git -C money-split-app log --oneline -3
```

Expected: the backend log shows, at the top, the two commits from Tasks 1-2 (`feat: add GET /groups/:groupId/expenses/export endpoint` and `feat: add exceljs dependency and buildExportFilename helper`); the app log shows, at the top, the two commits from Tasks 3-4 (`feat: add Export button to GroupDetail header for xlsx expense export` and `feat: add Blob-returning api.getBlob and exportGroupExpenses thunk`).

- [ ] **Step 2: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: `PASS`, including the 5 new `filename.helper` tests and the 5 new `exportExpenses` tests. No pre-existing test regresses.

- [ ] **Step 3: Typecheck the backend**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Typecheck and lint the frontend**

```bash
cd money-split-app && npx tsc --noEmit
cd money-split-app && npx eslint .
```

Expected: no errors from either command.

- [ ] **Step 5: Write a throwaway script to verify the live endpoint contract**

This confirms the actual bytes/headers the backend endpoint returns match exactly what Task 3's `requestBlob`/`api.getBlob` expects, without needing a full authenticated browser session. It creates its own test user/group/expense data directly via Prisma (using the local dev Postgres already configured in `money-split-backend/.env`'s `DATABASE_URL`), signs a JWT with the same payload shape and secret `JwtStrategy` validates against, hits the live endpoint, asserts on it, and cleans up all rows it created — including on failure.

Create `money-split-backend/scripts/verify-export-endpoint.ts`:

```typescript
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

async function main() {
  const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter: pool });
  const suffix = randomUUID().slice(0, 8);
  let group: { id: string } | null = null;
  let user: { id: string } | null = null;

  try {
    user = await prisma.user.create({
      data: { email: `export-verify-${suffix}@example.com`, name: 'Export Verify' },
    });

    group = await prisma.group.create({
      data: {
        name: `Export Verify ${suffix}`,
        inviteCode: `EXPVER${suffix}`,
        currency: 'USD',
        createdBy: user.id,
      },
    });

    const memberActive = await prisma.groupMember.create({
      data: { groupId: group.id, userId: user.id, name: 'Active Member', role: 'OWNER' },
    });
    const memberRemoved = await prisma.groupMember.create({
      data: { groupId: group.id, name: 'Removed Member', deletedAt: new Date() },
    });

    await prisma.expense.create({
      data: {
        groupId: group.id,
        description: 'Verification expense',
        amount: 20,
        splitType: 'EVEN',
        category: 'FOOD',
        currency: 'USD',
        payers: { create: [{ memberId: memberActive.id, amount: 20 }] },
        splits: {
          create: [
            { memberId: memberActive.id, amount: 10 },
            { memberId: memberRemoved.id, amount: 10 },
          ],
        },
      },
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name, picture: null },
      process.env.JWT_SECRET!,
      { expiresIn: '5m' },
    );

    const res = await fetch(
      `http://localhost:${process.env.PORT ?? 3000}/groups/${group.id}/expenses/export`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    console.log('status:', res.status);
    console.log('content-type:', res.headers.get('content-type'));
    console.log('content-disposition:', res.headers.get('content-disposition'));

    if (res.status !== 200) {
      throw new Error(`Expected 200, got ${res.status}: ${await res.text()}`);
    }
    const expectedContentType =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (res.headers.get('content-type') !== expectedContentType) {
      throw new Error(`Unexpected content-type: ${res.headers.get('content-type')}`);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    if (!disposition.includes('attachment') || !disposition.includes('.xlsx')) {
      throw new Error(`Unexpected content-disposition: ${disposition}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      throw new Error('Response body is empty');
    }
    // xlsx files are zip archives — the first two bytes are the "PK" zip signature.
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error('Response body does not start with the PK zip signature — not a valid xlsx');
    }

    console.log(`OK: received a ${buf.length}-byte valid-looking .xlsx file with the correct headers.`);
  } finally {
    if (group) {
      await prisma.expense.deleteMany({ where: { groupId: group.id } });
      await prisma.groupMember.deleteMany({ where: { groupId: group.id } });
      await prisma.group.delete({ where: { id: group.id } });
    }
    if (user) {
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
```

- [ ] **Step 6: Run it against a live backend**

Start the backend dev server (ensure the local Postgres from `docker-compose.dev.yml` is running first if it isn't already):

```bash
cd money-split-backend && npm run start:dev
```

Wait for `Application is running on: http://localhost:3000` in the log, then in a second terminal:

```bash
cd money-split-backend && npx ts-node scripts/verify-export-endpoint.ts
```

Expected output ends with:

```
status: 200
content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
content-disposition: attachment; filename="Export Verify <suffix>-expenses.xlsx"; filename*=UTF-8''Export%20Verify%20<suffix>-expenses.xlsx
OK: received a <N>-byte valid-looking .xlsx file with the correct headers.
```

If it prints `FAILED: ...` instead, stop and diagnose — this means the backend's actual response does not match the contract Task 3's frontend was built against, and the mismatch must be fixed in the backend submodule before proceeding (do not adjust the frontend to work around it; the contract in Task 2/3's Interfaces blocks is the source of truth).

Stop the dev server (`Ctrl+C` in its terminal) once the script prints `OK`.

- [ ] **Step 7: Delete the throwaway script**

```bash
cd money-split-backend && rm scripts/verify-export-endpoint.ts
git status
```

Expected: `git status` shows no tracked changes from this script (it was never committed) and the `scripts/` directory is removed if it was empty before this task, or left alone if other scripts already lived there.

- [ ] **Step 8: Sync the root repo's submodule pointers**

```bash
cd /Users/ducnguyen/code/money-split
git add money-split-app money-split-backend
git commit -m "chore: update submodule pointers to latest commits"
git status
```

Expected: the commit succeeds, and `git status` afterward shows a clean working tree with respect to the submodule pointers (other unrelated pre-existing local changes, if any, are untouched).

---
