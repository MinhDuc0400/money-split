# Dashboard Analytics Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new analytics cards (Spending by Person with a Paid/Share toggle, Category breakdown per person, Top Expenses), which together with the existing Spending by Category card live on an **Analytics tab inside `GroupDetail.tsx`** (`/group/:id/details`), alongside a **Members tab** that embeds the existing member-management UI — without touching any card's own fetch/render logic, and without adding a new route or sidebar nav entry.

> **Revision note (2026-08-26):** Tasks 1-9 below (backend endpoints, frontend types/state, the four cards, and the original `GroupAnalytics.tsx` page component) are already implemented and committed exactly as originally planned and are unaffected by this revision — do not redo them. The version of Task 8/9 that shipped gave `GroupAnalytics.tsx` its own dedicated `/group/:id/analytics` route, reached from a desktop-only "Current group" sidebar section in `Layout.tsx`. Live browser testing after that shipped surfaced two problems: mobile users had no way to reach `/group/:id/analytics` at all (the sidebar section is `hidden md:flex` and `GroupDetail.tsx`'s own mobile-visible action row never linked to it), and the "Current group" sidebar nav category was judged not to be meaningful UX. Tasks 11-14 below replace that placement: both "Manage members" and "Analytics" become in-page tabs on `GroupDetail.tsx` instead of separate routes, which mobile already reaches. Task 10 (submodule pointer sync) is renumbered to Task 15 and now runs after Task 14.

**Architecture:** Backend: three new read-only endpoints on the existing `ExpensesController`/`ExpensesService` (`GET /groups/:groupId/expenses/by-person`, `.../by-person-category`, `.../top`), each following the exact currency/date-filter/soft-delete pattern already used by `getSpendingByCategory`. The member×category endpoint aggregates in application code (not raw SQL) because Prisma's `groupBy` can't group by a joined model's field. Frontend: three new dashboard cards (donut, stacked bar, ranked list) added to `groupSlice.ts` state/thunks mirroring the existing `categorySpending` pattern, a new `memberColors.ts` palette module for person-keyed color consistency, and a `GroupAnalytics.tsx` component that renders all four analytics cards (existing + 3 new), fetched on mount. `Dashboard.tsx` has no charts at all: the `SpendingByCategoryCard` wiring that used to live there was removed as part of Task 9 and stays removed. As of this revision, `GroupAnalytics.tsx` is no longer a standalone routed page — it's a chrome-stripped panel embedded inside a new `GroupDetail.tsx` tab, alongside a Members tab embedding `MemberManager.tsx` unchanged, switched by a new local pill-style tab control (`GroupDetailTabs.tsx`) with `useState` tab selection (no URL/query-param deep-linking). The `/group/:id/members` and `/group/:id/analytics` routes and the "Current group" sidebar section are removed entirely.

**Tech Stack:** NestJs 11, Prisma (existing `PrismaService`, no schema changes), Jest (backend TDD, mocked Prisma, no live DB), React 19, Redux Toolkit, recharts (`PieChart` — existing usage; `BarChart`/`Bar` — new usage in this codebase), Tailwind.

## Global Constraints

- Repo paths are `money-split-backend/` and `money-split-app/` as git submodules under the `money-split/` root — not standalone sibling directories. Each submodule is its own git repo; commits happen inside each submodule, then the root repo's submodule pointers are updated and committed separately as the final task (see Task 15), matching this root repo's existing `chore: update submodule pointers to latest commits` commits.
- **Placement (revised):** Manage Members and Analytics are in-page tabs on `GroupDetail.tsx`, not separate routes. Tab selection is local `useState` on `GroupDetail.tsx` (`'overview' | 'members' | 'analytics'`, default `'overview'`), not URL/query-param deep-linked. Each tab's content is only mounted while `activeTab` matches it (`activeTab === 'members' && <MemberManager />`, etc.) — this is what makes `GroupAnalytics`'s data fetch happen lazily on first tab-open rather than eagerly on `GroupDetail.tsx` mount.
- Currency/date filtering semantics are byte-for-byte identical across all three new endpoints and the existing `by-category` endpoint: a `currency` query param filters exactly; when omitted, fall back to the group's own `currency` (one `group.findUnique` lookup); `from`/`to` build an optional `date: { gte, lte }` filter (either bound alone is valid); `deletedAt: null` always applied. No cross-currency conversion or aggregation anywhere in this feature — expenses in other currencies are silently excluded, exactly like `by-category` already behaves.
- No new Prisma schema/migration — all three endpoints read existing `Expense`/`ExpensePayer`/`ExpenseSplit`/`GroupMember` tables.
- The member×category endpoint aggregates `ExpenseSplit` rows (joined with `Expense.category`) in application code, not Prisma `groupBy` (which cannot group by a related model's field) and not raw SQL (explicit decision — expense volume per group is small).
- Aggregation endpoints (`by-person`, `by-person-category`) silently drop rows for members who are no longer active (`GroupMember.deletedAt` set), mirroring `getBalances`' existing convention. The `top` list endpoint does the opposite on purpose — it keeps removed members' names in `payerNames`, because each row there is an individual historical expense record, not a group-by aggregate keyed by member.
- Person-keyed color (only the Spending by Person donut) comes from a new deterministic `getMemberColor(memberId)` helper in `money-split-app/src/lib/memberColors.ts`. Category-keyed color (the stacked bar's segments, and the existing donut) reuses `CATEGORY_COLORS` from `money-split-app/src/lib/expenseCategories.ts` unchanged — the two charts never need to agree on color with each other.
- Backend testing: Jest, TDD (RED then GREEN), mocked `PrismaService` (no live DB in unit tests), following the exact `describe('getSpendingByCategory', ...)` style already in `money-split-backend/src/expenses/expenses.service.spec.ts:171-295`.
- Frontend testing: confirmed no test runner exists in `money-split-app` (`package.json` scripts are only `dev`/`build`/`lint`/`preview`; no `jest`/`vitest`/`@testing-library/*` dependency) and no test file exists for `SpendingByCategoryCard.tsx` to mirror. Frontend verification for every frontend task in this plan is `npx tsc --noEmit`, `npx eslint <changed files>`, and — for the final integration task — manual/live-preview click-through in light/dark mode and at a 375px viewport, matching the `2026-07-07-multi-currency-settle-all` plan's precedent. No new frontend test files are created.
- Content voice (`money-split-app/design-system/MASTER.md`): sentence case, no exclamation marks. Currency amounts always get the `tabular-nums` Tailwind class.

---

## File Structure

**Backend (`money-split-backend/`):**
- Modify: `src/expenses/types/expense-responses.type.ts` (add `PersonSpending`, `PersonCategorySpending`, `TopExpenseItem`)
- Modify: `src/expenses/expenses.service.ts` (add `getSpendingByPerson`, `getSpendingByPersonCategory`, `getTopExpenses`)
- Modify: `src/expenses/expenses.service.spec.ts` (add three new `describe` blocks)
- Modify: `src/expenses/expenses.controller.ts` (add three new `@Get()` endpoints)

**Frontend (`money-split-app/`):**
- Modify: `src/types/expense.types.ts` (add `PersonSpending`, `PersonCategorySpending`, `TopExpenseItem`) — Task 4, done
- Modify: `src/constants/api.constants.ts` (add `EXPENSES_BY_PERSON`, `EXPENSES_BY_PERSON_CATEGORY`, `EXPENSES_TOP`) — Task 4, done
- Modify: `src/store/slices/groupSlice.ts` (add three `{ data, loading, error }` state triples + thunks + reducers) — Task 4, done
- Create: `src/lib/memberColors.ts` — Task 5, done
- Create: `src/components/dashboard/SpendingByPersonCard.tsx` — Task 5, done
- Create: `src/components/dashboard/CategoryByPersonCard.tsx` — Task 6, done
- Create: `src/components/dashboard/TopExpensesCard.tsx` — Task 7, done
- Modify: `src/components/Dashboard.tsx` (removed the `SpendingByCategoryCard` import, its Redux selectors, its fetch `useEffect`, and its render — page has zero charts) — Task 9, done
- Create: `src/components/group-detail/GroupDetailTabs.tsx` (new pill-style Overview/Members/Analytics tab switcher) — **Task 11, new**
- Modify: `src/components/GroupAnalytics.tsx` (strip the page-level header/back-button, take a `groupId` prop instead of `useParams()`, drop its own `switchGroup`/`activeGroupId` sync effect and its own `useGroupEvents` call — becomes an embeddable tab panel instead of a routed page) — **Task 12, new**
- Modify: `src/components/GroupDetail.tsx` (add `activeTab` state and `<GroupDetailTabs>`, wrap existing Overview content in a tab conditional, embed `<MemberManager />` and `<GroupAnalytics groupId={routeId} />` behind the Members/Analytics tab conditionals, repoint the header's "Manage members" button to `setActiveTab('members')`) — **Task 13, new**
- Modify: `src/App.tsx` (remove the `MemberManager`/`GroupAnalytics` lazy imports and the `/group/:id/members`/`/group/:id/analytics` routes) — **Task 14, new**
- Modify: `src/components/Layout.tsx` (remove the entire "Current group" sidebar section — the "Manage members" and "Analytics" buttons and their heading — and the now-unused `activeGroupId`/`BarChart3` imports) — **Task 14, new**

**Root repo (`money-split/`):**
- Modify: `money-split-app` and `money-split-backend` submodule pointers (final commit — Task 15)

**Not modified by this revision:** `src/components/MemberManager.tsx` stays exactly as committed in an earlier pass — it's embedded inline as `<MemberManager />` with no code changes, since it already has no page-level chrome to strip.

---

### Task 1: Backend — Spending by Person endpoint (paid vs. share)

**Files:**
- Modify: `money-split-backend/src/expenses/types/expense-responses.type.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`
- Test: `money-split-backend/src/expenses/expenses.service.spec.ts`

**Interfaces:**
- Produces: `ExpensesService.getSpendingByPerson(groupId: string, userId: string, currency?: string, from?: string, to?: string, metric?: 'paid' | 'share'): Promise<PersonSpending[]>` where `PersonSpending = { memberId: string; name: string; totalCents: number }`. `GET /groups/:groupId/expenses/by-person?currency=&from=&to=&metric=paid|share` returns `PersonSpending[]` as JSON. Task 4 (frontend) consumes this exact response shape.

- [x] **Step 1: Add the `PersonSpending` response type**

In `money-split-backend/src/expenses/types/expense-responses.type.ts`, add at the end of the file, after the existing `CategorySpending` interface:

```typescript
export interface PersonSpending {
  memberId: string;
  name: string;
  totalCents: number;
}
```

- [x] **Step 2: Add mock methods needed for the new tests**

In `money-split-backend/src/expenses/expenses.service.spec.ts`, the `mockPrisma` object (around line 17-47) already has `groupMember: { findMany: jest.fn(), findUnique: jest.fn() }`. Add `groupBy` to the `expensePayer` and `expenseSplit` mocks:

```typescript
    expensePayer: {
      createMany: jest.fn(),
      groupBy: jest.fn(),
    },
    expenseSplit: {
      createMany: jest.fn(),
      groupBy: jest.fn(),
    },
```

(This replaces the existing `expensePayer: { createMany: jest.fn() }` and `expenseSplit: { createMany: jest.fn() }` blocks.)

- [x] **Step 3: Write the failing tests**

Add this new `describe` block to `money-split-backend/src/expenses/expenses.service.spec.ts`, directly after the closing `});` of the `describe('getSpendingByCategory', ...)` block (after line 295, before `describe('updateExpense (category preserve-on-omit)', ...)`):

```typescript
  describe('getSpendingByPerson', () => {
    const groupId = 'group-1';
    const userId = 'user-1';

    beforeEach(() => {
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        id: 'member-1',
        groupId,
        userId,
        deletedAt: null,
      });
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getSpendingByPerson(groupId, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.expensePayer.groupBy).not.toHaveBeenCalled();
      expect(mockPrisma.expenseSplit.groupBy).not.toHaveBeenCalled();
    });

    it("defaults to the 'paid' metric and queries expensePayer", async () => {
      mockPrisma.expensePayer.groupBy.mockResolvedValueOnce([]);

      await service.getSpendingByPerson(groupId, userId, 'USD');

      expect(mockPrisma.expensePayer.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['memberId'],
          where: expect.objectContaining({
            expense: expect.objectContaining({
              groupId,
              deletedAt: null,
              currency: 'USD',
            }),
          }),
          _sum: { amount: true },
        }),
      );
      expect(mockPrisma.expenseSplit.groupBy).not.toHaveBeenCalled();
    });

    it("queries expenseSplit when metric is 'share'", async () => {
      mockPrisma.expenseSplit.groupBy.mockResolvedValueOnce([]);

      await service.getSpendingByPerson(
        groupId,
        userId,
        'USD',
        undefined,
        undefined,
        'share',
      );

      expect(mockPrisma.expenseSplit.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['memberId'],
          where: expect.objectContaining({
            expense: expect.objectContaining({
              groupId,
              deletedAt: null,
              currency: 'USD',
            }),
          }),
          _sum: { amount: true },
        }),
      );
      expect(mockPrisma.expensePayer.groupBy).not.toHaveBeenCalled();
    });

    it("falls back to the group's own currency when none is provided", async () => {
      mockPrisma.group.findUnique.mockResolvedValueOnce({
        id: groupId,
        currency: 'VND',
      });
      mockPrisma.expensePayer.groupBy.mockResolvedValueOnce([]);

      await service.getSpendingByPerson(groupId, userId);

      expect(mockPrisma.group.findUnique).toHaveBeenCalledWith({
        where: { id: groupId },
      });
      expect(mockPrisma.expensePayer.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expense: expect.objectContaining({ currency: 'VND' }),
          }),
        }),
      );
    });

    it('builds a date range filter on the joined expense when from/to are provided', async () => {
      mockPrisma.expensePayer.groupBy.mockResolvedValueOnce([]);

      await service.getSpendingByPerson(
        groupId,
        userId,
        'USD',
        '2026-01-01',
        '2026-01-31',
      );

      expect(mockPrisma.expensePayer.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expense: expect.objectContaining({
              date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
            }),
          }),
        }),
      );
    });

    it('joins member names, converts to cents, and drops removed members', async () => {
      mockPrisma.expensePayer.groupBy.mockResolvedValueOnce([
        { memberId: 'member-a', _sum: { amount: 12.5 } },
        { memberId: 'member-removed', _sum: { amount: 7 } },
      ]);
      mockPrisma.groupMember.findMany.mockResolvedValueOnce([
        { id: 'member-a', name: 'Alice', deletedAt: null },
      ]);

      const result = await service.getSpendingByPerson(groupId, userId, 'USD');

      expect(result).toEqual([
        { memberId: 'member-a', name: 'Alice', totalCents: 1250 },
      ]);
    });

    it('returns an empty array when there is no spending in that currency', async () => {
      mockPrisma.expensePayer.groupBy.mockResolvedValueOnce([]);
      mockPrisma.groupMember.findMany.mockResolvedValueOnce([]);

      const result = await service.getSpendingByPerson(groupId, userId, 'USD');

      expect(result).toEqual([]);
    });
  });
```

- [x] **Step 4: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `FAIL` — `service.getSpendingByPerson is not a function`.

- [x] **Step 5: Implement `getSpendingByPerson`**

In `money-split-backend/src/expenses/expenses.service.ts`, add the import at the top (extend the existing `types/expense-responses.type` import block, which currently reads `BalancesByCurrency, CategorySpending, ExpenseResponse, PaginatedTransactionHistory, RecommendedSettlement, TransactionHistoryItem, UserBalanceResponse`):

```typescript
import {
  BalancesByCurrency,
  CategorySpending,
  ExpenseResponse,
  PaginatedTransactionHistory,
  PersonSpending,
  RecommendedSettlement,
  TransactionHistoryItem,
  UserBalanceResponse,
} from './types/expense-responses.type';
```

Add this method directly after `getSpendingByCategory` (after its closing `}` around line 527):

```typescript
  async getSpendingByPerson(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
    metric: 'paid' | 'share' = 'paid',
  ): Promise<PersonSpending[]> {
    await this.assertActiveMember(groupId, userId);

    let effectiveCurrency = currency;
    if (!effectiveCurrency) {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
      });
      effectiveCurrency = group?.currency || 'USD';
    }

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const expenseWhere = {
      groupId,
      deletedAt: null,
      currency: effectiveCurrency,
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    };

    const grouped =
      metric === 'share'
        ? await this.prisma.expenseSplit.groupBy({
            by: ['memberId'],
            where: { expense: expenseWhere },
            _sum: { amount: true },
          })
        : await this.prisma.expensePayer.groupBy({
            by: ['memberId'],
            where: { expense: expenseWhere },
            _sum: { amount: true },
          });

    const activeMembers = await this.prisma.groupMember.findMany({
      where: { groupId, deletedAt: null },
    });
    const memberMap = new Map(activeMembers.map((m) => [m.id, m]));

    return grouped
      .filter((g) => memberMap.has(g.memberId))
      .map((g) => ({
        memberId: g.memberId,
        name: memberMap.get(g.memberId)!.name,
        totalCents: toCents(Number(g._sum.amount ?? 0)),
      }));
  }
```

- [x] **Step 6: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `PASS`, all tests including the 7 new ones.

- [x] **Step 7: Add the controller endpoint**

In `money-split-backend/src/expenses/expenses.controller.ts`, add `PersonSpending` to the existing type import block (currently `BalancesByCurrency, CategorySpending, ExpenseResponse, PaginatedTransactionHistory, RecommendedSettlement, UserBalanceResponse`):

```typescript
import {
  BalancesByCurrency,
  CategorySpending,
  ExpenseResponse,
  PaginatedTransactionHistory,
  PersonSpending,
  RecommendedSettlement,
  UserBalanceResponse,
} from './types/expense-responses.type';
```

Add this method to `ExpensesController`, directly after `getSpendingByCategory` (after its closing `}`, before the class's final closing `}`):

```typescript
  @Get('expenses/by-person')
  @ApiOperation({ summary: 'Get spending totals grouped by member (paid or share)' })
  @ApiResponse({ status: 200, description: 'Return spending totals per member.' })
  getSpendingByPerson(
    @Param('groupId') groupId: string,
    @Req() req: Request,
    @Query('currency') currency?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('metric') metric?: string,
  ): Promise<PersonSpending[]> {
    const userId = req.user!.id;
    const effectiveMetric = metric === 'share' ? 'share' : 'paid';
    return this.expensesService.getSpendingByPerson(
      groupId,
      userId,
      currency,
      from,
      to,
      effectiveMetric,
    );
  }
```

- [x] **Step 8: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 9: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: same pass/fail counts as before this task, plus the 7 new `getSpendingByPerson` tests passing. Any pre-existing unrelated failures stay unchanged.

- [x] **Step 10: Commit**

```bash
cd money-split-backend
git add src/expenses/types/expense-responses.type.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts
git commit -m "feat: add GET /groups/:groupId/expenses/by-person endpoint"
```

---

### Task 2: Backend — Category breakdown per person endpoint

**Files:**
- Modify: `money-split-backend/src/expenses/types/expense-responses.type.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`
- Test: `money-split-backend/src/expenses/expenses.service.spec.ts`

**Interfaces:**
- Consumes: `assertActiveMember` (existing, unchanged), `toCents` from `../helpers/number.helper` (existing, unchanged).
- Produces: `ExpensesService.getSpendingByPersonCategory(groupId: string, userId: string, currency?: string, from?: string, to?: string): Promise<PersonCategorySpending[]>` where `PersonCategorySpending = { memberId: string; name: string; category: string; totalCents: number }`. `GET /groups/:groupId/expenses/by-person-category?currency=&from=&to=` returns `PersonCategorySpending[]` as JSON — a flat list, one row per (member, category) pair with non-zero spend, not pre-nested by member. Task 4/7 (frontend) consume this exact response shape and pivot it client-side.

- [x] **Step 1: Add the `PersonCategorySpending` response type**

In `money-split-backend/src/expenses/types/expense-responses.type.ts`, add at the end of the file, after `PersonSpending`:

```typescript
export interface PersonCategorySpending {
  memberId: string;
  name: string;
  category: string;
  totalCents: number;
}
```

- [x] **Step 2: Add the `expenseSplit.findMany` mock and reuse `groupMember.findMany`**

`mockPrisma.expenseSplit` and `mockPrisma.groupMember.findMany` already exist from Task 1's Step 2 and the file's original setup. Add `findMany` to `expenseSplit`:

```typescript
    expenseSplit: {
      createMany: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
```

- [x] **Step 3: Write the failing tests**

Add this new `describe` block directly after the `describe('getSpendingByPerson', ...)` block added in Task 1 (before `describe('updateExpense (category preserve-on-omit)', ...)`):

```typescript
  describe('getSpendingByPersonCategory', () => {
    const groupId = 'group-1';
    const userId = 'user-1';

    beforeEach(() => {
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        id: 'member-1',
        groupId,
        userId,
        deletedAt: null,
      });
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getSpendingByPersonCategory(groupId, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.expenseSplit.findMany).not.toHaveBeenCalled();
    });

    it('filters the joined expense by currency without querying the group', async () => {
      mockPrisma.expenseSplit.findMany.mockResolvedValueOnce([]);

      await service.getSpendingByPersonCategory(groupId, userId, 'EUR');

      expect(mockPrisma.group.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.expenseSplit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expense: expect.objectContaining({ groupId, deletedAt: null, currency: 'EUR' }),
          }),
          select: expect.objectContaining({
            memberId: true,
            amount: true,
            expense: { select: { category: true } },
          }),
        }),
      );
    });

    it('builds a date range filter on the joined expense when from/to are provided', async () => {
      mockPrisma.expenseSplit.findMany.mockResolvedValueOnce([]);

      await service.getSpendingByPersonCategory(
        groupId,
        userId,
        'USD',
        '2026-01-01',
        '2026-01-31',
      );

      expect(mockPrisma.expenseSplit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expense: expect.objectContaining({
              date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
            }),
          }),
        }),
      );
    });

    it('aggregates multiple splits for the same member and category into one row', async () => {
      mockPrisma.expenseSplit.findMany.mockResolvedValueOnce([
        { memberId: 'member-a', amount: 10, expense: { category: 'FOOD' } },
        { memberId: 'member-a', amount: 2.5, expense: { category: 'FOOD' } },
        { memberId: 'member-a', amount: 5, expense: { category: 'TRANSPORT' } },
      ]);
      mockPrisma.groupMember.findMany.mockResolvedValueOnce([
        { id: 'member-a', name: 'Alice', deletedAt: null },
      ]);

      const result = await service.getSpendingByPersonCategory(groupId, userId, 'USD');

      expect(result).toEqual([
        { memberId: 'member-a', name: 'Alice', category: 'FOOD', totalCents: 1250 },
        { memberId: 'member-a', name: 'Alice', category: 'TRANSPORT', totalCents: 500 },
      ]);
    });

    it('drops rows for members who are no longer active', async () => {
      mockPrisma.expenseSplit.findMany.mockResolvedValueOnce([
        { memberId: 'member-removed', amount: 10, expense: { category: 'FOOD' } },
      ]);
      mockPrisma.groupMember.findMany.mockResolvedValueOnce([]);

      const result = await service.getSpendingByPersonCategory(groupId, userId, 'USD');

      expect(result).toEqual([]);
    });

    it('returns an empty array when there are no splits in that currency', async () => {
      mockPrisma.expenseSplit.findMany.mockResolvedValueOnce([]);
      mockPrisma.groupMember.findMany.mockResolvedValueOnce([]);

      const result = await service.getSpendingByPersonCategory(groupId, userId, 'USD');

      expect(result).toEqual([]);
    });
  });
```

- [x] **Step 4: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `FAIL` — `service.getSpendingByPersonCategory is not a function`.

- [x] **Step 5: Implement `getSpendingByPersonCategory`**

In `money-split-backend/src/expenses/expenses.service.ts`, add `PersonCategorySpending` to the type import block from Task 1 (now `BalancesByCurrency, CategorySpending, ExpenseResponse, PaginatedTransactionHistory, PersonCategorySpending, PersonSpending, RecommendedSettlement, TransactionHistoryItem, UserBalanceResponse`).

Add this method directly after `getSpendingByPerson` (added in Task 1):

```typescript
  async getSpendingByPersonCategory(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
  ): Promise<PersonCategorySpending[]> {
    await this.assertActiveMember(groupId, userId);

    let effectiveCurrency = currency;
    if (!effectiveCurrency) {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
      });
      effectiveCurrency = group?.currency || 'USD';
    }

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const splits = await this.prisma.expenseSplit.findMany({
      where: {
        expense: {
          groupId,
          deletedAt: null,
          currency: effectiveCurrency,
          ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        },
      },
      select: {
        memberId: true,
        amount: true,
        expense: { select: { category: true } },
      },
    });

    const activeMembers = await this.prisma.groupMember.findMany({
      where: { groupId, deletedAt: null },
    });
    const memberMap = new Map(activeMembers.map((m) => [m.id, m]));

    const totals = new Map<
      string,
      { memberId: string; category: string; totalCents: number }
    >();
    for (const split of splits) {
      if (!memberMap.has(split.memberId)) continue;
      const key = `${split.memberId}::${split.expense.category}`;
      const existing = totals.get(key);
      const cents = toCents(Number(split.amount));
      if (existing) {
        existing.totalCents += cents;
      } else {
        totals.set(key, {
          memberId: split.memberId,
          category: split.expense.category,
          totalCents: cents,
        });
      }
    }

    return Array.from(totals.values()).map((t) => ({
      memberId: t.memberId,
      name: memberMap.get(t.memberId)!.name,
      category: t.category,
      totalCents: t.totalCents,
    }));
  }
```

- [x] **Step 6: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `PASS`, all tests including the 6 new ones.

- [x] **Step 7: Add the controller endpoint**

In `money-split-backend/src/expenses/expenses.controller.ts`, add `PersonCategorySpending` to the type import block from Task 1.

Add this method directly after `getSpendingByPerson` (added in Task 1):

```typescript
  @Get('expenses/by-person-category')
  @ApiOperation({ summary: 'Get spending totals grouped by member and category (share amounts)' })
  @ApiResponse({ status: 200, description: 'Return spending totals per member and category.' })
  getSpendingByPersonCategory(
    @Param('groupId') groupId: string,
    @Req() req: Request,
    @Query('currency') currency?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PersonCategorySpending[]> {
    const userId = req.user!.id;
    return this.expensesService.getSpendingByPersonCategory(
      groupId,
      userId,
      currency,
      from,
      to,
    );
  }
```

- [x] **Step 8: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 9: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: same pass/fail counts as after Task 1, plus the 6 new `getSpendingByPersonCategory` tests passing.

- [x] **Step 10: Commit**

```bash
cd money-split-backend
git add src/expenses/types/expense-responses.type.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts
git commit -m "feat: add GET /groups/:groupId/expenses/by-person-category endpoint"
```

---

### Task 3: Backend — Top Expenses endpoint

**Files:**
- Modify: `money-split-backend/src/expenses/types/expense-responses.type.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`
- Test: `money-split-backend/src/expenses/expenses.service.spec.ts`

**Interfaces:**
- Produces: `ExpensesService.getTopExpenses(groupId: string, userId: string, currency?: string, from?: string, to?: string, limit?: number): Promise<TopExpenseItem[]>` (defaults `limit` to `5`) where `TopExpenseItem = { id: string; description: string; amount: number; currency: string; category: string; date: Date; payerNames: string[] }`. `GET /groups/:groupId/expenses/top?currency=&from=&to=&limit=` returns `TopExpenseItem[]` as JSON (`date` serializes to an ISO string over the wire), sorted by `amount` descending, capped at `limit` (controller clamps to a 1-20 range, default 5). Task 4/8 (frontend) consume this exact response shape.

- [x] **Step 1: Add the `TopExpenseItem` response type**

In `money-split-backend/src/expenses/types/expense-responses.type.ts`, add at the end of the file, after `PersonCategorySpending`:

```typescript
export interface TopExpenseItem {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: Date;
  payerNames: string[];
}
```

- [x] **Step 2: Add the `expense.findMany` mock**

`mockPrisma.expense` already has `groupBy`, `findUnique`, `update` (from earlier work in this file). Add `findMany`:

```typescript
    expense: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
```

- [x] **Step 3: Write the failing tests**

Add this new `describe` block directly after the `describe('getSpendingByPersonCategory', ...)` block added in Task 2 (before `describe('updateExpense (category preserve-on-omit)', ...)`):

```typescript
  describe('getTopExpenses', () => {
    const groupId = 'group-1';
    const userId = 'user-1';

    beforeEach(() => {
      mockPrisma.groupMember.findUnique.mockResolvedValue({
        id: 'member-1',
        groupId,
        userId,
        deletedAt: null,
      });
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getTopExpenses(groupId, userId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.expense.findMany).not.toHaveBeenCalled();
    });

    it('queries sorted descending by amount, defaulting limit to 5', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      await service.getTopExpenses(groupId, userId, 'USD');

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ groupId, deletedAt: null, currency: 'USD' }),
          orderBy: { amount: 'desc' },
          take: 5,
        }),
      );
    });

    it('respects an explicit limit', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      await service.getTopExpenses(groupId, userId, 'USD', undefined, undefined, 2);

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
    });

    it("falls back to the group's own currency when none is provided", async () => {
      mockPrisma.group.findUnique.mockResolvedValueOnce({ id: groupId, currency: 'VND' });
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      await service.getTopExpenses(groupId, userId);

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ currency: 'VND' }),
        }),
      );
    });

    it('builds a date range filter when from/to are provided', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      await service.getTopExpenses(groupId, userId, 'USD', '2026-01-01', '2026-01-31');

      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
          }),
        }),
      );
    });

    it('maps expense rows to TopExpenseItem including all payer names', async () => {
      const date = new Date('2026-02-01T00:00:00.000Z');
      mockPrisma.expense.findMany.mockResolvedValueOnce([
        {
          id: 'expense-1',
          description: 'Hotel',
          amount: 300,
          currency: 'USD',
          category: 'TRAVEL',
          date,
          payers: [
            { member: { name: 'Alice' } },
            { member: { name: 'Bob' } },
          ],
        },
      ]);

      const result = await service.getTopExpenses(groupId, userId, 'USD');

      expect(result).toEqual([
        {
          id: 'expense-1',
          description: 'Hotel',
          amount: 300,
          currency: 'USD',
          category: 'TRAVEL',
          date,
          payerNames: ['Alice', 'Bob'],
        },
      ]);
    });

    it('returns an empty array when there are no expenses in that currency', async () => {
      mockPrisma.expense.findMany.mockResolvedValueOnce([]);

      const result = await service.getTopExpenses(groupId, userId, 'USD');

      expect(result).toEqual([]);
    });
  });
```

- [x] **Step 4: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `FAIL` — `service.getTopExpenses is not a function`.

- [x] **Step 5: Implement `getTopExpenses`**

In `money-split-backend/src/expenses/expenses.service.ts`, add `TopExpenseItem` to the type import block.

Add this method directly after `getSpendingByPersonCategory` (added in Task 2):

```typescript
  async getTopExpenses(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
    limit = 5,
  ): Promise<TopExpenseItem[]> {
    await this.assertActiveMember(groupId, userId);

    let effectiveCurrency = currency;
    if (!effectiveCurrency) {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
      });
      effectiveCurrency = group?.currency || 'USD';
    }

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const expenses = await this.prisma.expense.findMany({
      where: {
        groupId,
        deletedAt: null,
        currency: effectiveCurrency,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      include: { payers: { include: { member: true } } },
      orderBy: { amount: 'desc' },
      take: limit,
    });

    return expenses.map((e) => ({
      id: e.id,
      description: e.description,
      amount: Number(e.amount),
      currency: e.currency,
      category: e.category,
      date: e.date,
      payerNames: e.payers.map((p) => p.member.name),
    }));
  }
```

- [x] **Step 6: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses.service --silent
```

Expected: `PASS`, all tests including the 7 new ones.

- [x] **Step 7: Add the controller endpoint**

In `money-split-backend/src/expenses/expenses.controller.ts`, add `TopExpenseItem` to the type import block.

Add this method directly after `getSpendingByPersonCategory` (added in Task 2), and note the class's `getSpendingByCategory` method is currently the last one before the closing `}` — this new method now becomes the last:

```typescript
  @Get('expenses/top')
  @ApiOperation({ summary: 'Get the largest individual expenses' })
  @ApiResponse({ status: 200, description: 'Return the top expenses by amount.' })
  getTopExpenses(
    @Param('groupId') groupId: string,
    @Req() req: Request,
    @Query('currency') currency?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<TopExpenseItem[]> {
    const userId = req.user!.id;
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20) : 5;
    return this.expensesService.getTopExpenses(
      groupId,
      userId,
      currency,
      from,
      to,
      parsedLimit,
    );
  }
```

- [x] **Step 8: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 9: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: same pass/fail counts as after Task 2, plus the 7 new `getTopExpenses` tests passing.

- [x] **Step 10: Commit**

```bash
cd money-split-backend
git add src/expenses/types/expense-responses.type.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts
git commit -m "feat: add GET /groups/:groupId/expenses/top endpoint"
```

---

### Task 4: Frontend — types, API endpoints, and Redux state/thunks

**Files:**
- Modify: `money-split-app/src/types/expense.types.ts`
- Modify: `money-split-app/src/constants/api.constants.ts`
- Modify: `money-split-app/src/store/slices/groupSlice.ts`

**Interfaces:**
- Consumes: `GET /groups/:groupId/expenses/by-person`, `.../by-person-category`, `.../top` (Tasks 1-3).
- Produces: `PersonSpending`, `PersonCategorySpending`, `TopExpenseItem` frontend types; `fetchSpendingByPerson({ groupId, currency, metric }): AsyncThunk`, `fetchSpendingByPersonCategory({ groupId, currency }): AsyncThunk`, `fetchTopExpenses({ groupId, currency, limit }): AsyncThunk`; `GroupState.spendingByPerson/spendingByPersonLoading/spendingByPersonError`, `.spendingByPersonCategory/spendingByPersonCategoryLoading/spendingByPersonCategoryError`, `.topExpenses/topExpensesLoading/topExpensesError`. Tasks 5-9 consume these exact names.

- [x] **Step 1: Add the three response types**

In `money-split-app/src/types/expense.types.ts`, add at the end of the file, after the existing `CategorySpending` interface:

```typescript
export interface PersonSpending {
    memberId: string;
    name: string;
    totalCents: number;
}

export interface PersonCategorySpending {
    memberId: string;
    name: string;
    category: ExpenseCategory;
    totalCents: number;
}

export interface TopExpenseItem {
    id: string;
    description: string;
    amount: number;
    currency: string;
    category: ExpenseCategory;
    date: string;
    payerNames: string[];
}
```

- [x] **Step 2: Add the three API endpoint builders**

In `money-split-app/src/constants/api.constants.ts`, add to the `GROUPS` object, directly after the existing `EXPENSES_BY_CATEGORY` entry:

```typescript
        EXPENSES_BY_PERSON: (id: string, currency?: string, metric?: 'paid' | 'share') => {
            const params = new URLSearchParams();
            if (currency) params.set('currency', currency);
            if (metric) params.set('metric', metric);
            const qs = params.toString();
            return `${API_BASE_URL}/groups/${id}/expenses/by-person${qs ? `?${qs}` : ''}`;
        },
        EXPENSES_BY_PERSON_CATEGORY: (id: string, currency?: string) =>
            `${API_BASE_URL}/groups/${id}/expenses/by-person-category${currency ? `?currency=${currency}` : ''}`,
        EXPENSES_TOP: (id: string, currency?: string, limit?: number) => {
            const params = new URLSearchParams();
            if (currency) params.set('currency', currency);
            if (limit) params.set('limit', String(limit));
            const qs = params.toString();
            return `${API_BASE_URL}/groups/${id}/expenses/top${qs ? `?${qs}` : ''}`;
        },
```

- [x] **Step 3: Add Redux state fields**

In `money-split-app/src/store/slices/groupSlice.ts`, extend the type import from `expense.types` (line 3, currently `CreateExpenseRequest, UpdateExpenseRequest, Expense, HistoryTransaction, PaginatedHistoryResponse, CategorySpending`):

```typescript
import type { CreateExpenseRequest, UpdateExpenseRequest, Expense, HistoryTransaction, PaginatedHistoryResponse, CategorySpending, PersonSpending, PersonCategorySpending, TopExpenseItem } from '../../types/expense.types';
```

Add to the `GroupState` interface, directly after `categorySpendingError: string | null;` (currently line 36):

```typescript
    spendingByPerson: PersonSpending[] | null;
    spendingByPersonLoading: boolean;
    spendingByPersonError: string | null;
    spendingByPersonCategory: PersonCategorySpending[] | null;
    spendingByPersonCategoryLoading: boolean;
    spendingByPersonCategoryError: string | null;
    topExpenses: TopExpenseItem[] | null;
    topExpensesLoading: boolean;
    topExpensesError: string | null;
```

Add to `initialState`, directly after `categorySpendingError: null,` (currently line 61):

```typescript
    spendingByPerson: null,
    spendingByPersonLoading: false,
    spendingByPersonError: null,
    spendingByPersonCategory: null,
    spendingByPersonCategoryLoading: false,
    spendingByPersonCategoryError: null,
    topExpenses: null,
    topExpensesLoading: false,
    topExpensesError: null,
```

- [x] **Step 4: Add the three thunks**

Add directly after the existing `fetchSpendingByCategory` thunk (currently lines 109-114):

```typescript
export const fetchSpendingByPerson = createAsyncThunk(
    'groups/fetchSpendingByPerson',
    async ({ groupId, currency, metric }: { groupId: string; currency?: string; metric?: 'paid' | 'share' }) => {
        return await api.get<PersonSpending[]>(API_ENDPOINTS.GROUPS.EXPENSES_BY_PERSON(groupId, currency, metric));
    }
);

export const fetchSpendingByPersonCategory = createAsyncThunk(
    'groups/fetchSpendingByPersonCategory',
    async ({ groupId, currency }: { groupId: string; currency?: string }) => {
        return await api.get<PersonCategorySpending[]>(API_ENDPOINTS.GROUPS.EXPENSES_BY_PERSON_CATEGORY(groupId, currency));
    }
);

export const fetchTopExpenses = createAsyncThunk(
    'groups/fetchTopExpenses',
    async ({ groupId, currency, limit }: { groupId: string; currency?: string; limit?: number }) => {
        return await api.get<TopExpenseItem[]>(API_ENDPOINTS.GROUPS.EXPENSES_TOP(groupId, currency, limit));
    }
);
```

- [x] **Step 5: Add the reducer cases**

Add directly after the existing `fetchSpendingByCategory` reducer cases (currently lines 518-532, ending with the `fetchSpendingByCategory.rejected` case):

```typescript
            // Fetch Spending By Person
            .addCase(fetchSpendingByPerson.pending, (state) => {
                state.spendingByPersonLoading = true;
                state.spendingByPersonError = null;
            })
            .addCase(fetchSpendingByPerson.fulfilled, (state, action) => {
                state.spendingByPersonLoading = false;
                state.spendingByPerson = action.payload;
                state.spendingByPersonError = null;
            })
            .addCase(fetchSpendingByPerson.rejected, (state, action) => {
                state.spendingByPersonLoading = false;
                state.spendingByPerson = null;
                state.spendingByPersonError = action.error.message || 'Failed to fetch spending by person';
            })
            // Fetch Spending By Person And Category
            .addCase(fetchSpendingByPersonCategory.pending, (state) => {
                state.spendingByPersonCategoryLoading = true;
                state.spendingByPersonCategoryError = null;
            })
            .addCase(fetchSpendingByPersonCategory.fulfilled, (state, action) => {
                state.spendingByPersonCategoryLoading = false;
                state.spendingByPersonCategory = action.payload;
                state.spendingByPersonCategoryError = null;
            })
            .addCase(fetchSpendingByPersonCategory.rejected, (state, action) => {
                state.spendingByPersonCategoryLoading = false;
                state.spendingByPersonCategory = null;
                state.spendingByPersonCategoryError = action.error.message || 'Failed to fetch category breakdown per person';
            })
            // Fetch Top Expenses
            .addCase(fetchTopExpenses.pending, (state) => {
                state.topExpensesLoading = true;
                state.topExpensesError = null;
            })
            .addCase(fetchTopExpenses.fulfilled, (state, action) => {
                state.topExpensesLoading = false;
                state.topExpenses = action.payload;
                state.topExpensesError = null;
            })
            .addCase(fetchTopExpenses.rejected, (state, action) => {
                state.topExpensesLoading = false;
                state.topExpenses = null;
                state.topExpensesError = action.error.message || 'Failed to fetch top expenses';
            })
```

- [x] **Step 6: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 7: Lint**

```bash
cd money-split-app && npx eslint src/types/expense.types.ts src/constants/api.constants.ts src/store/slices/groupSlice.ts
```

Expected: no new errors.

- [x] **Step 8: Commit**

```bash
cd money-split-app
git add src/types/expense.types.ts src/constants/api.constants.ts src/store/slices/groupSlice.ts
git commit -m "feat: add types, endpoints, and thunks for the three new analytics endpoints"
```

---

### Task 5: Frontend — member color palette and Spending by Person card

**Files:**
- Create: `money-split-app/src/lib/memberColors.ts`
- Create: `money-split-app/src/components/dashboard/SpendingByPersonCard.tsx`

**Interfaces:**
- Consumes: `PersonSpending` type, `spendingByPerson`/`spendingByPersonLoading`/`spendingByPersonError` state shape (Task 4).
- Produces: `getMemberColor(memberId: string): string` (Task 7's stacked-bar card intentionally does not use this — see Global Constraints). `SpendingByPersonCardProps = { data: PersonSpending[] | null; currency: string; metric: 'paid' | 'share'; onMetricChange: (metric: 'paid' | 'share') => void; isLoading: boolean; error?: string | null }`. Task 9 renders `<SpendingByPersonCard>` with these exact props.

- [x] **Step 1: Create the member color palette**

Create `money-split-app/src/lib/memberColors.ts`:

```typescript
// Distinct, colorblind-tolerant hues for person-keyed charts (currently only
// the Spending by Person donut). Deliberately separate from CATEGORY_COLORS
// in expenseCategories.ts — that palette is for category-keyed charts and
// this one is for member-keyed charts; the two never need to agree with
// each other.
const MEMBER_COLOR_PALETTE = [
    '#f97316', '#3b82f6', '#8b5cf6', '#eab308', '#ec4899',
    '#14b8a6', '#06b6d4', '#ef4444', '#64748b', '#a855f7',
    '#0ea5e9', '#84cc16',
];

// Deterministic per memberId (a stable UUID), so the same member always
// gets the same color across page loads with no server-side storage. Two
// members can collide onto the same color in a large group — an accepted
// cosmetic limitation of a small fixed palette, same tradeoff CATEGORY_COLORS
// already accepts.
export function getMemberColor(memberId: string): string {
    let hash = 0;
    for (let i = 0; i < memberId.length; i++) {
        hash = (hash * 31 + memberId.charCodeAt(i)) | 0;
    }
    return MEMBER_COLOR_PALETTE[Math.abs(hash) % MEMBER_COLOR_PALETTE.length];
}
```

- [x] **Step 2: Create the Spending by Person card**

Create `money-split-app/src/components/dashboard/SpendingByPersonCard.tsx`:

```typescript
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { SummaryCard } from './SummaryCard';
import { formatAmount } from '../../lib/currency';
import { getMemberColor } from '../../lib/memberColors';
import type { PersonSpending } from '../../types/expense.types';

interface SpendingByPersonCardProps {
    data: PersonSpending[] | null;
    currency: string;
    metric: 'paid' | 'share';
    onMetricChange: (metric: 'paid' | 'share') => void;
    isLoading: boolean;
    error?: string | null;
}

export function SpendingByPersonCard({ data, currency, metric, onMetricChange, isLoading, error }: SpendingByPersonCardProps) {
    const chartData = (data ?? []).filter((d) => d.totalCents > 0);
    const total = chartData.reduce((sum, d) => sum + d.totalCents, 0);

    return (
        <SummaryCard title="Spending by Person">
            <div className="flex gap-1 mb-4 bg-secondary/50 rounded-full p-1 w-fit">
                <button
                    type="button"
                    onClick={() => onMetricChange('paid')}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${metric === 'paid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                    Paid
                </button>
                <button
                    type="button"
                    onClick={() => onMetricChange('share')}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${metric === 'share' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                    Share
                </button>
            </div>
            {isLoading ? (
                <div className="h-48 rounded-xl bg-muted animate-pulse" />
            ) : error ? (
                <p className="text-sm text-destructive py-8 text-center">Couldn't load spending by person</p>
            ) : chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No expenses yet this period</p>
            ) : (
                <div className="space-y-4">
                    <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                            <Pie
                                data={chartData}
                                dataKey="totalCents"
                                nameKey="name"
                                innerRadius={50}
                                outerRadius={80}
                                paddingAngle={2}
                            >
                                {chartData.map((d) => (
                                    <Cell key={d.memberId} fill={getMemberColor(d.memberId)} />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(value, name) => [
                                    formatAmount((value as number) / 100, currency),
                                    name,
                                ]}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-2">
                        {chartData.map((d) => {
                            const pct = total > 0 ? Math.round((d.totalCents / total) * 100) : 0;
                            return (
                                <div key={d.memberId} className="flex items-center gap-2 text-xs">
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: getMemberColor(d.memberId) }}
                                    />
                                    <span className="flex-1 truncate">{d.name}</span>
                                    <span className="font-bold tabular-nums">{formatAmount(d.totalCents / 100, currency)}</span>
                                    <span className="text-muted-foreground tabular-nums">{pct}%</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </SummaryCard>
    );
}
```

- [x] **Step 3: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 4: Lint**

```bash
cd money-split-app && npx eslint src/lib/memberColors.ts src/components/dashboard/SpendingByPersonCard.tsx
```

Expected: no new errors.

- [x] **Step 5: Commit**

```bash
cd money-split-app
git add src/lib/memberColors.ts src/components/dashboard/SpendingByPersonCard.tsx
git commit -m "feat: add member color palette and Spending by Person card"
```

---

### Task 6: Frontend — Category breakdown per person card

**Files:**
- Create: `money-split-app/src/components/dashboard/CategoryByPersonCard.tsx`

**Interfaces:**
- Consumes: `PersonCategorySpending` type, `spendingByPersonCategory`/`spendingByPersonCategoryLoading`/`spendingByPersonCategoryError` state shape (Task 4); `CATEGORY_ORDER`, `CATEGORY_LABELS`, `CATEGORY_ICONS`, `CATEGORY_COLORS` from `money-split-app/src/lib/expenseCategories.ts` (existing, unchanged).
- Produces: `CategoryByPersonCardProps = { data: PersonCategorySpending[] | null; currency: string; isLoading: boolean; error?: string | null }`. Task 9 renders `<CategoryByPersonCard>` with these exact props.

- [x] **Step 1: Create the card**

Create `money-split-app/src/components/dashboard/CategoryByPersonCard.tsx`:

```typescript
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { SummaryCard } from './SummaryCard';
import { formatAmount } from '../../lib/currency';
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_COLORS } from '../../lib/expenseCategories';
import type { PersonCategorySpending, ExpenseCategory } from '../../types/expense.types';

interface CategoryByPersonCardProps {
    data: PersonCategorySpending[] | null;
    currency: string;
    isLoading: boolean;
    error?: string | null;
}

interface PersonBarDatum {
    memberId: string;
    name: string;
    [category: string]: string | number;
}

function pivotByMember(data: PersonCategorySpending[]): PersonBarDatum[] {
    const byMember = new Map<string, PersonBarDatum>();
    for (const row of data) {
        let entry = byMember.get(row.memberId);
        if (!entry) {
            entry = { memberId: row.memberId, name: row.name };
            CATEGORY_ORDER.forEach((c) => { entry![c] = 0; });
            byMember.set(row.memberId, entry);
        }
        entry[row.category] = row.totalCents / 100;
    }
    return Array.from(byMember.values());
}

export function CategoryByPersonCard({ data, currency, isLoading, error }: CategoryByPersonCardProps) {
    const chartData = pivotByMember(data ?? []);

    return (
        <SummaryCard title="Category Breakdown per Person">
            {isLoading ? (
                <div className="h-56 rounded-xl bg-muted animate-pulse" />
            ) : error ? (
                <p className="text-sm text-destructive py-8 text-center">Couldn't load category breakdown</p>
            ) : chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No expenses yet this period</p>
            ) : (
                <div className="space-y-4">
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={chartData}>
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip
                                formatter={(value, name) => [
                                    formatAmount(value as number, currency),
                                    CATEGORY_LABELS[name as ExpenseCategory],
                                ]}
                            />
                            {CATEGORY_ORDER.map((category) => (
                                <Bar key={category} dataKey={category} stackId="a" fill={CATEGORY_COLORS[category]} />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-2">
                        {CATEGORY_ORDER.map((category) => {
                            const Icon = CATEGORY_ICONS[category];
                            return (
                                <div key={category} className="flex items-center gap-2 text-xs">
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: CATEGORY_COLORS[category] }}
                                    />
                                    <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="flex-1 truncate">{CATEGORY_LABELS[category]}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </SummaryCard>
    );
}
```

- [x] **Step 2: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 3: Lint**

```bash
cd money-split-app && npx eslint src/components/dashboard/CategoryByPersonCard.tsx
```

Expected: no new errors.

- [x] **Step 4: Commit**

```bash
cd money-split-app
git add src/components/dashboard/CategoryByPersonCard.tsx
git commit -m "feat: add Category breakdown per person stacked bar card"
```

---

### Task 7: Frontend — Top Expenses card

**Files:**
- Create: `money-split-app/src/components/dashboard/TopExpensesCard.tsx`

**Interfaces:**
- Consumes: `TopExpenseItem` type, `topExpenses`/`topExpensesLoading`/`topExpensesError` state shape (Task 4); `CATEGORY_ICONS` from `expenseCategories.ts`.
- Produces: `TopExpensesCardProps = { data: TopExpenseItem[] | null; currency: string; isLoading: boolean; error?: string | null; onSelect: (expenseId: string) => void }`. Task 9 renders `<TopExpensesCard>` with these exact props and supplies `onSelect` to open the edit modal.

- [x] **Step 1: Create the card**

Create `money-split-app/src/components/dashboard/TopExpensesCard.tsx`:

```typescript
import { SummaryCard } from './SummaryCard';
import { formatAmount } from '../../lib/currency';
import { CATEGORY_ICONS } from '../../lib/expenseCategories';
import type { TopExpenseItem } from '../../types/expense.types';

interface TopExpensesCardProps {
    data: TopExpenseItem[] | null;
    currency: string;
    isLoading: boolean;
    error?: string | null;
    onSelect: (expenseId: string) => void;
}

export function TopExpensesCard({ data, currency, isLoading, error, onSelect }: TopExpensesCardProps) {
    return (
        <SummaryCard title="Top Expenses">
            {isLoading ? (
                <div className="h-48 rounded-xl bg-muted animate-pulse" />
            ) : error ? (
                <p className="text-sm text-destructive py-8 text-center">Couldn't load top expenses</p>
            ) : !data || data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No expenses yet</p>
            ) : (
                <div>
                    {data.map((item, idx) => {
                        const Icon = CATEGORY_ICONS[item.category];
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelect(item.id)}
                                className="w-full flex items-center gap-3 py-2.5 border-b border-border last:border-b-0 text-left hover:bg-secondary/40 transition-colors rounded-lg px-1 -mx-1"
                            >
                                <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{idx + 1}</span>
                                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold truncate">{item.description}</p>
                                    <p className="text-xs text-muted-foreground truncate">{item.payerNames.join(', ')}</p>
                                </div>
                                <span className="text-sm font-bold tabular-nums shrink-0">{formatAmount(item.amount, currency)}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </SummaryCard>
    );
}
```

- [x] **Step 2: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 3: Lint**

```bash
cd money-split-app && npx eslint src/components/dashboard/TopExpensesCard.tsx
```

Expected: no new errors.

- [x] **Step 4: Commit**

```bash
cd money-split-app
git add src/components/dashboard/TopExpensesCard.tsx
git commit -m "feat: add Top Expenses ranked list card"
```

---

### Task 8: Frontend — GroupAnalytics page component

**Files:**
- Create: `money-split-app/src/components/GroupAnalytics.tsx`

**Interfaces:**
- Consumes: `SpendingByCategoryCard` (existing, `money-split-app/src/components/dashboard/SpendingByCategoryCard.tsx`, unchanged), `SpendingByPersonCard` (Task 5), `CategoryByPersonCard` (Task 6), `TopExpensesCard` (Task 7), `fetchSpendingByCategory`/`fetchSpendingByPerson`/`fetchSpendingByPersonCategory`/`fetchTopExpenses` thunks and their state (Task 4), `EditExpenseModal` (existing, `money-split-app/src/components/group-detail/EditExpenseModal.tsx`, unchanged), `useGroup()` (existing, `money-split-app/src/context/GroupContext.tsx` — `expenses`, `currency`, `groupName`, `activeGroupId`, `switchGroup`, `updateExpense`).
- Produces: `GroupAnalytics` component (named export), the render target Task 9 wires into `App.tsx`'s `/group/:id/analytics` route. Not reachable from the UI until Task 9 registers the route — this task only creates the component in isolation, the same way Tasks 5-7 created cards before anything rendered them.

- [x] **Step 1: Create the page component**

Create `money-split-app/src/components/GroupAnalytics.tsx`:

```typescript
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useGroupEvents } from '../hooks/useGroupEvents';
import { useGroup } from '../context/GroupContext';
import { SpendingByCategoryCard } from './dashboard/SpendingByCategoryCard';
import { SpendingByPersonCard } from './dashboard/SpendingByPersonCard';
import { CategoryByPersonCard } from './dashboard/CategoryByPersonCard';
import { TopExpensesCard } from './dashboard/TopExpensesCard';
import { EditExpenseModal } from './group-detail/EditExpenseModal';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchSpendingByCategory, fetchSpendingByPerson, fetchSpendingByPersonCategory, fetchTopExpenses } from '../store/slices/groupSlice';
import { SplitType, type Expense, type Split } from '../types/expense.types';

export function GroupAnalytics() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    useGroupEvents(id ?? '');
    const { expenses, currency, groupName, activeGroupId, switchGroup, updateExpense } = useGroup();
    const dispatch = useAppDispatch();

    // Sync active group with URL, same as Dashboard.tsx.
    useEffect(() => {
        if (id && id !== activeGroupId) {
            switchGroup(id);
        }
    }, [id, activeGroupId, switchGroup]);

    const categorySpending = useAppSelector(state => state.groups.categorySpending);
    const categorySpendingLoading = useAppSelector(state => state.groups.categorySpendingLoading);
    const categorySpendingError = useAppSelector(state => state.groups.categorySpendingError);
    const spendingByPerson = useAppSelector(state => state.groups.spendingByPerson);
    const spendingByPersonLoading = useAppSelector(state => state.groups.spendingByPersonLoading);
    const spendingByPersonError = useAppSelector(state => state.groups.spendingByPersonError);
    const spendingByPersonCategory = useAppSelector(state => state.groups.spendingByPersonCategory);
    const spendingByPersonCategoryLoading = useAppSelector(state => state.groups.spendingByPersonCategoryLoading);
    const spendingByPersonCategoryError = useAppSelector(state => state.groups.spendingByPersonCategoryError);
    const topExpenses = useAppSelector(state => state.groups.topExpenses);
    const topExpensesLoading = useAppSelector(state => state.groups.topExpensesLoading);
    const topExpensesError = useAppSelector(state => state.groups.topExpensesError);

    const [personMetric, setPersonMetric] = useState<'paid' | 'share'>('paid');

    // Fetch all four analytics datasets on mount and whenever id/currency
    // change. This is a dedicated route, not a tab reveal inside an
    // already-mounted page, so there is no first-reveal gating to build —
    // navigating here is the reveal.
    useEffect(() => {
        if (!id) return;
        void dispatch(fetchSpendingByCategory({ groupId: id, currency }));
        void dispatch(fetchSpendingByPerson({ groupId: id, currency, metric: personMetric }));
        void dispatch(fetchSpendingByPersonCategory({ groupId: id, currency }));
        void dispatch(fetchTopExpenses({ groupId: id, currency, limit: 5 }));
        // personMetric is deliberately excluded — metric changes are handled
        // by handleMetricChange below, which dispatches only the one
        // affected thunk instead of refetching all four cards.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, currency, dispatch]);

    const handleMetricChange = useCallback((metric: 'paid' | 'share') => {
        setPersonMetric(metric);
        if (id) {
            void dispatch(fetchSpendingByPerson({ groupId: id, currency, metric }));
        }
    }, [id, currency, dispatch]);

    const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
    const [isUpdatingExpense, setIsUpdatingExpense] = useState(false);

    const expenseToEdit = useMemo(() => {
        if (!editingExpenseId) return undefined;
        return expenses.find(e => e.id === editingExpenseId);
    }, [expenses, editingExpenseId]);

    const initialFormData = useMemo(() => {
        if (!expenseToEdit) return undefined;

        const payers = expenseToEdit.payers ?? [];
        const splitType = expenseToEdit.splitType ?? SplitType.EVEN;
        const splits: Split[] = expenseToEdit.splits ?? [];

        return {
            description: expenseToEdit.description,
            amount: expenseToEdit.amount,
            currency: expenseToEdit.currency || currency,
            payerId: payers.length > 0 ? payers[0].memberId : undefined,
            payers,
            splitType,
            category: expenseToEdit.category,
            splits,
            manualAmounts: splitType === SplitType.EXACT
                ? splits.reduce<Record<string, string>>((acc, s) => ({ ...acc, [s.memberId]: (s.amount ?? 0).toString() }), {})
                : {}
        };
    }, [expenseToEdit, currency]);

    const handleUpdateExpense = async (data: Omit<Expense, 'id' | 'createdAt'>) => {
        if (editingExpenseId && !isUpdatingExpense) {
            setIsUpdatingExpense(true);
            try {
                await updateExpense(editingExpenseId, data);
                setEditingExpenseId(null);
            } finally {
                setIsUpdatingExpense(false);
            }
        }
    };

    return (
        <div className="space-y-8 pb-12">
            {/* Header — mirrors GroupDetail.tsx's sticky back-button header */}
            <div className="bg-card/50 backdrop-blur-sm sticky top-0 z-30 -mx-4 px-4 py-4 border-b border-border/50 flex items-center gap-3">
                <button
                    onClick={() => navigate(-1)}
                    className="p-2 hover:bg-secondary rounded-full transition-colors active:scale-95"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                    <h1 className="text-2xl font-black tracking-tight">Analytics</h1>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{groupName}</p>
                </div>
            </div>

            <div className="space-y-6">
                <SpendingByCategoryCard data={categorySpending} currency={currency} isLoading={categorySpendingLoading} error={categorySpendingError} />
                <SpendingByPersonCard
                    data={spendingByPerson}
                    currency={currency}
                    metric={personMetric}
                    onMetricChange={handleMetricChange}
                    isLoading={spendingByPersonLoading}
                    error={spendingByPersonError}
                />
                <CategoryByPersonCard data={spendingByPersonCategory} currency={currency} isLoading={spendingByPersonCategoryLoading} error={spendingByPersonCategoryError} />
                <TopExpensesCard
                    data={topExpenses}
                    currency={currency}
                    isLoading={topExpensesLoading}
                    error={topExpensesError}
                    onSelect={setEditingExpenseId}
                />
            </div>

            <EditExpenseModal
                isOpen={!!editingExpenseId && !!initialFormData}
                initialData={initialFormData}
                onClose={() => { setEditingExpenseId(null); }}
                onSubmit={handleUpdateExpense}
                isSubmitting={isUpdatingExpense}
            />
        </div>
    );
}
```

- [x] **Step 2: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors. If `useGroup()`'s destructured `updateExpense` or `expenses` types don't line up exactly with `EditExpenseModal`'s `initialData`/`onSubmit` shape, compare directly against how `money-split-app/src/components/GroupDetail.tsx` (lines 286-325 and 447-453) already does the same derivation — the field names and types must match exactly since both components consume the same `useGroup()` context and the same `EditExpenseModal`.

- [x] **Step 3: Lint**

```bash
cd money-split-app && npx eslint src/components/GroupAnalytics.tsx
```

Expected: no new errors (the `eslint-disable-next-line react-hooks/exhaustive-deps` comment is intentional — the mount effect must not depend on `personMetric` or it would refetch all four cards on every metric change in addition to the dedicated `handleMetricChange` fetch).

- [x] **Step 4: Commit**

```bash
cd money-split-app
git add src/components/GroupAnalytics.tsx
git commit -m "feat: add GroupAnalytics page with Spending by Category, Spending by Person, Category by Person, and Top Expenses"
```

---

### Task 9: Frontend — wire the `/group/:id/analytics` route and sidebar nav, remove the chart from Dashboard.tsx

> **Superseded by Tasks 11-14.** This task was implemented and committed exactly as written below (commit `46686c5`) and is kept here as an accurate record of what happened. Live browser testing afterward found the route/sidebar placement it built has a mobile gap and unwanted sidebar UX — Tasks 11-14 below undo the `App.tsx` route and `Layout.tsx` sidebar-section parts of this task (Steps 1-2) and replace them with in-page tabs on `GroupDetail.tsx`. Step 3 of this task (removing `SpendingByCategoryCard` from `Dashboard.tsx`) is untouched by that follow-up and stays as committed.

**Files:**
- Modify: `money-split-app/src/App.tsx`
- Modify: `money-split-app/src/components/Layout.tsx`
- Modify: `money-split-app/src/components/Dashboard.tsx`

**Interfaces:**
- Consumes: `GroupAnalytics` (Task 8).
- Produces: the `/group/:id/analytics` route; a new "Analytics" sidebar nav button in `Layout.tsx`'s "Current group" section; `Dashboard.tsx` reverted to zero charts (no `SpendingByCategoryCard`, no `categorySpending` state, no fetch effect).

- [x] **Step 1: Register the route in `App.tsx`**

In `money-split-app/src/App.tsx`, add the lazy import directly after the existing `MemberManager` lazy import (currently line 22):

```typescript
const GroupAnalytics = lazy(() => import('./components/GroupAnalytics').then(m => ({ default: m.GroupAnalytics })));
```

Add the route directly after the existing `/group/:id/members` route (currently line 60):

```typescript
<Route path="/group/:id/analytics" element={<GroupAnalytics />} />
```

- [x] **Step 2: Add the sidebar nav entry in `Layout.tsx`**

In `money-split-app/src/components/Layout.tsx`, add `BarChart3` to the existing `lucide-react` import (currently line 2, `Users, PlusCircle, LogIn, LogOut, Home, ChevronLeft`):

```typescript
import { Users, PlusCircle, LogIn, LogOut, Home, ChevronLeft, BarChart3 } from 'lucide-react';
```

Add a new button directly after the existing "Manage members" button (currently lines 147-153), inside the same `activeGroupId &&` block:

```typescript
                            <button
                                onClick={() => { void navigate(`/group/${activeGroupId}/members`); }}
                                className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors", location.pathname.includes('/members') ? "bg-primary/10 text-primary" : "hover:bg-secondary")}
                            >
                                <Users className="w-5 h-5" />
                                <span className="font-medium">Manage members</span>
                            </button>

                            <button
                                onClick={() => { void navigate(`/group/${activeGroupId}/analytics`); }}
                                className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors", location.pathname.includes('/analytics') ? "bg-primary/10 text-primary" : "hover:bg-secondary")}
                            >
                                <BarChart3 className="w-5 h-5" />
                                <span className="font-medium">Analytics</span>
                            </button>
```

(The first button is unchanged — shown only so the new button's placement directly after it is unambiguous.)

- [x] **Step 3: Remove the `SpendingByCategoryCard` wiring from `Dashboard.tsx`**

In `money-split-app/src/components/Dashboard.tsx`, remove the `SpendingByCategoryCard` import (currently line 8: `import { SpendingByCategoryCard } from './dashboard/SpendingByCategoryCard';`).

Change the store-hooks import (currently line 13) from:

```typescript
import { useAppDispatch, useAppSelector } from '../store/hooks';
```

to:

```typescript
import { useAppSelector } from '../store/hooks';
```

(`useAppDispatch`/`dispatch` become unused once the fetch effect below is removed — nothing else in `Dashboard.tsx` dispatches an action.)

Remove the `fetchSpendingByCategory` import entirely (currently line 14: `import { fetchSpendingByCategory } from '../store/slices/groupSlice';`).

Remove the `dispatch` declaration, the three `categorySpending`/`categorySpendingLoading`/`categorySpendingError` selectors, and the fetch effect (currently lines 47-58):

```typescript
    const dispatch = useAppDispatch();
    const categorySpending = useAppSelector(state => state.groups.categorySpending);
    const categorySpendingLoading = useAppSelector(state => state.groups.categorySpendingLoading);
    const categorySpendingError = useAppSelector(state => state.groups.categorySpendingError);

    useEffect(() => {
        if (id) {
            void dispatch(fetchSpendingByCategory({ groupId: id, currency }));
        }
        // currency is included so switching the group's currency triggers a
        // refetch instead of relabeling stale totals with the new symbol.
    }, [id, currency, dispatch]);
```

Remove the card's render block at the end of the JSX (currently lines 120-121):

```typescript
            {/* Spending by Category */}
            <SpendingByCategoryCard data={categorySpending} currency={currency} isLoading={categorySpendingLoading} error={categorySpendingError} />
```

After these four removals, `Dashboard.tsx` is byte-for-byte the same file it was before this whole feature started — Overview content (summary cards, group details card, quick stats) with no chart of any kind.

- [x] **Step 4: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [x] **Step 5: Lint**

```bash
cd money-split-app && npx eslint src/App.tsx src/components/Layout.tsx src/components/Dashboard.tsx
```

Expected: no new errors.

- [x] **Step 6: Manual verification via live preview**

Start the app (`preview_start` per this session's established pattern — see `money-split-app/.claude/launch.json` and root `.claude/launch.json`), sign in, and navigate to a group with expenses in multiple categories, paid/split across at least two members. Confirm:
- The Dashboard (`/group/:id`) shows no charts — summary cards, group details card, and quick stats only, exactly as before this feature.
- The sidebar's "Current group" section shows "Analytics" directly after "Manage members", using the bar-chart icon.
- Clicking "Analytics" navigates to `/group/:id/analytics` and renders, in order: Spending by Category, Spending by Person, Category breakdown per person, Top Expenses.
- The "Analytics" sidebar item is highlighted active while on `/group/:id/analytics`; "Manage members" is not, and vice versa.
- Toggling "Paid"/"Share" on Spending by Person changes the donut and legend, including the percentage column.
- The stacked bar chart's segment colors match the category donut's colors for the same category.
- Top Expenses shows at most 5 rows sorted largest-first; clicking a row opens the edit-expense modal pre-filled with that expense's data, and saving a change updates the row after the modal closes.
- Refreshing directly on `/group/:id/analytics` (deep link) still renders all four cards correctly.
- A group with no expenses in a category/among a subset of members shows each card's empty state, not a broken chart.
- Check both light and dark mode, and a 375px viewport.

- [x] **Step 7: Commit**

```bash
cd money-split-app
git add src/App.tsx src/components/Layout.tsx src/components/Dashboard.tsx
git commit -m "feat: wire /group/:id/analytics route and sidebar nav entry, remove chart from Dashboard"
```

---

### Task 11: Frontend — build the `GroupDetailTabs` pill switcher component

**Files:**
- Create: `money-split-app/src/components/group-detail/GroupDetailTabs.tsx`

**Interfaces:**
- Produces: `type GroupDetailTab = 'overview' | 'members' | 'analytics'`; `GroupDetailTabs({ activeTab: GroupDetailTab; onTabChange: (tab: GroupDetailTab) => void })`. Task 13 renders `<GroupDetailTabs>` in `GroupDetail.tsx` with `activeTab`/`setActiveTab`.

- [ ] **Step 1: Create the tab switcher**

Create `money-split-app/src/components/group-detail/GroupDetailTabs.tsx`. Visual pattern mirrors `SpendingByPersonCard.tsx`'s Paid/Share pill toggle (`bg-secondary/50 rounded-full p-1` wrapper, `bg-primary text-primary-foreground` active pill, `text-muted-foreground` inactive) — not the pre-existing but unused `group-detail/SectionTabs.tsx` (a different, dead 2-tab component from unrelated earlier work with a `bg-card shadow-sm` active style; confirmed via `grep -rn "SectionTabs" src` that nothing imports it):

```typescript
import { LayoutDashboard, Users, BarChart3 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type GroupDetailTab = 'overview' | 'members' | 'analytics';

interface GroupDetailTabsProps {
    activeTab: GroupDetailTab;
    onTabChange: (tab: GroupDetailTab) => void;
}

const TABS: { id: GroupDetailTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

export function GroupDetailTabs({ activeTab, onTabChange }: GroupDetailTabsProps) {
    return (
        <div className="flex gap-1 bg-secondary/50 rounded-full p-1 w-fit">
            {TABS.map(({ id, label, icon: Icon }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => { onTabChange(id); }}
                    className={cn(
                        "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-colors",
                        activeTab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                </button>
            ))}
        </div>
    );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Lint**

```bash
cd money-split-app && npx eslint src/components/group-detail/GroupDetailTabs.tsx
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd money-split-app
git add src/components/group-detail/GroupDetailTabs.tsx
git commit -m "feat: add GroupDetailTabs pill switcher for Overview/Members/Analytics"
```

---

### Task 12: Frontend — strip `GroupAnalytics.tsx`'s page chrome, convert it to an embeddable tab panel

**Files:**
- Modify: `money-split-app/src/components/GroupAnalytics.tsx`

**Interfaces:**
- Changes: `GroupAnalytics` no longer reads `id` from `useParams()` — it now takes `{ groupId: string }` as its only prop. It no longer calls `useGroupEvents()` or `switchGroup` itself (both become the embedding parent's responsibility — see Task 13). Its four-card render, its `personMetric` state, its `fetchSpendingByCategory`/`fetchSpendingByPerson`/`fetchSpendingByPersonCategory`/`fetchTopExpenses` dispatches, and its own `editingExpenseId`/`EditExpenseModal` wiring for Top Expenses are otherwise unchanged.
- Consumes: unchanged (`SpendingByCategoryCard`, `SpendingByPersonCard`, `CategoryByPersonCard`, `TopExpensesCard`, `EditExpenseModal`, the four Redux thunks, `useGroup()` — now only for `expenses`, `currency`, `updateExpense`).
- Produces: the panel Task 13 renders as `<GroupAnalytics groupId={routeId ?? ''} />` inside `GroupDetail.tsx`'s Analytics tab conditional.

**Why:** the component was a standalone routed page with its own sticky header (back button + "Analytics" title + group name) and its own active-group sync effect. Once it's a tab panel inside an already-mounted `GroupDetail.tsx`, that chrome duplicates the page's real header, and the sync effect duplicates work `GroupDetail.tsx` already does: `GroupDetail.tsx`'s existing mount effect calls `fetchGroupById(routeId)`, whose `fulfilled` reducer already sets Redux `state.groups.activeId` to match the route (`money-split-app/src/store/slices/groupSlice.ts:418`) — so a second `switchGroup` call from the embedded panel is redundant. Likewise `GroupDetail.tsx` already calls `useGroupEvents(routeId ?? '')` once for the whole page; calling it a second time from the embedded panel would register duplicate socket listeners for the same group (confirmed by reading `money-split-app/src/hooks/useGroupEvents.ts`: each call subscribes fresh handlers with no dedup).

- [ ] **Step 1: Remove the page-chrome imports and the header JSX**

In `money-split-app/src/components/GroupAnalytics.tsx`, remove these two import lines:

```typescript
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
```

and remove:

```typescript
import { useGroupEvents } from '../hooks/useGroupEvents';
```

Remove the header block from the JSX (currently the `<div className="bg-card/50 backdrop-blur-sm sticky top-0 ...">...</div>` block containing the back button, "Analytics" title, and group name), and change the outer wrapper `<div className="space-y-8 pb-12">` to `<div className="space-y-6">` (the page-level `pb-12`/`space-y-8` spacing was for standalone-page layout; `space-y-6` matches what the inner cards div already used).

- [ ] **Step 2: Switch from `useParams()` to a `groupId` prop**

Change the function signature from:

```typescript
export function GroupAnalytics() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    useGroupEvents(id ?? '');
    const { expenses, currency, groupName, activeGroupId, switchGroup, updateExpense } = useGroup();
    const dispatch = useAppDispatch();

    // Sync active group with URL, same as Dashboard.tsx.
    useEffect(() => {
        if (id && id !== activeGroupId) {
            switchGroup(id);
        }
    }, [id, activeGroupId, switchGroup]);
```

to:

```typescript
interface GroupAnalyticsProps {
    groupId: string;
}

export function GroupAnalytics({ groupId }: GroupAnalyticsProps) {
    const { expenses, currency, updateExpense } = useGroup();
    const dispatch = useAppDispatch();
```

Replace every remaining use of `id` in the file with `groupId`: the mount effect's `if (!id) return;` and the four `dispatch(...)` calls inside it, and `handleMetricChange`'s `if (id) { ... }` body — all become `groupId`/`if (!groupId) return;`/`if (groupId) { ... }` respectively. `groupName` is dropped from the `useGroup()` destructure (it was only used in the removed header).

- [ ] **Step 3: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors. `GroupAnalytics.tsx` will show an error until Task 13 updates its one call site in `GroupDetail.tsx` — that's expected mid-task; both must land together before the final typecheck in Task 13 passes clean.

- [ ] **Step 4: Lint**

```bash
cd money-split-app && npx eslint src/components/GroupAnalytics.tsx
```

Expected: no new errors (once Task 13's call site exists — lint doesn't fail on missing callers, only `tsc` might complain about an unused-export edge case, which does not apply here since `GroupAnalytics` stays a named export).

- [ ] **Step 5: Commit**

```bash
cd money-split-app
git add src/components/GroupAnalytics.tsx
git commit -m "refactor: strip GroupAnalytics page chrome, take groupId prop for tab-panel embedding"
```

---

### Task 13: Frontend — restructure `GroupDetail.tsx` into Overview/Members/Analytics tabs

**Files:**
- Modify: `money-split-app/src/components/GroupDetail.tsx`

**Interfaces:**
- Consumes: `GroupDetailTabs`/`GroupDetailTab` (Task 11), `GroupAnalytics` (Task 12, now `{ groupId: string }`-based), `MemberManager` (existing, unchanged — self-contained via `useGroup()`, no props, no page chrome to strip: confirmed by reading `money-split-app/src/components/MemberManager.tsx` in full, it's the "Add people" card + "Group members" list + "Danger zone" card, nothing else).
- Produces: `GroupDetail.tsx` renders three tab panels behind local `activeTab` state, defaulting to `'overview'`. No URL/query-param deep-linking.

- [ ] **Step 1: Add imports and tab state**

In `money-split-app/src/components/GroupDetail.tsx`, add after the existing import block (after the `InvitationBox` import, currently line 14):

```typescript
import { GroupDetailTabs, type GroupDetailTab } from './group-detail/GroupDetailTabs';
import { MemberManager } from './MemberManager';
import { GroupAnalytics } from './GroupAnalytics';
```

Add tab state directly after the existing `const [isAddingExpense, setIsAddingExpense] = useState(false);` (currently line 61):

```typescript
    const [activeTab, setActiveTab] = useState<GroupDetailTab>('overview');
```

- [ ] **Step 2: Repoint the header's "Manage members" button**

The header's existing "Manage members" button (currently lines 351-357) navigates to a route that no longer exists after Task 14. Change:

```typescript
                    <button
                        onClick={() => { void navigate(`/group/${routeId}/members`); }}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border hover:bg-secondary rounded-xl transition-colors"
                    >
                        <Users className="w-3.5 h-3.5" />
                        Manage members
                    </button>
```

to:

```typescript
                    <button
                        onClick={() => { setActiveTab('members'); }}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground border border-border hover:bg-secondary rounded-xl transition-colors"
                    >
                        <Users className="w-3.5 h-3.5" />
                        Manage members
                    </button>
```

- [ ] **Step 3: Insert the tab switcher below the header**

Directly after the header's closing `</div>` (currently line 378, right before the `{/* Action error alerts */}` comment), add:

```typescript
            <GroupDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />
```

- [ ] **Step 4: Wrap the existing Overview content in a tab conditional**

The settlement-plan-list, balance-cards, member-balances, and history sections (currently the four blocks between the "Action error alerts" block and the `{/* Edit Modal */}` comment, i.e. currently lines 394-444: the `<SettlementPlanList .../>` block, the owed/owing `BalanceCard` row, the "Group balances" `MemberBalancesList` block, and the "Payment history" `HistoryList` block) get wrapped in one `activeTab === 'overview' && (...)` block. The action error alerts, and everything from `{/* Edit Modal */}` onward (`EditExpenseModal`, `SettleUpModal`, `SettleAllModal`, `isAddingExpense && <AddExpense .../>`), stay exactly where they are, outside any tab conditional — they're driven by state set from Overview-tab interactions and are already correctly gated by their own `!!editingExpenseId`/`settlingPayment`/`settlingAllItems`/`isAddingExpense` checks, so leaving them unconditionally mounted is unchanged behavior.

Wrap as:

```typescript
            {activeTab === 'overview' && (
                <>
                    {/* Settlement plan first — it answers "what do I do now" */}
                    <SettlementPlanList
                        settlements={settlementPlan}
                        getMemberName={getMemberName}
                        getMemberAvatar={getMemberAvatar}
                        isGuestMember={isGuestMember}
                        onSettle={handleSettleClick}
                        onSettleAll={handleSettleAllClick}
                        currentMemberId={currentUserMember?.id}
                    />

                    {/* Your balance summary */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                            <BalanceCard type="owed" balances={owedToYou} />
                        </div>
                        <div className="flex-1">
                            <BalanceCard type="owing" balances={youOwe} />
                        </div>
                    </div>

                    {/* Member balances */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-primary" />
                                <h3 className="font-bold text-lg">Group balances</h3>
                            </div>
                        </div>
                        <MemberBalancesList members={members} serverBalances={groupBalances} />
                    </div>

                    {/* History */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between px-2">
                            <h2 className="text-2xl font-bold tracking-tight">Payment history</h2>
                        </div>

                        <HistoryList
                            items={visibleTransactionItems}
                            hasMore={transactions.hasMore}
                            isLoadingMore={transactions.isLoadingMore}
                            loadMoreError={transactions.loadMoreError}
                            onLoadMore={handleLoadMore}
                            currency={currency}
                            getMemberName={getMemberName}
                            onEdit={handleEditClick}
                            onDelete={handleDeleteClick}
                            onAddExpense={() => { setIsAddingExpense(true); }}
                        />
                    </div>
                </>
            )}

            {activeTab === 'members' && <MemberManager />}

            {activeTab === 'analytics' && <GroupAnalytics groupId={routeId ?? ''} />}
```

(the surrounding JSX — everything before the `{activeTab === 'overview' &&` block and everything from `{/* Edit Modal */}` onward — is unchanged; only these four content blocks move inside the new conditional, and the two new tab panels are added directly after).

- [ ] **Step 5: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no errors. This is also the point where Task 12's `GroupAnalytics` prop change gets its one real call site — if this fails, check that `groupId={routeId ?? ''}` matches `GroupAnalyticsProps` exactly.

- [ ] **Step 6: Lint**

```bash
cd money-split-app && npx eslint src/components/GroupDetail.tsx
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd money-split-app
git add src/components/GroupDetail.tsx
git commit -m "feat: restructure GroupDetail into Overview/Members/Analytics tabs"
```

---

### Task 14: Frontend — remove the `/group/:id/members` and `/group/:id/analytics` routes and the "Current group" sidebar section

**Files:**
- Modify: `money-split-app/src/App.tsx`
- Modify: `money-split-app/src/components/Layout.tsx`

**Interfaces:**
- Removes: the `/group/:id/members` and `/group/:id/analytics` routes and their lazy imports from `App.tsx`; the "Current group" sidebar section (both the "Manage members" and "Analytics" buttons and their heading) from `Layout.tsx`.

- [ ] **Step 1: Remove the two routes and lazy imports from `App.tsx`**

In `money-split-app/src/App.tsx`, remove these two lazy-import lines:

```typescript
const MemberManager = lazy(() => import('./components/MemberManager').then(m => ({ default: m.MemberManager })));
const GroupAnalytics = lazy(() => import('./components/GroupAnalytics').then(m => ({ default: m.GroupAnalytics })));
```

(`MemberManager` and `GroupAnalytics` are now imported directly, non-lazily, inside `GroupDetail.tsx` per Task 13 — consistent with how `GroupDetail.tsx` already imports its other sub-components like `SettlementPlanList`/`EditExpenseModal` directly rather than lazily, since `GroupDetail` itself is already the lazy-loaded unit.)

Remove these two routes:

```typescript
                    <Route path="/group/:id/members" element={<MemberManager />} />
                    <Route path="/group/:id/analytics" element={<GroupAnalytics />} />
```

- [ ] **Step 2: Remove the "Current group" sidebar section from `Layout.tsx`**

In `money-split-app/src/components/Layout.tsx`, remove `BarChart3` from the `lucide-react` import (it's only used by the button being removed):

```typescript
import { Users, PlusCircle, LogIn, LogOut, Home, ChevronLeft } from 'lucide-react';
```

Remove `activeGroupId` from the `useGroup()` destructure (it becomes unused once the block below is removed — confirmed by `grep -n "activeGroupId" src/components/Layout.tsx` showing no other usage in this file):

```typescript
    const { groups, switchGroup } = useGroup();
```

Remove the entire "Current group" block:

```typescript
                    {activeGroupId && (
                        <>
                            <div className="pt-4 pb-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 mt-2">
                                Current group
                            </div>

                            <button
                                onClick={() => { void navigate(`/group/${activeGroupId}/members`); }}
                                className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors", location.pathname.includes('/members') ? "bg-primary/10 text-primary" : "hover:bg-secondary")}
                            >
                                <Users className="w-5 h-5" />
                                <span className="font-medium">Manage members</span>
                            </button>

                            <button
                                onClick={() => { void navigate(`/group/${activeGroupId}/analytics`); }}
                                className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors", location.pathname.includes('/analytics') ? "bg-primary/10 text-primary" : "hover:bg-secondary")}
                            >
                                <BarChart3 className="w-5 h-5" />
                                <span className="font-medium">Analytics</span>
                            </button>
                        </>
                    )}
```

`Users` stays imported — it's still used by the mobile bottom-nav's "Groups" `NavItem`.

- [ ] **Step 3: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Lint**

```bash
cd money-split-app && npx eslint src/App.tsx src/components/Layout.tsx
```

Expected: no new errors.

- [ ] **Step 5: Manual verification via live preview**

Start the app (`preview_start` per this session's established pattern), sign in, and navigate to a group with expenses in multiple categories, paid/split across at least two members. Confirm:
- Navigating to a group from the sidebar or `/groups` lands on `/group/:id/details` and shows the Overview tab by default.
- The sidebar no longer shows a "Current group" section at any viewport — it stops after "Create or join group".
- The `GroupDetailTabs` pill row (Overview/Members/Analytics) renders directly under the header, on both desktop and a 375px mobile viewport.
- Clicking "Members" shows `MemberManager`'s content (add people, group members list, danger zone) in place of the Overview content; clicking the header's "Manage members" button does the same.
- Clicking "Analytics" shows, in order: Spending by Category, Spending by Person, Category breakdown per person, Top Expenses — with no page-chrome header duplicating `GroupDetail.tsx`'s own header.
- Toggling "Paid"/"Share" on Spending by Person still works from inside the Analytics tab.
- Top Expenses row clicks still open the edit-expense modal pre-filled correctly, and saving updates the row.
- Switching between tabs and back does not lose Overview data (settlement plan, balances, history) or force a jarring reload.
- Visiting `/group/:id/members` or `/group/:id/analytics` directly (old bookmarked URL) falls through to the catch-all route and redirects to `/` (matches existing `<Route path="*" element={<Navigate to="/" replace />} />` behavior — no dedicated redirect is added for these retired paths, consistent with how this app has no other legacy-URL redirect precedent).
- Check both light and dark mode.

- [ ] **Step 6: Commit**

```bash
cd money-split-app
git add src/App.tsx src/components/Layout.tsx
git commit -m "refactor: remove /group/:id/members and /group/:id/analytics routes, remove Current group sidebar section"
```

---

### Task 15: Update root repo submodule pointers

**Files:**
- Modify: `money-split-app` (submodule pointer)
- Modify: `money-split-backend` (submodule pointer)

**Interfaces:** None — this task only updates the parent repo's recorded submodule commits to point at the new commits made in Tasks 1-14.

- [ ] **Step 1: Verify both submodules are on their latest commits**

```bash
cd /Users/ducnguyen/code/money-split
git -C money-split-backend log --oneline -3
git -C money-split-app log --oneline -10
```

Expected: the backend log shows the three commits from Tasks 1-3 at the top (unchanged from before this revision); the app log shows ten commits at the top — the six from Tasks 4-9 plus the four new ones from Tasks 11-14.

- [ ] **Step 2: Stage and commit the updated submodule pointers in the root repo**

```bash
cd /Users/ducnguyen/code/money-split
git add money-split-app money-split-backend
git commit -m "chore: update submodule pointers to latest commits"
```

Expected: `git status` afterward shows a clean working tree with respect to the submodule pointers (other unrelated pre-existing local changes, if any, are untouched).

---
