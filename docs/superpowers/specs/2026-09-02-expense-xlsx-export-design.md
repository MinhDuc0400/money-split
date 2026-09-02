# Expense .xlsx Export Design

## Context

`GroupDetail.tsx` (`money-split-app/src/components/GroupDetail.tsx`) is currently a 3-tab page — Overview, Members, Analytics — shipped by the dashboard-analytics-expansion feature. Its Overview tab renders a sticky header with the group name/member count and an action row (invite-code pill, "Manage members", "Leave group"/"Delete group") at lines 351-381 as of this session. There is currently no way to get a group's expense history out of the app in a portable form — the only "export"-adjacent thing in the codebase is the read-only analytics endpoints (`by-category`, `by-person`, `by-person-category`, `top`) added by that same feature, all of which return aggregated JSON for on-screen charts, not a downloadable file.

This design adds a single new capability: export one group's full expense history as an `.xlsx` file, generated server-side and downloaded via an "Export" button next to the other header actions. It reuses the `ExpensesController`/`ExpensesService` (`money-split-backend/src/expenses/`) that already hosts the analytics endpoints, and follows the same `assertActiveMember` auth pattern every other endpoint on that controller uses. On the frontend it adds the first binary/Blob-returning API call in the codebase — every existing call in `money-split-app/src/lib/api.ts` assumes a JSON response — plus the first authenticated-file-download flow.

## Goals

- A member of a group can export that group's complete expense history (all currencies, all time, one row per expense) as an `.xlsx` file from the Overview tab's header action row.
- Generation happens server-side (NestJS), returned as a binary stream, not as JSON that the frontend converts.
- The sheet has one row per expense — not one row per split-line — with a fixed set of columns plus one dynamic column per distinct member who ever appeared in the group's expense history (payer or split participant), including members later removed from the group.
- A zero-expense group, and a group with zero expenses **and** zero historical members, both produce a valid, non-error `.xlsx` file (header row only).
- The Export button shows a disabled/loading state while the request is in flight and a clear, dismissible error message if it fails, using this file's own existing local-`useState` + inline-banner pattern (already used for "Leave group"/"Delete group" errors) rather than introducing new UI infrastructure.

## Non-goals

