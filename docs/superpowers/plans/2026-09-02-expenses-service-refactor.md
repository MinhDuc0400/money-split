# Expenses Service Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan — tasks are sequential and each depends on the previous one's extraction already existing, not independently parallelizable) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `money-split-backend/src/expenses/expenses.service.ts` (1328 lines, 19 methods) into five focused pieces — a plain-function module for pure calculations, a shared membership-check service, and three domain services (balances, analytics, export) — with zero behavior change. `ExpensesService` itself shrinks to ~565 lines / 6 methods (core CRUD only).

**Architecture:** Six sequential tasks. Each task extracts one piece, updates every call site that used it (`ExpensesService`, `ExpensesController`, `ExpensesModule`), relocates its tests, and leaves the full test suite passing before moving to the next task — no task leaves a half-migrated or broken intermediate state. Task order matters: `lib/split-calculations.ts` and `GroupMembershipService` first (nothing depends on anything but Prisma), then `ExpensesBalancesService`, then `ExpensesAnalyticsService`, then `ExpensesExportService` last (it depends on `ExpensesBalancesService` already existing, per the cross-service call documented in Task 5). A final task re-verifies everything and syncs the root repo's submodule pointer.

**Tech Stack:** NestJS 11, Prisma (existing `PrismaService`, no schema changes), Jest (TDD where new tests are added; existing tests are relocated verbatim, not rewritten), `exceljs` (unchanged, moves with `exportExpenses`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-02-expenses-service-refactor-design.md`. This plan implements it exactly — read it for full rationale on every design decision below.
- **Zero behavior change.** No route path, HTTP method, guard, DTO, response shape, or Swagger decorator on `ExpensesController` changes. No business logic, validation rule, or error message changes anywhere, including the known `getUserBalance` membership-check asymmetry (it does NOT get changed to call `GroupMembershipService.assertActiveMember` — that would be a behavior change, out of scope).
- **`src/settlements/` is not touched at all** — no unification with `SettlementsService`/`calculateMinimalTransfers`, despite their conceptual overlap with `ExpensesBalancesService.getSettlements`.
- **`src/expenses/interfaces/expense-calculation.interface.ts` is not touched** — confirmed dead code (no importers), left as pre-existing cleanup debt, not this refactor's job.
- Every new/slimmed spec file's `TestingModule` provides a **real** `GroupMembershipService` instance (constructed against the same mocked `PrismaService`), never a `jest.fn()`-mocked one — the existing "throws `ForbiddenException` when not an active member" tests assert on `assertActiveMember`'s real logic running against `mockPrisma.groupMember.findUnique`, and that must keep working identically post-split. Same for `ExpensesExportService`'s tests: they provide a **real** `ExpensesBalancesService` instance, not a mock, because the existing Balances/Settlement-block row assertions depend on real `getBalances`/`getSettlements` computation running against mocked Prisma data.
- Verification commands for every task (run from `money-split-backend/`): `npx jest --silent`, `npx tsc --noEmit`, `npx eslint src/expenses/`. Per the spec's documented baseline (verified fresh at design time): `tsc` has 13 pre-existing errors (11 in `settlements.service.spec.ts`, 2 in `expenses.service.spec.ts`'s untyped `mockPrisma` object — a repo-wide convention also present in `groups.service.spec.ts`), and `eslint src/expenses/` has 206 problems (205 errors, all in `expenses.service.spec.ts`'s same untyped-mock convention; 1 warning in `expenses.service.ts` line 161 inside `allocateByWeights`, which moves with it in Task 1). **Splitting `expenses.service.spec.ts` across multiple files means each new file that declares its own `mockPrisma` object literal independently triggers the same 2 tsc diagnostics and the same eslint error family** — this is the same accepted convention appearing in more places, not a new problem, but it means the *exact* error counts will change task to task. Each task below states its own expected count; don't assume Task 1's baseline holds through Task 6.
- Full test suite pass/fail count must stay identical throughout: same 2 pre-existing, unrelated failures (`src/settlements/settlement.algo.spec.ts`, `src/auth/auth.controller.spec.ts`), untouched by any task here.
- Commit after each task, using that task's exact commit message.

---

## File Structure

**Create:**
- `src/expenses/lib/split-calculations.ts` — Task 1
- `src/expenses/lib/split-calculations.spec.ts` — Task 1
- `src/expenses/group-membership.service.ts` — Task 2
- `src/expenses/group-membership.service.spec.ts` — Task 2
- `src/expenses/expenses-balances.service.ts` — Task 3
- `src/expenses/expenses-balances.service.spec.ts` — Task 3
- `src/expenses/expenses-analytics.service.ts` — Task 4
- `src/expenses/expenses-analytics.service.spec.ts` — Task 4
- `src/expenses/expenses-export.service.ts` — Task 5
- `src/expenses/expenses-export.service.spec.ts` — Task 5

**Modify (across tasks):**
- `src/expenses/expenses.service.ts` — shrinks in every task from Task 1 through Task 5
- `src/expenses/expenses.service.spec.ts` — shrinks in every task from Task 1 through Task 5 (blocks move out)
- `src/expenses/expenses.controller.ts` — Tasks 3, 4, 5 (constructor + handler bodies)
- `src/expenses/expenses.module.ts` — Tasks 2, 3, 4, 5 (providers list)

**Root repo (`money-split/`):**
- Modify: `money-split-backend` submodule pointer — Task 6

---

### Task 1: Extract pure split-calculation functions to `lib/split-calculations.ts`

**Files:**
- Create: `money-split-backend/src/expenses/lib/split-calculations.ts`
- Create: `money-split-backend/src/expenses/lib/split-calculations.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`

**Interfaces:**
- Produces: `allocateByWeights(weights: number[], totalCents: number): number[]`, `calculateDebtFlows(payers: {memberId: string; amount: number}[], splits: {memberId: string; amountCents: number}[]): DebtFlow[]`, `validatePayersTotal(payers: {amount: number}[], totalCents: number, amount: number): void`, `calculateSplitData(splitType: SplitType, totalCents: number, amount: number, splits: SplitInput[]): SplitData[]` — all plain exported functions from `./lib/split-calculations`. `ExpensesService` (this task) is the only consumer; no later task imports these directly.

- [ ] **Step 1: Write the failing tests for the new pure-function module**

Create `money-split-backend/src/expenses/lib/split-calculations.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { SplitType } from '@prisma/client';
import {
  allocateByWeights,
  calculateDebtFlows,
  validatePayersTotal,
  calculateSplitData,
} from './split-calculations';

describe('allocateByWeights', () => {
  it('distributes by largest-remainder when the split does not divide evenly', () => {
    expect(allocateByWeights([1, 1, 1], 100)).toEqual([34, 33, 33]);
  });

  it('divides evenly with no remainder to distribute', () => {
    expect(allocateByWeights([1, 1], 10000)).toEqual([5000, 5000]);
  });

  it('throws BadRequestException when total weight is zero', () => {
    expect(() => allocateByWeights([0, 0], 100)).toThrow(BadRequestException);
    expect(() => allocateByWeights([0, 0], 100)).toThrow(
      'Total weight must be greater than 0',
    );
  });
});

describe('calculateDebtFlows', () => {
  it('maps a single payer to a single non-payer splitter for the full amount', () => {
    const flows = calculateDebtFlows(
      [{ memberId: 'A', amount: 30 }],
      [{ memberId: 'B', amountCents: 3000 }],
    );
    expect(flows).toEqual([
      { debtorId: 'B', creditorId: 'A', amountCents: 3000 },
    ]);
  });

  it('splits a single splitter debt proportionally across multiple payers', () => {
    const flows = calculateDebtFlows(
      [
        { memberId: 'A', amount: 60 },
        { memberId: 'B', amount: 40 },
      ],
      [{ memberId: 'C', amountCents: 10000 }],
    );
    expect(flows).toEqual([
      { debtorId: 'C', creditorId: 'A', amountCents: 6000 },
      { debtorId: 'C', creditorId: 'B', amountCents: 4000 },
    ]);
  });

  it('does not create a flow between a payer and themselves as a splitter', () => {
    const flows = calculateDebtFlows(
      [{ memberId: 'A', amount: 50 }],
      [{ memberId: 'A', amountCents: 5000 }],
    );
    expect(flows).toEqual([]);
  });
});

describe('validatePayersTotal', () => {
  it('does not throw when payer amounts sum to the total', () => {
    expect(() =>
      validatePayersTotal([{ amount: 50 }], 5000, 50),
    ).not.toThrow();
  });

  it('throws BadRequestException with both amounts when they mismatch', () => {
    expect(() => validatePayersTotal([{ amount: 40 }], 5000, 50)).toThrow(
      BadRequestException,
    );
    expect(() => validatePayersTotal([{ amount: 40 }], 5000, 50)).toThrow(
      'Total payers amount (40) must equal expense amount (50)',
    );
  });
});

describe('calculateSplitData', () => {
  it('computes an EVEN split across participants', () => {
    const result = calculateSplitData(SplitType.EVEN, 10000, 100, [
      { memberId: 'A' },
      { memberId: 'B' },
    ]);
    expect(result).toEqual([
      { memberId: 'A', amountCents: 5000 },
      { memberId: 'B', amountCents: 5000 },
    ]);
  });

  it('throws BadRequestException for EVEN with no participants', () => {
    expect(() => calculateSplitData(SplitType.EVEN, 10000, 100, [])).toThrow(
      'At least one participant is required',
    );
  });

  it('computes an EXACT split from given amounts', () => {
    const result = calculateSplitData(SplitType.EXACT, 10000, 100, [
      { memberId: 'A', amount: 30 },
      { memberId: 'B', amount: 70 },
    ]);
    expect(result).toEqual([
      { memberId: 'A', amountCents: 3000 },
      { memberId: 'B', amountCents: 7000 },
    ]);
  });

  it('throws BadRequestException when EXACT amounts do not sum to the total', () => {
    expect(() =>
      calculateSplitData(SplitType.EXACT, 10000, 100, [
        { memberId: 'A', amount: 30 },
        { memberId: 'B', amount: 60 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('computes a PERCENTAGE split', () => {
    const result = calculateSplitData(SplitType.PERCENTAGE, 10000, 100, [
      { memberId: 'A', percentage: 50 },
      { memberId: 'B', percentage: 50 },
    ]);
    expect(result).toEqual([
      { memberId: 'A', amountCents: 5000, percentage: 50 },
      { memberId: 'B', amountCents: 5000, percentage: 50 },
    ]);
  });

  it('throws BadRequestException when percentages do not sum to 100', () => {
    expect(() =>
      calculateSplitData(SplitType.PERCENTAGE, 10000, 100, [
        { memberId: 'A', percentage: 40 },
        { memberId: 'B', percentage: 40 },
      ]),
    ).toThrow('Percentages must sum to 100%. Currently 80%');
  });

  it('computes a SHARES split', () => {
    const result = calculateSplitData(SplitType.SHARES, 10000, 100, [
      { memberId: 'A', share: 1 },
      { memberId: 'B', share: 3 },
    ]);
    expect(result).toEqual([
      { memberId: 'A', amountCents: 2500, share: 1 },
      { memberId: 'B', amountCents: 7500, share: 3 },
    ]);
  });

  it('throws BadRequestException when total shares is zero', () => {
    expect(() =>
      calculateSplitData(SplitType.SHARES, 10000, 100, [
        { memberId: 'A', share: 0 },
        { memberId: 'B', share: 0 },
      ]),
    ).toThrow('Total shares must be greater than 0');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest split-calculations --silent
```

Expected: `FAIL` — `Cannot find module './split-calculations'`.

- [ ] **Step 3: Create the pure-function module**

Create `money-split-backend/src/expenses/lib/split-calculations.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { SplitType } from '@prisma/client';
import { fromCents, toCents } from '../../helpers/number.helper';
import { DebtFlow, SplitData, SplitInput } from '../types/expense-internal.types';

export function allocateByWeights(
  weights: number[],
  totalCents: number,
): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    throw new BadRequestException('Total weight must be greater than 0');
  }

  const raw = weights.map((w) => {
    const exact = (totalCents * w) / totalWeight;
    return { base: Math.floor(exact), frac: exact - Math.floor(exact) };
  });

  const assigned = raw.reduce((a, b) => a + b.base, 0);
  let rem = totalCents - assigned;

  const order = raw
    .map((r, idx) => ({ idx, frac: r.frac }))
    .sort((a, b) => b.frac - a.frac);

  const cents = raw.map((r) => r.base);
  for (let i = 0; i < order.length && rem > 0; i++, rem--) {
    cents[order[i].idx] += 1;
  }

  return cents;
}

export function calculateDebtFlows(
  payers: { memberId: string; amount: number }[],
  splits: { memberId: string; amountCents: number }[],
): DebtFlow[] {
  const flows: DebtFlow[] = [];
  const payerCents = payers.map((p) => ({
    memberId: p.memberId,
    amountCents: toCents(p.amount),
  }));

  let payerIndex = 0;
  let currentPayerOffset = 0;
  let splitterOffset = 0;

  for (const s of splits) {
    const splitterNextOffset = splitterOffset + s.amountCents;
    while (
      payerIndex < payerCents.length &&
      currentPayerOffset < splitterNextOffset
    ) {
      const p = payerCents[payerIndex];
      const payerNextOffset = currentPayerOffset + p.amountCents;

      // Intersection of [splitterOffset, splitterNextOffset] and [currentPayerOffset, payerNextOffset]
      const overlapStart = Math.max(splitterOffset, currentPayerOffset);
      const overlapEnd = Math.min(splitterNextOffset, payerNextOffset);
      const overlap = overlapEnd - overlapStart;

      if (overlap > 0 && s.memberId !== p.memberId) {
        // Debt invariant: For each splitter S and each payer P:
        // S owes P = splitAmount(S) * (payerPaid / totalPaid).
        // We use an intersection of ranges to implement this proportionally in integer cents without drift.
        flows.push({
          debtorId: s.memberId,
          creditorId: p.memberId,
          amountCents: overlap,
        });
      }

      if (payerNextOffset <= splitterNextOffset) {
        payerIndex++;
        currentPayerOffset = payerNextOffset;
      } else {
        currentPayerOffset = overlapEnd; // Move pointer to end of splitter range
        break;
      }
    }
    splitterOffset = splitterNextOffset;
  }

  return flows;
}

/** Throws BadRequestException if payer amounts don't sum to the expense total. */
export function validatePayersTotal(
  payers: { amount: number }[],
  totalCents: number,
  amount: number,
) {
  const payersTotalCents = payers.reduce(
    (sum, p) => sum + toCents(p.amount),
    0,
  );
  if (payersTotalCents !== totalCents) {
    throw new BadRequestException(
      `Total payers amount (${fromCents(payersTotalCents)}) must equal expense amount (${amount})`,
    );
  }
}

/**
 * Computes per-member split amounts (in cents) for the given split type,
 * validating the split-specific invariant (participants present, exact
 * amounts sum to total, percentages sum to 100%, shares > 0). Shared by
 * create() and updateExpense() since both accept the same split shape.
 */
export function calculateSplitData(
  splitType: SplitType,
  totalCents: number,
  amount: number,
  splits: SplitInput[],
): SplitData[] {
  const splitData: SplitData[] = [];

  switch (splitType) {
    case SplitType.EVEN: {
      const participantIds = splits.map((s) => s.memberId);
      if (participantIds.length === 0) {
        throw new BadRequestException('At least one participant is required');
      }

      const cents = allocateByWeights(
        new Array(participantIds.length).fill(1),
        totalCents,
      );
      participantIds.forEach((memberId, i) => {
        splitData.push({
          memberId,
          amountCents: cents[i],
        });
      });
      break;
    }

    case SplitType.EXACT: {
      const splitCentsSum = splits.reduce(
        (sum, s) => sum + toCents(s.amount || 0),
        0,
      );
      if (splitCentsSum !== totalCents) {
        throw new BadRequestException(
          `Exact split amounts must sum to ${amount}. Currently ${fromCents(splitCentsSum)}`,
        );
      }
      splits.forEach((s) => {
        splitData.push({
          memberId: s.memberId,
          amountCents: toCents(s.amount || 0),
        });
      });
      break;
    }

    case SplitType.PERCENTAGE: {
      const percentages = splits.map((s) => s.percentage || 0);
      const percentSum = percentages.reduce((a, b) => a + b, 0);

      // We use Math.round(percentSum * 100) to check if it's 100% (with 2 decimal precision for percentages)
      if (Math.round(percentSum * 100) !== 10000) {
        throw new BadRequestException(
          `Percentages must sum to 100%. Currently ${percentSum}%`,
        );
      }

      const cents = allocateByWeights(percentages, totalCents);
      splits.forEach((s, i) => {
        splitData.push({
          memberId: s.memberId,
          amountCents: cents[i],
          percentage: s.percentage,
        });
      });
      break;
    }

    case SplitType.SHARES: {
      const shares = splits.map((s) => s.share || 0);
      const totalShares = shares.reduce((a, b) => a + b, 0);

      if (totalShares <= 0) {
        throw new BadRequestException('Total shares must be greater than 0');
      }

      const cents = allocateByWeights(shares, totalCents);
      splits.forEach((s, i) => {
        splitData.push({
          memberId: s.memberId,
          amountCents: cents[i],
          share: s.share,
        });
      });
      break;
    }
  }

  // Invariant check
  const totalSplitCents = splitData.reduce(
    (sum, s) => sum + s.amountCents,
    0,
  );
  if (totalSplitCents !== totalCents) {
    throw new Error('Internal Invariant Violation: Split sum mismatch');
  }

  return splitData;
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
cd money-split-backend && npx jest split-calculations --silent
```

Expected: `PASS`, 15 tests.

- [ ] **Step 5: Update `expenses.service.ts` to use the extracted functions**

In `money-split-backend/src/expenses/expenses.service.ts`:

Remove lines 43-244 entirely (the four private methods: `allocateByWeights`, `calculateDebtFlows`, `validatePayersTotal`, `calculateSplitData`, plus the blank lines and doc-comments immediately around them, from the `private allocateByWeights(...)` line through the closing `}` of `calculateSplitData`).

Add this import, directly after the existing `import { fromCents, toCents } from '../helpers/number.helper';` line. Note `allocateByWeights` is deliberately NOT imported here — `ExpensesService` never calls it directly, only `calculateSplitData` does, internally, within `lib/split-calculations.ts` itself:

```typescript
import {
  calculateDebtFlows,
  validatePayersTotal,
  calculateSplitData,
} from './lib/split-calculations';
```

Update the four call sites (search-and-replace `this.` prefix removal on these exact calls only):
- In `create` (originally line 275): `this.validatePayersTotal(dto.payers, totalCents, dto.amount);` → `validatePayersTotal(dto.payers, totalCents, dto.amount);`
- In `create` (originally line 278): `const splitData = this.calculateSplitData(` → `const splitData = calculateSplitData(`
- In `updateExpense` (originally line 1075): `this.validatePayersTotal(payers, totalCents, amount);` → `validatePayersTotal(payers, totalCents, amount);`
- In `updateExpense` (originally line 1076): `const splitData = this.calculateSplitData(` → `const splitData = calculateSplitData(`
- In `applyExpenseEffects` (originally line 1316): `const flows = this.calculateDebtFlows(payers, splitData);` → `const flows = calculateDebtFlows(payers, splitData);`
- In `reverseExpenseEffects` (originally line 1254): `const flows = this.calculateDebtFlows(payers, splits);` → `const flows = calculateDebtFlows(payers, splits);`

- [ ] **Step 6: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: same 13 pre-existing errors as the documented baseline (none newly introduced — the extracted functions are typed identically to their former method signatures).

- [ ] **Step 7: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: all existing `expenses.service.spec.ts` tests still pass unchanged (the `create`/`updateExpense` tests exercise the same logic, now routed through plain function calls instead of `this.` method calls — behaviorally identical), plus the 15 new `split-calculations.spec.ts` tests. Same 2 pre-existing unrelated failures elsewhere, unchanged.

- [ ] **Step 8: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/
```

Expected: the pre-existing warning at `expenses.service.ts:161` (`no-unsafe-argument` inside the old `allocateByWeights`) now appears instead at the corresponding line inside the new `lib/split-calculations.ts` — same warning, moved location, not a new problem. Total count should otherwise match the 206-problem baseline (205 errors + 1 warning), possibly ±0 since nothing about the mock-heavy spec file changed in this task.

- [ ] **Step 9: Commit**

```bash
cd money-split-backend
git add src/expenses/lib/split-calculations.ts src/expenses/lib/split-calculations.spec.ts src/expenses/expenses.service.ts
git commit -m "refactor: extract pure split-calculation functions to lib/split-calculations.ts"
```

---

### Task 2: Extract `GroupMembershipService`

**Files:**
- Create: `money-split-backend/src/expenses/group-membership.service.ts`
- Create: `money-split-backend/src/expenses/group-membership.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.module.ts`

**Interfaces:**
- Produces: `@Injectable() class GroupMembershipService { async assertActiveMember(groupId: string, userId: string): Promise<GroupMember> }` (throws `ForbiddenException('You are not a member of this group')` when the caller isn't an active member). Tasks 3, 4, 5 all inject this into their new services' constructors as `private groupMembership: GroupMembershipService` and call `this.groupMembership.assertActiveMember(groupId, userId)`.

- [ ] **Step 1: Write the failing tests**

Create `money-split-backend/src/expenses/group-membership.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { GroupMembershipService } from './group-membership.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GroupMembershipService', () => {
  let service: GroupMembershipService;

  const mockPrisma = {
    groupMember: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupMembershipService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GroupMembershipService>(GroupMembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assertActiveMember', () => {
    const groupId = 'group-1';
    const userId = 'user-1';

    it('returns the member when they are an active member', async () => {
      const member = {
        id: 'member-1',
        groupId,
        userId,
        deletedAt: null,
      };
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce(member);

      await expect(
        service.assertActiveMember(groupId, userId),
      ).resolves.toEqual(member);
      expect(mockPrisma.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId, userId } },
      });
    });

    it('throws ForbiddenException when no membership row exists', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.assertActiveMember(groupId, userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the membership row is soft-deleted', async () => {
      mockPrisma.groupMember.findUnique.mockResolvedValueOnce({
        id: 'member-1',
        groupId,
        userId,
        deletedAt: new Date(),
      });

      await expect(
        service.assertActiveMember(groupId, userId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest group-membership --silent
```

Expected: `FAIL` — `Cannot find module './group-membership.service'`.

- [ ] **Step 3: Create `GroupMembershipService`**

Create `money-split-backend/src/expenses/group-membership.service.ts`:

```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GroupMembershipService {
  constructor(private prisma: PrismaService) {}

  /** Throws ForbiddenException if userId isn't an active member of groupId. */
  async assertActiveMember(groupId: string, userId: string) {
    const member = await this.prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!member || member.deletedAt) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return member;
  }
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
cd money-split-backend && npx jest group-membership --silent
```

Expected: `PASS`, 3 tests.

- [ ] **Step 5: Update `expenses.service.ts`**

Remove the private `assertActiveMember` method (originally lines 246-262, the doc comment plus the method — this is now the first method in the file after imports/constructor, since Task 1 already removed the four pure functions above it).

Add `GroupMembershipService` to the constructor and its import:

```typescript
import { GroupMembershipService } from './group-membership.service';
```

Change the constructor from:

```typescript
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
  ) {}
```

to:

```typescript
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private groupMembership: GroupMembershipService,
  ) {}
```

Update the four remaining call sites from `this.assertActiveMember(groupId, userId)` to `this.groupMembership.assertActiveMember(groupId, userId)`:
- `create` (originally line 271)
- `getGroupTransactions` (originally line 384)
- `updateExpense` (originally line 1044)
- `deleteExpense` (originally line 1169)

- [ ] **Step 6: Update `expenses.service.spec.ts`'s `TestingModule`**

In `money-split-backend/src/expenses/expenses.service.spec.ts`, add the import:

```typescript
import { GroupMembershipService } from './group-membership.service';
```

Change the `TestingModule` providers array (currently lines 60-64) from:

```typescript
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockEventsGateway },
      ],
```

to:

```typescript
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockEventsGateway },
        GroupMembershipService,
      ],
```

(A real `GroupMembershipService`, not a mock — per the Global Constraints, so the existing "throws ForbiddenException when not an active member" tests continue to exercise the real logic against `mockPrisma.groupMember.findUnique`, exactly as they do today.)

- [ ] **Step 7: Update `expenses.module.ts`**

In `money-split-backend/src/expenses/expenses.module.ts`, add the import and provider:

```typescript
import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { GroupMembershipService } from './group-membership.service';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, GroupMembershipService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
```

- [ ] **Step 8: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: same 13 pre-existing errors, none new.

- [ ] **Step 9: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: all existing tests pass (every "throws ForbiddenException" test in `expenses.service.spec.ts` still passes, now exercising the real `GroupMembershipService` instance instead of a private method — identical behavior), plus the 3 new `group-membership.service.spec.ts` tests. Same 2 pre-existing unrelated failures elsewhere.

- [ ] **Step 10: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/
```

Expected: no new error classes. Total count may shift slightly (a few unsafe-any diagnostics could appear on the new `mockPrisma` in `group-membership.service.spec.ts`, following the same established pattern) — confirm any new count is entirely instances of the same `@typescript-eslint/no-unsafe-*` family already present, not a different rule.

- [ ] **Step 11: Commit**

```bash
cd money-split-backend
git add src/expenses/group-membership.service.ts src/expenses/group-membership.service.spec.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.module.ts
git commit -m "refactor: extract GroupMembershipService for shared membership checks"
```

---

### Task 3: Extract `ExpensesBalancesService`

**Files:**
- Create: `money-split-backend/src/expenses/expenses-balances.service.ts`
- Create: `money-split-backend/src/expenses/expenses-balances.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`
- Modify: `money-split-backend/src/expenses/expenses.module.ts`

**Interfaces:**
- Consumes: `GroupMembershipService` (Task 2).
- Produces: `@Injectable() class ExpensesBalancesService { async getBalances(groupId, userId): Promise<BalancesByCurrency>; async getUserBalance(groupId, userId): Promise<UserBalanceResponse>; async getSettlements(groupId, userId): Promise<RecommendedSettlement[]> }`. **Task 5 injects this service** (its `exportExpenses` calls `this.balancesService.getBalances(...)`/`this.balancesService.getSettlements(...)`) — this is why `ExpensesBalancesService` must exist before Task 5 runs.
- **Temporary, cleaned up in Task 5:** `exportExpenses` still lives in `ExpensesService` at the end of this task (it doesn't move until Task 5), and it calls `this.getBalances`/`this.getSettlements` — both of which this task removes from `ExpensesService`. So this task ALSO injects `ExpensesBalancesService` into `ExpensesService`'s constructor and rewrites those two call sites to go through it. Task 5 removes this temporary injection again once `exportExpenses` itself moves out.

- [ ] **Step 1: Write the failing test (relocating the existing `getUserBalance` block)**

Create `money-split-backend/src/expenses/expenses-balances.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ExpensesBalancesService } from './expenses-balances.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupMembershipService } from './group-membership.service';

describe('ExpensesBalancesService', () => {
  let service: ExpensesBalancesService;

  const mockPrisma = {
    groupMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    memberBalance: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesBalancesService,
        { provide: PrismaService, useValue: mockPrisma },
        GroupMembershipService,
      ],
    }).compile();

    service = module.get<ExpensesBalancesService>(ExpensesBalancesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
```

Now copy the ENTIRE `describe('getUserBalance', () => { ... })` block verbatim from `money-split-backend/src/expenses/expenses.service.spec.ts` (currently lines 74-118 — read that exact range from the file yourself before pasting, do not paraphrase) into this new file, immediately after the `afterEach` block above, replacing every `service.getUserBalance(...)` call with the same `service.getUserBalance(...)` (the variable name `service` is unchanged — it now refers to an `ExpensesBalancesService` instance instead of `ExpensesService`, but the call syntax is identical since `getUserBalance` is a method on both at this point in the migration).

Close the outer `describe('ExpensesBalancesService', ...)` block with a final `});` after the relocated block.

Then remove that same `describe('getUserBalance', ...)` block (lines 74-118) from `money-split-backend/src/expenses/expenses.service.spec.ts`.

- [ ] **Step 2: Run the tests to verify the new file fails**

```bash
cd money-split-backend && npx jest expenses-balances --silent
```

Expected: `FAIL` — `Cannot find module './expenses-balances.service'`.

- [ ] **Step 3: Create `ExpensesBalancesService`**

Create `money-split-backend/src/expenses/expenses-balances.service.ts`:

```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GroupMembershipService } from './group-membership.service';
import {
  BalancesByCurrency,
  RecommendedSettlement,
  UserBalanceResponse,
} from './types/expense-responses.type';
import { fromCents, toCents } from '../helpers/number.helper';

@Injectable()
export class ExpensesBalancesService {
  constructor(
    private prisma: PrismaService,
    private groupMembership: GroupMembershipService,
  ) {}

  async getBalances(
    groupId: string,
    userId: string,
  ): Promise<BalancesByCurrency> {
    // Verify membership
    await this.groupMembership.assertActiveMember(groupId, userId);

    const members = await this.prisma.groupMember.findMany({
      where: { groupId, deletedAt: null },
    });

    const memberBalances = await this.prisma.memberBalance.findMany({
      where: { groupId },
    });

    const balancesByCurrency: BalancesByCurrency = {};
    const memberMap = new Map(members.map((m) => [m.id, m]));

    // Group balances by currency
    memberBalances.forEach((mb) => {
      const currency = mb.currency;
      if (!balancesByCurrency[currency]) {
        balancesByCurrency[currency] = [];
      }

      const m = memberMap.get(mb.memberId);
      if (m && !m.deletedAt) {
        balancesByCurrency[currency].push({
          memberId: mb.memberId,
          name: m.name,
          avatarUrl: m.avatarUrl,
          balance: Number(mb.balance),
        });
      }
    });

    // Ensure all members are included in each currency if they have no balance record yet
    const currencies = Object.keys(balancesByCurrency);
    currencies.forEach((currency) => {
      const presentMemberIds = new Set(
        balancesByCurrency[currency].map((b) => b.memberId),
      );
      members.forEach((m) => {
        if (!presentMemberIds.has(m.id)) {
          balancesByCurrency[currency].push({
            memberId: m.id,
            name: m.name,
            avatarUrl: m.avatarUrl,
            balance: 0,
          });
        }
      });
    });

    return balancesByCurrency;
  }

  async getUserBalance(
    groupId: string,
    userId: string,
  ): Promise<UserBalanceResponse> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, deletedAt: null },
    });
    const currentUserMember = members.find((m) => m.userId === userId);

    if (!currentUserMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // Read from MemberBalance — the authoritative net balance per member,
    // updated atomically by both expense creation and settlements.
    // The Debt table tracks the payment graph but can drift from net balances
    // when minimal-transfer settlements don't perfectly map to raw debt rows.
    const memberBalances = await this.prisma.memberBalance.findMany({
      where: { groupId, memberId: currentUserMember.id },
    });

    const response: UserBalanceResponse = { balances: {} };

    for (const mb of memberBalances) {
      const net = Number(mb.balance);
      const totalOwed = net > 0 ? net : 0;
      const totalOwe = net < 0 ? Math.abs(net) : 0;

      // Report every currency the member has a balance row for, including
      // an exact 0/0 (fully settled). Omitting settled currencies makes
      // this response indistinguishable from "not fetched yet" to callers
      // that check for an empty object as a loading proxy.
      response.balances[mb.currency] = {
        totalOwed,
        totalOwe,
        details: [],
      };
    }

    return response;
  }

  async getSettlements(
    groupId: string,
    userId: string,
  ): Promise<RecommendedSettlement[]> {
    const balancesByCurrency = await this.getBalances(groupId, userId);
    const allSettlements: RecommendedSettlement[] = [];

    Object.entries(balancesByCurrency).forEach(([currency, balances]) => {
      const debtors: {
        id: string;
        name: string;
        avatarUrl: string | null;
        amountCents: number;
      }[] = [];
      const creditors: {
        id: string;
        name: string;
        avatarUrl: string | null;
        amountCents: number;
      }[] = [];

      balances.forEach((b) => {
        const cents = toCents(b.balance);
        if (cents < 0)
          debtors.push({
            id: b.memberId,
            name: b.name,
            avatarUrl: b.avatarUrl,
            amountCents: cents,
          });
        if (cents > 0)
          creditors.push({
            id: b.memberId,
            name: b.name,
            avatarUrl: b.avatarUrl,
            amountCents: cents,
          });
      });

      // debtors have negative balance, meaning they owe money.
      // creditors have positive balance, meaning they are owed money.
      // Math.abs(debtor.amountCents) is what they owe.

      debtors.sort((a, b) => a.amountCents - b.amountCents); // biggest debtors first (most negative)
      creditors.sort((a, b) => b.amountCents - a.amountCents); // biggest creditors first

      let i = 0;
      let j = 0;

      while (i < debtors.length && j < creditors.length) {
        const d = debtors[i];
        const c = creditors[j];
        const settleAmountCents = Math.min(
          Math.abs(d.amountCents),
          c.amountCents,
        );

        if (settleAmountCents > 0) {
          allSettlements.push({
            from: {
              memberId: d.id,
              name: d.name,
              avatarUrl: d.avatarUrl,
            },
            to: {
              memberId: c.id,
              name: c.name,
              avatarUrl: c.avatarUrl,
            },
            amount: fromCents(settleAmountCents),
            currency,
          });
        }

        d.amountCents += settleAmountCents;
        c.amountCents -= settleAmountCents;

        if (d.amountCents === 0) i++;
        if (c.amountCents === 0) j++;
      }
    });

    return allSettlements;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses-balances --silent
```

Expected: `PASS`.

- [ ] **Step 5: Remove the three methods from `expenses.service.ts`, temporarily inject `ExpensesBalancesService`**

In `money-split-backend/src/expenses/expenses.service.ts`, remove `getBalances`, `getUserBalance`, `getSettlements` entirely (originally lines 853-1035).

Add the import:

```typescript
import { ExpensesBalancesService } from './expenses-balances.service';
```

Update the constructor to temporarily add `ExpensesBalancesService` (needed only because `exportExpenses` still lives here until Task 5):

```typescript
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private groupMembership: GroupMembershipService,
    private balancesService: ExpensesBalancesService,
  ) {}
```

In `exportExpenses`, change the two call sites (originally lines 738-739):

```typescript
    const balancesByCurrency = await this.getBalances(groupId, userId);
    const settlements = await this.getSettlements(groupId, userId);
```

to:

```typescript
    const balancesByCurrency = await this.balancesService.getBalances(groupId, userId);
    const settlements = await this.balancesService.getSettlements(groupId, userId);
```

- [ ] **Step 6: Update `expenses.service.spec.ts`'s `TestingModule`**

In `money-split-backend/src/expenses/expenses.service.spec.ts`, add imports:

```typescript
import { ExpensesBalancesService } from './expenses-balances.service';
```

Add `memberBalance.findMany` to the existing `mockPrisma.memberBalance` block if not already present (it already is, from the pre-existing `upsert`/`findMany` — verify; `groupMember.findMany` is also already present). Add `ExpensesBalancesService` to the `TestingModule` providers array (a real instance, so `exportExpenses`'s existing Balances/Settlement-block assertions keep passing unchanged — they depend on real `getBalances`/`getSettlements` computation against the same `mockPrisma`):

```typescript
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockEventsGateway },
        GroupMembershipService,
        ExpensesBalancesService,
      ],
```

- [ ] **Step 7: Update `expenses.controller.ts`**

In `money-split-backend/src/expenses/expenses.controller.ts`, add the import:

```typescript
import { ExpensesBalancesService } from './expenses-balances.service';
```

Change the constructor:

```typescript
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly expensesBalancesService: ExpensesBalancesService,
  ) {}
```

Update the three handler bodies:
- `getBalances` (currently line 126): `return this.expensesService.getBalances(groupId, userId);` → `return this.expensesBalancesService.getBalances(groupId, userId);`
- `getMyBalance` (currently line 137): `return this.expensesService.getUserBalance(groupId, userId);` → `return this.expensesBalancesService.getUserBalance(groupId, userId);`
- `getSettlements` (currently line 148): `return this.expensesService.getSettlements(groupId, userId);` → `return this.expensesBalancesService.getSettlements(groupId, userId);`

- [ ] **Step 8: Update `expenses.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { GroupMembershipService } from './group-membership.service';
import { ExpensesBalancesService } from './expenses-balances.service';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    GroupMembershipService,
    ExpensesBalancesService,
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}
```

- [ ] **Step 9: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: same 13 pre-existing errors, none new.

- [ ] **Step 10: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: all tests pass — `expenses.service.spec.ts`'s `exportExpenses` block still passes (now routing through the real, injected `ExpensesBalancesService` instead of same-class methods — identical output), the relocated `getUserBalance` tests pass in the new file. Same 2 pre-existing unrelated failures elsewhere.

- [ ] **Step 11: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/
```

Expected: no new error classes beyond the established `no-unsafe-*` mock-object pattern, now also present in `expenses-balances.service.spec.ts`.

- [ ] **Step 12: Commit**

```bash
cd money-split-backend
git add src/expenses/expenses-balances.service.ts src/expenses/expenses-balances.service.spec.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts src/expenses/expenses.module.ts
git commit -m "refactor: extract ExpensesBalancesService (getBalances, getUserBalance, getSettlements)"
```

---

### Task 4: Extract `ExpensesAnalyticsService`

**Files:**
- Create: `money-split-backend/src/expenses/expenses-analytics.service.ts`
- Create: `money-split-backend/src/expenses/expenses-analytics.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`
- Modify: `money-split-backend/src/expenses/expenses.module.ts`

**Interfaces:**
- Consumes: `GroupMembershipService` (Task 2). Fully self-contained otherwise — no other new service calls into or is called by this one.
- Produces: `@Injectable() class ExpensesAnalyticsService { getSpendingByCategory, getSpendingByPerson, getSpendingByPersonCategory, getTopExpenses }`. No later task depends on this class.

- [ ] **Step 1: Write the failing tests (relocating four existing blocks)**

Create `money-split-backend/src/expenses/expenses-analytics.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesAnalyticsService } from './expenses-analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupMembershipService } from './group-membership.service';

describe('ExpensesAnalyticsService', () => {
  let service: ExpensesAnalyticsService;

  const mockPrisma = {
    groupMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    group: {
      findUnique: jest.fn(),
    },
    expense: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    expensePayer: {
      groupBy: jest.fn(),
    },
    expenseSplit: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        GroupMembershipService,
      ],
    }).compile();

    service = module.get<ExpensesAnalyticsService>(ExpensesAnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
```

Copy the four `describe(...)` blocks verbatim from `money-split-backend/src/expenses/expenses.service.spec.ts` (read the exact current ranges yourself before pasting — as of Task 3's commit, `getUserBalance`'s block is already gone, so re-check line numbers; at design time these were `getSpendingByCategory` 176-300, `getSpendingByPerson` 302-444, `getSpendingByPersonCategory` 446-580, `getTopExpenses` 582-711) into this new file, one after another, immediately after the `afterEach` block above. The `service.getSpendingByCategory(...)` etc. calls need no changes — same method names, same call syntax, `service` now refers to an `ExpensesAnalyticsService` instance.

Close the outer `describe('ExpensesAnalyticsService', ...)` block with a final `});`.

Then remove those same four `describe(...)` blocks from `money-split-backend/src/expenses/expenses.service.spec.ts`.

- [ ] **Step 2: Run the tests to verify the new file fails**

```bash
cd money-split-backend && npx jest expenses-analytics --silent
```

Expected: `FAIL` — `Cannot find module './expenses-analytics.service'`.

- [ ] **Step 3: Create `ExpensesAnalyticsService`**

Create `money-split-backend/src/expenses/expenses-analytics.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GroupMembershipService } from './group-membership.service';
import {
  CategorySpending,
  PersonCategorySpending,
  PersonSpending,
  TopExpenseItem,
} from './types/expense-responses.type';
import { toCents } from '../helpers/number.helper';

@Injectable()
export class ExpensesAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private groupMembership: GroupMembershipService,
  ) {}

  async getSpendingByCategory(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
  ): Promise<CategorySpending[]> {
    await this.groupMembership.assertActiveMember(groupId, userId);

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

    const grouped = await this.prisma.expense.groupBy({
      by: ['category'],
      where: {
        groupId,
        deletedAt: null,
        currency: effectiveCurrency,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
      },
      _sum: { amount: true },
    });

    return grouped.map((g) => ({
      category: g.category,
      totalCents: toCents(Number(g._sum.amount ?? 0)),
    }));
  }

  async getSpendingByPerson(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
    metric: 'paid' | 'share' = 'paid',
  ): Promise<PersonSpending[]> {
    await this.groupMembership.assertActiveMember(groupId, userId);

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

  async getSpendingByPersonCategory(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
  ): Promise<PersonCategorySpending[]> {
    await this.groupMembership.assertActiveMember(groupId, userId);

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

  async getTopExpenses(
    groupId: string,
    userId: string,
    currency?: string,
    from?: string,
    to?: string,
    limit = 5,
  ): Promise<TopExpenseItem[]> {
    await this.groupMembership.assertActiveMember(groupId, userId);

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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses-analytics --silent
```

Expected: `PASS`.

- [ ] **Step 5: Remove the four methods from `expenses.service.ts`**

Remove `getSpendingByCategory`, `getSpendingByPerson`, `getSpendingByPersonCategory`, `getTopExpenses` entirely (originally lines 500-707). Nothing else in `ExpensesService` calls any of these, so no constructor change is needed here.

- [ ] **Step 6: Update `expenses.controller.ts`**

Add the import:

```typescript
import { ExpensesAnalyticsService } from './expenses-analytics.service';
```

Extend the constructor:

```typescript
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly expensesBalancesService: ExpensesBalancesService,
    private readonly expensesAnalyticsService: ExpensesAnalyticsService,
  ) {}
```

Update the four handler bodies to call `this.expensesAnalyticsService.X(...)` instead of `this.expensesService.X(...)`: `getSpendingByCategory`, `getSpendingByPerson`, `getSpendingByPersonCategory`, `getTopExpenses` (same argument lists, unchanged).

- [ ] **Step 7: Update `expenses.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { GroupMembershipService } from './group-membership.service';
import { ExpensesBalancesService } from './expenses-balances.service';
import { ExpensesAnalyticsService } from './expenses-analytics.service';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    GroupMembershipService,
    ExpensesBalancesService,
    ExpensesAnalyticsService,
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}
```

- [ ] **Step 8: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: same 13 pre-existing errors, none new.

- [ ] **Step 9: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: all tests pass, same 2 pre-existing unrelated failures elsewhere.

- [ ] **Step 10: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/
```

Expected: no new error classes beyond the established pattern.

- [ ] **Step 11: Commit**

```bash
cd money-split-backend
git add src/expenses/expenses-analytics.service.ts src/expenses/expenses-analytics.service.spec.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts src/expenses/expenses.module.ts
git commit -m "refactor: extract ExpensesAnalyticsService"
```

---

### Task 5: Extract `ExpensesExportService`

**Files:**
- Create: `money-split-backend/src/expenses/expenses-export.service.ts`
- Create: `money-split-backend/src/expenses/expenses-export.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.ts`
- Modify: `money-split-backend/src/expenses/expenses.service.spec.ts`
- Modify: `money-split-backend/src/expenses/expenses.controller.ts`
- Modify: `money-split-backend/src/expenses/expenses.module.ts`

**Interfaces:**
- Consumes: `GroupMembershipService` (Task 2), `ExpensesBalancesService` (Task 3, for the `getBalances`/`getSettlements` calls `exportExpenses` makes internally).
- Produces: `@Injectable() class ExpensesExportService { async exportExpenses(groupId, userId): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }> }`. This is the last extraction — `ExpensesService` reaches its final ~565-line, 6-method shape after this task, and its temporary `ExpensesBalancesService` dependency (added in Task 3 only to support `exportExpenses` while it was still there) is removed.

- [ ] **Step 1: Write the failing test (relocating the existing `exportExpenses` block)**

Create `money-split-backend/src/expenses/expenses-export.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ExpensesExportService } from './expenses-export.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupMembershipService } from './group-membership.service';
import { ExpensesBalancesService } from './expenses-balances.service';

describe('ExpensesExportService', () => {
  let service: ExpensesExportService;

  const mockPrisma = {
    groupMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    memberBalance: {
      findMany: jest.fn(),
    },
    group: {
      findUnique: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesExportService,
        { provide: PrismaService, useValue: mockPrisma },
        GroupMembershipService,
        ExpensesBalancesService,
      ],
    }).compile();

    service = module.get<ExpensesExportService>(ExpensesExportService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
```

Copy the entire `describe('exportExpenses', () => { ... })` block verbatim from `money-split-backend/src/expenses/expenses.service.spec.ts` (at design time, lines 713-1005 — re-verify against the current file, since Tasks 3-4 removed other blocks before this one and shifted line numbers) into this new file, immediately after the `afterEach` block above. No call-site changes needed inside the block — `service.exportExpenses(...)` is unchanged syntax, `service` now refers to an `ExpensesExportService` instance. The `ExcelJS` import at the top of this new file is needed because several tests inside the block construct a `new ExcelJS.Workbook()` to parse the returned buffer and assert on cell values.

Close the outer `describe('ExpensesExportService', ...)` block with a final `});`.

Then remove that same `describe('exportExpenses', ...)` block from `money-split-backend/src/expenses/expenses.service.spec.ts`, and remove the now-unused `import ExcelJS from 'exceljs';` from that file's own imports if nothing else in it still references `ExcelJS` (check first — `updateExpense (category preserve-on-omit)` is the only block left besides `create (idempotency wiring)`, neither uses ExcelJS, so the import should come out).

- [ ] **Step 2: Run the tests to verify the new file fails**

```bash
cd money-split-backend && npx jest expenses-export --silent
```

Expected: `FAIL` — `Cannot find module './expenses-export.service'`.

- [ ] **Step 3: Create `ExpensesExportService`**

Create `money-split-backend/src/expenses/expenses-export.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GroupMembershipService } from './group-membership.service';
import { ExpensesBalancesService } from './expenses-balances.service';
import ExcelJS from 'exceljs';
import { buildExportFilename } from '../helpers/filename.helper';
import { toCents } from '../helpers/number.helper';

@Injectable()
export class ExpensesExportService {
  constructor(
    private prisma: PrismaService,
    private groupMembership: GroupMembershipService,
    private balancesService: ExpensesBalancesService,
  ) {}

  async exportExpenses(
    groupId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }> {
    await this.groupMembership.assertActiveMember(groupId, userId);

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
    const balancesByCurrency = await this.balancesService.getBalances(groupId, userId);
    const settlements = await this.balancesService.getSettlements(groupId, userId);

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
      const hasNonZeroBalance = balances.some((b) => toCents(b.balance) !== 0);
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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest expenses-export --silent
```

Expected: `PASS`.

- [ ] **Step 5: Remove `exportExpenses` from `expenses.service.ts` and clean up the now-unneeded temporary `ExpensesBalancesService` dependency**

Remove the `exportExpenses` method entirely (originally lines 709-851).

Remove the now-unused imports: `import ExcelJS from 'exceljs';` and `import { buildExportFilename } from '../helpers/filename.helper';`.

Remove the `ExpensesBalancesService` import and revert the constructor to drop it (it was only added in Task 3 to support `exportExpenses`, which no longer lives here):

```typescript
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private groupMembership: GroupMembershipService,
  ) {}
```

At this point `expenses.service.ts` contains exactly 6 methods: `create`, `getGroupTransactions`, `updateExpense`, `deleteExpense`, `reverseExpenseEffects` (private), `applyExpenseEffects` (private). Confirm no other reference to `ExpensesBalancesService`, `ExcelJS`, or `buildExportFilename` remains in the file.

- [ ] **Step 6: Update `expenses.service.spec.ts`'s `TestingModule`**

Remove `ExpensesBalancesService` from this file's `TestingModule` providers array (it was added in Task 3 only to support the now-removed `exportExpenses` block) and remove its now-unused import. The providers array returns to:

```typescript
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockEventsGateway },
        GroupMembershipService,
      ],
```

At this point `expenses.service.spec.ts` contains exactly two `describe` blocks: `create (idempotency wiring)` and `updateExpense (category preserve-on-omit)`.

- [ ] **Step 7: Update `expenses.controller.ts`**

Add the import:

```typescript
import { ExpensesExportService } from './expenses-export.service';
```

Extend the constructor to its final, four-parameter shape:

```typescript
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly expensesBalancesService: ExpensesBalancesService,
    private readonly expensesAnalyticsService: ExpensesAnalyticsService,
    private readonly expensesExportService: ExpensesExportService,
  ) {}