- Exporting balances, settlements, or the analytics charts — this pass is the expense list only.
- Any currency conversion or filtering. Unlike `by-category`/`by-person`/`by-person-category`/`top` (which all filter to one currency, defaulting to the group's own), this export includes every expense in the group regardless of currency, each row in its own currency. No `currency`, `from`, or `to` query params exist on this endpoint.
- Any UI for choosing a date range, a subset of members, or a subset of categories — always the full, unfiltered history.
- A generic "download any report" abstraction, a job queue, or async/email delivery for large exports — generation happens synchronously within the HTTP request, matching how every other endpoint on `ExpensesController` already works (including `getGroupTransactions`, which already loads a group's full transaction history in one response with no pagination on the underlying expense list itself).
- A new Redux state slice/triple (`{ data, loading, error }`) for the export result. The export is a one-off imperative action (trigger a browser download, discard the result), not data that gets rendered or cached — see the Frontend section for the specific state-management choice and its justification.
- Changing `EditExpenseModal`, `AddExpense`, or any other expense-editing flow.

## Backend: export endpoint

### Route and auth

`GET /groups/:groupId/expenses/export`

Added to `money-split-backend/src/expenses/expenses.controller.ts`, directly after the existing `getTopExpenses` method (the last method in the class today). No query parameters. Same `@UseGuards(JwtAuthGuard)` class-level guard as every other route on `ExpensesController`; the handler calls `ExpensesService.exportExpenses(groupId, userId)`, which calls the existing private `assertActiveMember(groupId, userId)` (`expenses.service.ts:245-260`) as its first line — identical to `getSpendingByCategory`, `getSpendingByPerson`, `getSpendingByPersonCategory`, and `getTopExpenses`. A caller who isn't an active member of the group gets the same `ForbiddenException` → 403 JSON response as every other endpoint; this happens before anything is written to the HTTP response, so it works correctly even though the handler also uses `@Res()` (see below) — Nest's exception filters still catch thrown errors from an async handler regardless of `@Res()` usage, because the guard only concerns who writes the *successful* response, not error handling. `AuthController` (`money-split-backend/src/auth/auth.controller.ts:60,86,125`) already establishes this exact `@Res() res: Response` pattern elsewhere in this codebase for non-JSON/non-Nest-serialized responses.

### Response shape

Unlike every other endpoint on this controller, the handler takes over the response manually instead of returning a value for Nest to JSON-serialize:

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

`Response` is added to the existing `import type { Request } from 'express';` line, becoming `import type { Request, Response } from 'express';`.

### Filename

Group names can contain characters invalid in filenames (`/`, `\`, `:`, etc.) or be entirely non-ASCII (e.g. `"Nhóm bạn 💰"`), so the service builds two filename variants: an ASCII-safe one for the plain `filename=` parameter (required for older clients) and a full-fidelity UTF-8 one for the `filename*=` parameter (RFC 5987/6266, honored by all current browsers and what actually gets used as the saved filename in practice).

New helper module `money-split-backend/src/helpers/filename.helper.ts`, following the existing convention of small, pure, independently-testable helpers in `src/helpers/` (`number.helper.ts`, `idempotency.helper.ts` — the latter already has its own `idempotency.helper.spec.ts`, which this new helper's spec follows the same pattern for):

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

Behavior, fully enumerated (no open edge cases):
- Normal ASCII name (`"Trip to Japan"`) → both variants are `"Trip to Japan-expenses.xlsx"`.
- Name containing filesystem-invalid characters (`"Rent/Bills?"`) → both variants strip them → `"RentBills-expenses.xlsx"`.
- Name that is entirely invalid characters or empty after stripping (`"???"`, `""`) → falls back to `"group-expenses.xlsx"` for both variants.
- Name with non-ASCII characters that survive filesystem-char stripping (`"Nhóm bạn 💰"`) → `filenameUtf8` keeps them (`"Nhóm bạn 💰-expenses.xlsx"`, percent-encoded in the header by the controller via `encodeURIComponent`); `filename` falls back further, stripping non-ASCII too (`"Nhm bn -expenses.xlsx"` if any ASCII survives, else `"group-expenses.xlsx"` if nothing does).

`buildExportFilename` is a pure function of `groupName` with no Prisma/DB dependency, so it is unit-tested directly in `src/helpers/filename.helper.spec.ts` with no mocking required.

### Data query and sheet construction

`ExpensesService.exportExpenses`, added to `money-split-backend/src/expenses/expenses.service.ts` directly after `getTopExpenses` (the last method in the class today):

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
  // active members. This mirrors getTopExpenses' payerNames convention
  // (expenses.service.ts:658-699): each row is a real historical record, so a
  // member later removed from the group should not have their historical
  // amounts silently dropped or blanked. Sorted by name for a stable,
  // human-readable column order (documented choice, not first-appearance
  // order — either is defensible, but name order makes a wide sheet easier
  // to scan for a specific person).
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

Notes on choices made explicit here to avoid ambiguity:

- **One row per expense, not per split.** The `Payer(s)` column comma-joins every payer's name for that expense (`e.payers.map(p => p.member.name).join(', ')`) — an expense can have multiple payers (`ExpensePayer` is a one-to-many relation off `Expense`, `money-split-backend/prisma/schema.prisma:180-192`). Per-member share amounts live in the dynamic member columns, one value per participating member on that same row — not as additional rows.
- **`Category` and `Split type` are the raw Prisma enum strings** (`ExpenseCategory`/`SplitType`, e.g. `"FOOD"`, `"EVEN"`) — the same convention `TopExpenseItem.category` already uses (`expense-responses.type.ts`). The frontend's `CATEGORY_LABELS` display-name mapping (`money-split-app/src/lib/expenseCategories.ts`) is a UI-only concern for on-screen charts and is not applied here; this is a backend-generated file with no frontend involved in its content.
- **`Amount` and the per-member columns are in major units** (e.g. `42.5`, not `4250` cents) — matching `TopExpenseItem.amount`'s convention, not the aggregation endpoints' `totalCents` convention. This is a list of individual historical records (like Top Expenses), not an aggregated sum (like `by-category`/`by-person`), so it follows the same major-units precedent `getTopExpenses` already set for exactly this reason.
- **`Date` is written as a plain `YYYY-MM-DD` string**, not a native Excel date cell. Writing a JS `Date` into an exceljs cell relies on the workbook's date-serialization/epoch handling and introduces timezone-conversion ambiguity for no benefit here (nothing in this feature needs date arithmetic inside the spreadsheet); a plain ISO-format string is unambiguous, trivially testable byte-for-byte, and still fully sortable-as-text in Excel/Sheets.
- **`deletedAt: null` is applied only to `Expense`** (excluding soft-deleted expenses, consistent with every other endpoint on this service) — deliberately **not** applied to `GroupMember` anywhere in this query. The `member` relation on `ExpensePayer`/`ExpenseSplit` uses `onDelete: Restrict` (schema.prisma:188,206), so a removed (soft-deleted) member's row is never deleted or nulled out; including it via `include: { member: true }` with no `deletedAt` filter on that relation naturally returns the member's name whether or not they're still active. No extra query or active/removed branching is needed — this falls out of the schema's existing FK behavior.
- **Two distinct members sharing the same display name** produce two separate columns with identical header text (their underlying `key`s, `member:<memberId>`, stay unique, so their data never collides) — an accepted cosmetic limitation, not a bug, in the same spirit as `getMemberColor`'s accepted palette-collision tradeoff from the analytics feature (`2026-08-26-dashboard-analytics-expansion-design.md`, Color consistency section).
- **Zero-expense group**: `expenses` is `[]`, so the `for` loop that builds `memberNameById` never runs, so `memberColumns` is `[]` too — the sheet ends up with just the 7 fixed columns and a bold header row, no data rows, no member columns. This satisfies the zero-expenses-and-zero-historical-members edge case with no special-case branch; it's the natural result of both loops being empty.
- **Aggregation logic stays inline in the service method**, not extracted into a shared helper, following the same explicit precedent `getSpendingByPersonCategory` already set for its own in-memory aggregation (`2026-08-26-dashboard-analytics-expansion-design.md`: "extract no shared helper for this pass — the existing code doesn't have one either"). Only the pure, dependency-free `buildExportFilename` is extracted, because it's independently testable without any Prisma mocking — the same bar `idempotency.helper.ts` already met.

Import changes in `expenses.service.ts`: add `import ExcelJS from 'exceljs';` (the package's `esModuleInterop`-compatible default export — confirmed via its bundled `index.d.ts`, which uses `export =`; `money-split-backend/tsconfig.json` already has `esModuleInterop: true` and `allowSyntheticDefaultImports: true`) and `import { buildExportFilename } from '../helpers/filename.helper';`.

### New dependency

`money-split-backend/package.json` has no `exceljs` or `@types/exceljs` entry today (confirmed by reading the file). `exceljs@4.4.0` (current latest, confirmed via `npm view exceljs version`) ships its own bundled type definitions (`index.d.ts`, confirmed via `npm view exceljs types` and directly fetching `https://unpkg.com/exceljs@4.4.0/index.d.ts`) — `workbook.xlsx.writeBuffer()` is typed as `Promise<Buffer>`, so no `Buffer.from(...)` conversion is needed, and no separate `@types/exceljs` package should be installed (the one that exists on npm, `@types/exceljs@1.3.2`, predates and doesn't match the current API and would only cause type conflicts). The implementation plan's first backend step is `npm install exceljs` only.

## Frontend: Export trigger and download

### Why not a new Redux state slice

Every existing API call in this codebase is routed through a `createAsyncThunk` in a slice file (`money-split-app/src/store/slices/groupSlice.ts` is where all group-scoped ones live), so the export call follows that same routing for consistency. However, unlike the analytics thunks (`fetchSpendingByPerson` etc.), this thunk's result — a `Blob` — is never rendered and never needs to be read back later, so it gets **no `.addCase(pending/fulfilled/rejected)` reducers at all**: there is nothing in `GroupState` for it to update. Storing a `Blob` in Redux state would also trip Redux Toolkit's built-in serializability check (Blobs aren't plain serializable values), which is a second, independent reason not to persist it. This mirrors the existing precedent of `settleAllApi` (`groupSlice.ts:224-231,657-667`): `GroupDetail.tsx` already dispatches it and reads success/failure via `.unwrap()`'s try/catch into its own local `isSettlingAll`/`settleAllError` state (`GroupDetail.tsx:197-234`), not via the slice's generic `state.isLoading`/`state.error` that the thunk's reducer cases update — this export thunk goes one step further and skips the generic reducer cases entirely, since even that shared boolean would be actively misleading here (it's shared across unrelated concurrent requests) and nothing reads it for this feature anyway.

### `api.ts`: a Blob-returning request helper

`money-split-app/src/lib/api.ts`'s `request<T>` function always does `JSON.parse(text)` (line 61) — every existing caller needs a parsed JSON body. The export endpoint returns binary `.xlsx` bytes, so a sibling function is added that shares the same auth-header/401-handling/error-message logic but returns a `Blob` instead:

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

`requestBlob` deliberately does **not** set a `Content-Type: application/json` default header (unlike `request<T>`) — this is always a bodyless `GET`, so there's no JSON request body to describe, and the response's own `Content-Type` (set server-side to the xlsx MIME type) is what matters for the caller. The `!response.ok` branch still calls `response.json()` because a failed request (403, 500, etc.) gets Nest's normal JSON error body, not xlsx bytes — the failure path never touches `.blob()`.

### API endpoint constant

`money-split-app/src/constants/api.constants.ts`, added to `API_ENDPOINTS.GROUPS` directly after the existing `EXPENSES_TOP` entry:

```typescript
EXPENSES_EXPORT: (id: string) => `${API_BASE_URL}/groups/${id}/expenses/export`,
```

### Redux thunk

`money-split-app/src/store/slices/groupSlice.ts`, added directly after `fetchTopExpenses` (no reducer cases — see rationale above):

```typescript
export const exportGroupExpenses = createAsyncThunk(
    'groups/exportExpenses',
    async ({ groupId }: { groupId: string }) => {
        return await api.getBlob(API_ENDPOINTS.GROUPS.EXPENSES_EXPORT(groupId));
    }
);
```

### `GroupDetail.tsx`: button, handler, state

Two new local state fields alongside the file's existing action-state fields (`isLeavingGroup`/`leaveError`, `isDeletingGroup`/`deleteGroupError`, pattern at `GroupDetail.tsx:54-60`):

```typescript
const [isExporting, setIsExporting] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);
```

Handler, following the exact `try/catch/finally` + `err instanceof Error` shape already used by `handleLeaveGroup`/`handleDeleteGroup`/`handleConfirmSettleAll` (`GroupDetail.tsx:254-288,197-234`):

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

`sanitizeFilenamePart` is a small module-level (non-exported) helper defined near the top of `GroupDetail.tsx`, purely for the anchor's `download` attribute — it does not need to match the backend's `buildExportFilename` byte-for-byte. The frontend does not read the backend's `Content-Disposition` header at all: `fetch`'s CORS handling only exposes a fixed safelist of response headers to page JavaScript by default (`Content-Disposition` isn't in it), so reading it would require the backend to also add `Access-Control-Expose-Headers: Content-Disposition` — an extra moving part this design avoids entirely by having the frontend name the file itself from data it already has (`groupName`, already in `GroupContext`). The backend's header still matters independently of the frontend (e.g. `curl -OJ` or a future non-Blob consumer), it's just not part of this download flow's contract. Browsers also sanitize filesystem-invalid characters in the `download` attribute value on save regardless, so this is a defensive, not load-bearing, cleanup step:

```typescript
function sanitizeFilenamePart(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '').trim() || 'group';
}
```

Button, inserted into the existing header action row (`GroupDetail.tsx:351-381`) directly after the `InvitationBox` and before "Manage members" — grouped with the other benign, non-destructive header actions rather than next to "Leave/Delete group". Its classes are copied verbatim from the adjacent "Manage members" button, plus the `disabled:opacity-50` class already used by the Leave/Delete buttons for their own loading states:

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

`Download` is added to the existing `import { LogOut, Trash2 } from 'lucide-react';` line, becoming `import { LogOut, Trash2, Download } from 'lucide-react';`.

Error banner, inserted into the existing "Action error alerts" block (`GroupDetail.tsx:386-398`) alongside `leaveError`/`deleteGroupError`, copied verbatim from that exact pattern:

```tsx
{exportError && (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-xl px-4 py-3 flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{exportError}</p>
        <button onClick={() => setExportError(null)} className="shrink-0 text-destructive/70 hover:text-destructive transition-colors">✕</button>
    </div>
)}
```

New imports needed in `GroupDetail.tsx`: `exportGroupExpenses` added to the existing `import { settleAllApi, settleGuestApi, fetchTransactionsNextPage } from '../store/slices/groupSlice';` line.

## Endpoint contract summary (frontend/backend interface)

- **Method/path**: `GET /groups/:groupId/expenses/export`
- **Auth**: `Authorization: Bearer <token>` header (existing `JwtAuthGuard`), same as every other `/groups/:groupId/...` route. 403 JSON body (`{ statusCode, message, error }`) if the caller isn't an active member of the group.
- **Request body/query**: none.
- **Success response**: `200`, body is raw `.xlsx` bytes (never JSON).
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="<ascii-safe-name>-expenses.xlsx"; filename*=UTF-8''<percent-encoded-full-name>-expenses.xlsx`
- **Failure response**: standard Nest JSON error body (403 for non-members; unhandled errors fall through to Nest's default 500 JSON error body — no bespoke error handling is added for this endpoint beyond `assertActiveMember`'s existing 403).
- **Sheet contents**: one row per non-deleted expense in the group, across all currencies and all time, ordered by `date` ascending. Columns: `Date` (`YYYY-MM-DD` string) · `Description` · `Amount` (major units, per-expense currency) · `Currency` · `Category` (raw enum string) · `Payer(s)` (comma-joined names) · `Split type` (raw enum string) · one column per distinct member who ever appeared as a payer or split participant in this group's history (header = member name, sorted alphabetically; cell = that member's split amount for the row's expense in major units, or blank if they didn't participate in that expense). A group with zero expenses returns a valid `.xlsx` with just the bold header row and the 7 fixed columns (no member columns).

## Testing

- **Backend**:
  - `money-split-backend/src/helpers/filename.helper.spec.ts` (new file, no Prisma mocking, following the existing `idempotency.helper.spec.ts` precedent): direct unit tests of `buildExportFilename` covering the four enumerated behaviors above (plain ASCII name, name with invalid characters, name that's all-invalid/empty, non-ASCII name).
  - `describe('exportExpenses', ...)` added to `money-split-backend/src/expenses/expenses.service.spec.ts`, mirroring the existing `describe('getTopExpenses', ...)` block's mocked-`PrismaService` style: membership check (`ForbiddenException` when not an active member, and `expense.findMany` never called in that case); zero-expense group produces a workbook with only the 7 fixed columns and a header row (verified by reading the returned `Buffer` back with `new ExcelJS.Workbook().xlsx.load(buffer)` and asserting `worksheet.rowCount === 1` and `worksheet.columnCount === 7`); one expense with multiple payers produces exactly one data row with all payer names comma-joined in `Payer(s)`; a member column is present and correctly valued for a split from a member whose mocked `GroupMember` record has `deletedAt` set (removed-member inclusion); a member who didn't participate in a given expense has a blank/`null` cell in that row for their column, not `0`; member columns are sorted alphabetically by name; `Date`/`Amount`/`Category`/`Split type`/`Currency` values match the source `Expense` row exactly (including major-units, not cents, for `Amount`).
  - `npx tsc --noEmit` and the full `npx jest --silent` suite, same as every other backend task in this repo's plans.
- **Frontend**: no test runner exists in `money-split-app` (confirmed: `package.json` scripts are only `dev`/`build`/`lint`/`preview`, no `jest`/`vitest`/`@testing-library/*` dependency), consistent with every prior plan in this repo (`2026-08-26-dashboard-analytics-expansion.md`, `2026-07-07-multi-currency-settle-all.md`). Verification is `npx tsc --noEmit`, `npx eslint <changed files>`, and manual/live-preview click-through: click Export on a group with expenses across more than one currency and confirm a valid `.xlsx` downloads and opens correctly; click Export on a brand-new group with zero expenses and confirm a valid (not corrupt, not empty-body) `.xlsx` downloads with just a header row; disable the network tab response temporarily or point at a non-member group to confirm the error banner renders and is dismissible; confirm the button shows its disabled "Exporting…" state for the duration of the request.