```

Update the `exportExpenses` handler body (currently line 268):

```typescript
    const { buffer, filename, filenameUtf8 } =
      await this.expensesService.exportExpenses(groupId, userId);
```

to:

```typescript
    const { buffer, filename, filenameUtf8 } =
      await this.expensesExportService.exportExpenses(groupId, userId);
```

- [ ] **Step 8: Update `expenses.module.ts` to its final shape**

```typescript
import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { GroupMembershipService } from './group-membership.service';
import { ExpensesBalancesService } from './expenses-balances.service';
import { ExpensesAnalyticsService } from './expenses-analytics.service';
import { ExpensesExportService } from './expenses-export.service';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    GroupMembershipService,
    ExpensesBalancesService,
    ExpensesAnalyticsService,
    ExpensesExportService,
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}
```

- [ ] **Step 9: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: same 13 pre-existing errors, none new.

- [ ] **Step 10: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: all tests pass — the relocated `exportExpenses` tests pass in the new file (now exercising a real, injected `ExpensesBalancesService` two layers removed from `ExpensesService` entirely — same computation, same output). Same 2 pre-existing unrelated failures elsewhere.

- [ ] **Step 11: Lint**

```bash
cd money-split-backend && npx eslint src/expenses/
```

Expected: no new error classes beyond the established pattern. The `no-unsafe-argument` warning that moved from `expenses.service.ts` to `lib/split-calculations.ts` in Task 1 stays there — unaffected by this task.

- [ ] **Step 12: Confirm the final shape of `expenses.service.ts`**

```bash
wc -l money-split-backend/src/expenses/expenses.service.ts
```

Expected: roughly 565 lines (down from 1328) — imports, constructor, and exactly 6 methods (`create`, `getGroupTransactions`, `updateExpense`, `deleteExpense`, `reverseExpenseEffects`, `applyExpenseEffects`).

- [ ] **Step 13: Commit**

```bash
cd money-split-backend
git add src/expenses/expenses-export.service.ts src/expenses/expenses-export.service.spec.ts src/expenses/expenses.service.ts src/expenses/expenses.service.spec.ts src/expenses/expenses.controller.ts src/expenses/expenses.module.ts
git commit -m "refactor: extract ExpensesExportService, remove temporary ExpensesBalancesService dependency from ExpensesService"
```

---

### Task 6: Final verification and submodule pointer sync

**Files:** none modified except the root repo's submodule pointer (Step 5).

**Interfaces:** None — this task only re-verifies everything Tasks 1-5 built and syncs the root repo.

- [ ] **Step 1: Run the full backend test suite one more time, from a clean state**

```bash
cd money-split-backend && npx jest --silent
```

Expected: `PASS` on every suite except the same 2 pre-existing, unrelated failures (`src/settlements/settlement.algo.spec.ts`, `src/auth/auth.controller.spec.ts`) — identical to the baseline documented in this plan's Global Constraints and in the design spec. Count the total test count and confirm it's the original count plus the 15 new `split-calculations.spec.ts` tests plus the 3 new `group-membership.service.spec.ts` tests (18 net-new tests; every other test is a relocation, not an addition).

- [ ] **Step 2: Typecheck one more time**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: 13 pre-existing errors (same baseline throughout this plan), none new.

- [ ] **Step 3: Lint one more time and record the final count**

```bash
cd money-split-backend && npx eslint src/expenses/
```

Expected: no error class beyond the established `@typescript-eslint/no-unsafe-*` family already present on every `mockPrisma`-style spec file in this codebase (now spread across more files: `expenses.service.spec.ts`, `expenses-balances.service.spec.ts`, `expenses-analytics.service.spec.ts`, `expenses-export.service.spec.ts`, `group-membership.service.spec.ts`), plus the one pre-existing `no-unsafe-argument` warning now living in `lib/split-calculations.ts`. Record the final total problem count in your report — per this plan's Global Constraints, it will differ from the original 206-problem baseline (more files means more independent instances of the same convention), and that's expected, not a regression.

- [ ] **Step 4: Confirm the controller's public contract is unchanged**

```bash
cd money-split-backend && git diff 8fc4e91 HEAD -- src/expenses/expenses.controller.ts
```

(Replace `8fc4e91` with the commit hash of the last pre-refactor state if different — the point is to diff against the state before Task 1 started.) Expected: every `@Get`/`@Post`/`@Patch`/`@Delete` decorator, route path string, `@Param`/`@Body`/`@Query`/`@Req`/`@Res`/`@Headers` parameter decorator, DTO type, response type annotation, and `@ApiOperation`/`@ApiResponse` call is unchanged — the diff should show only constructor parameter additions and handler *bodies* changing which injected field they call, never a signature, decorator, or route path.

- [ ] **Step 5: Sync the root repo's submodule pointer**

```bash
cd /Users/ducnguyen/code/money-split
git -C money-split-backend log --oneline -6
git add money-split-backend
git commit -m "chore: update submodule pointer to latest commit"
git status
```

Expected: the backend log shows, at the top, the 5 refactor commits from Tasks 1-5 (extract split-calculations, extract GroupMembershipService, extract ExpensesBalancesService, extract ExpensesAnalyticsService, extract ExpensesExportService); the root-repo commit succeeds; `git status` afterward shows a clean working tree with respect to the submodule pointer (other unrelated pre-existing local changes, if any, are untouched).

---
