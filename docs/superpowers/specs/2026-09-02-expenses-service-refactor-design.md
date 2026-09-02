# Expenses Service Refactor Design

## Context

`money-split-backend/src/expenses/expenses.service.ts` is 1328 lines with 19 methods (4 private pure-calculation helpers, 1 private membership-check helper, 2 private transactional-effect helpers, and 12 public methods spanning expense CRUD, transaction history, balances/settlements, spending analytics, and `.xlsx` export). Its companion test file, `expenses.service.spec.ts`, is 1102 lines. Both are too large to reason about, review, or navigate as a single unit — a change to, say, the analytics aggregation logic requires scrolling past unrelated balance-calculation and export code, and a test failure requires searching a 1100-line file to find the relevant `describe` block.

This design splits `ExpensesService` into five pieces along its existing natural seams — expense CRUD, group-membership authorization, balances/settlements, spending analytics, and `.xlsx` export — plus a standalone module of pure calculation functions. **This is a structural refactor only: no behavior, route, request/response shape, or business logic changes.** Every existing test must still pass, unmodified in its assertions, after being relocated to its new file.

This design was scoped through an already-completed brainstorming session with the user; the decisions below (which methods go where, the "tree-shakeable" pure-function requirement, byte-for-byte controller-contract preservation) were confirmed directly with the user and are not re-litigated here.

Two details not captured in the original brainstorming summary — a cross-service call dependency and a pre-existing behavioral asymmetry — were found during this design pass by reading the full current source (see "Notable findings" below) and are accounted for in the design.

## Goals

- Reduce `expenses.service.ts` from 1328 lines / 19 methods to roughly 565 lines / 6 methods (computed from the exact line ranges of the 6 methods that stay, plus imports/constructor — see the accounting table below), with the remaining 13 methods distributed across four new, independently-readable files, each scoped to one responsibility.
- Extract the four pure split/debt-calculation methods (`allocateByWeights`, `calculateDebtFlows`, `validatePayersTotal`, `calculateSplitData`) into plain exported functions in `src/expenses/lib/split-calculations.ts` — no class, no `this`, no `@Injectable()` — matching the existing convention already used by `toCents`/`fromCents` (`src/helpers/number.helper.ts`) and `calculateMinimalTransfers` (`src/settlements/settlement.algo.ts`). This makes them directly unit-testable and importable without instantiating any service.
- Extract the group-membership authorization check into a small, single-purpose `GroupMembershipService`, injected wherever `assertActiveMember` is currently called.
- Preserve the public HTTP API **exactly**: every route path, HTTP method, guard, DTO, response shape, and Swagger decorator on `ExpensesController` stays byte-for-byte identical. Only which injected service field a handler delegates to changes.
- Zero behavior change is the explicit success criterion: the full backend test suite has the same pass/fail count before and after (same pre-existing, unrelated failures in `settlement.algo.spec.ts` and `auth.controller.spec.ts`, untouched), and `tsc`/`eslint` show no new errors beyond the pre-existing baseline (verified fresh in this session — see "Baselines" below).
- Every one of the 19 original methods ends up in exactly one of the five destination files, verified by an explicit accounting table below.

## Non-goals

- **No unification with `src/settlements/`.** `SettlementsService`/`calculateMinimalTransfers` is a separate, newer settlement system (the Settle-All feature) with conceptual overlap with `ExpensesBalancesService.getSettlements`'s own minimal-transfer algorithm. This overlap was flagged during brainstorming as known, pre-existing duplication. The user did not ask to unify them, and doing so here would be unrelated scope creep well beyond a pure structural split. `src/settlements/` is not touched by this refactor at all.
- **No logic changes, bug fixes, or behavior improvements** to any extracted method, even where an inconsistency is visible in the current code (e.g. `getUserBalance` checks membership via an inline `find` + manual `ForbiddenException` rather than calling `assertActiveMember`, unlike every sibling method — see "Notable findings" below). This asymmetry is preserved verbatim, not "fixed," because fixing it would be a behavior change outside this refactor's scope.
- **No new test coverage requirements beyond what's cheap and directly enabled by this refactor.** Direct unit tests are added for the four newly-standalone pure functions (previously only exercised indirectly through `create`/`updateExpense`'s DTO-level tests) and for `GroupMembershipService.assertActiveMember` (previously only exercised indirectly through each public method's own "throws ForbiddenException when not an active member" test) — both are now trivially isolated and cheap to test directly. This refactor does **not** add new direct tests for `getBalances` or `getSettlements` themselves, which currently have no dedicated `describe` block and are exercised only indirectly via `exportExpenses`'s mocked flows — closing that gap is out of scope here.
- **No changes to `ExpensesModule`'s public export surface beyond what's structurally required.** Confirmed by grep: nothing outside `src/expenses/` imports `ExpensesService` directly (`app.module.ts` only imports `ExpensesModule`), so none of the four new services need to be exported from `ExpensesModule` for anything to keep working. They are added to `providers` only.
- **No changes to `src/expenses/interfaces/expense-calculation.interface.ts`.** Confirmed unused (no importers anywhere in `src/`) — a pre-existing dead file, left untouched as out-of-scope cleanup.
- **No touching `.env.docker.dev`** or other unrelated uncommitted changes visible in the working tree at design time.

## Current structure (baseline, as read in full this session)

`expenses.service.ts`, 1328 lines, 19 methods:

| # | Method | Lines | Kind |
|---|--------|-------|------|
| 1 | `allocateByWeights` | 43-67 | private, pure |
| 2 | `calculateDebtFlows` | 69-120 | private, pure |
| 3 | `validatePayersTotal` | 122-137 | private, pure |
| 4 | `calculateSplitData` | 139-244 | private, pure |
| 5 | `assertActiveMember` | 246-262 | private, async, Prisma |
| 6 | `create` | 264-376 | public, async |
| 7 | `getGroupTransactions` | 378-498 | public, async |
| 8 | `getSpendingByCategory` | 500-536 | public, async |
| 9 | `getSpendingByPerson` | 538-592 | public, async |
| 10 | `getSpendingByPersonCategory` | 594-662 | public, async |
| 11 | `getTopExpenses` | 664-707 | public, async |
| 12 | `exportExpenses` | 709-851 | public, async |
| 13 | `getBalances` | 853-908 | public, async |
| 14 | `getUserBalance` | 910-950 | public, async |
| 15 | `getSettlements` | 952-1035 | public, async |
| 16 | `updateExpense` | 1037-1162 | public, async |
| 17 | `deleteExpense` | 1164-1194 | public, async |
| 18 | `reverseExpenseEffects` | 1196-1266 | private, async, transactional |
| 19 | `applyExpenseEffects` | 1268-1327 | private, async, transactional |

Current constructor: `constructor(private prisma: PrismaService, private eventsGateway: EventsGateway) {}`.

`expenses.service.spec.ts`, 1102 lines, 8 `describe` blocks: `getUserBalance` (74-118), `create (idempotency wiring)` (120-174), `getSpendingByCategory` (176-300), `getSpendingByPerson` (302-444), `getSpendingByPersonCategory` (446-580), `getTopExpenses` (582-711), `exportExpenses` (713-1005), `updateExpense (category preserve-on-omit)` (1007-1101). Note this is **not** exhaustive per-method coverage — `getBalances`, `getSettlements`, `getGroupTransactions`, `deleteExpense`, and the four pure calculation methods have no dedicated `describe` block; some are exercised only indirectly (`getBalances`/`getSettlements` via `exportExpenses`'s mocks), others not at all in this file.

`expenses.controller.ts`, 277 lines, 12 handler methods, one constructor param (`expensesService: ExpensesService`), class-level `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` + `@ApiTags('expenses')` + `@Controller('groups/:groupId')`.

`expenses.module.ts`, 12 lines: `providers: [ExpensesService]`, `exports: [ExpensesService]`, `imports: [PrismaModule, EventsModule]`.

## Notable findings (not in the original brainstorming summary)

Two things surfaced while reading the full current source that materially affect the design and were not called out in the earlier session:

1. **`exportExpenses` calls `getBalances` and `getSettlements` internally** (lines 738-739), and the existing code comment there (lines 731-737) explicitly documents this as a deliberate simplicity-over-micro-optimization tradeoff: `getSettlements` re-calls `getBalances` and re-runs `assertActiveMember` a couple of extra times, accepted because the endpoint isn't a hot path. Since `exportExpenses` moves to `ExpensesExportService` while `getBalances`/`getSettlements` move to a **different** class, `ExpensesExportService`, **`ExpensesExportService` must inject `ExpensesBalancesService`** (in addition to `PrismaService` and `GroupMembershipService`) and call `this.balancesService.getBalances(...)` / `this.balancesService.getSettlements(...)` in place of the current same-class `this.getBalances(...)` / `this.getSettlements(...)`. This preserves the exact re-computation behavior the existing comment already documents as intentional — it is not a new behavior, just a routing change through an injected service instead of `this`.
2. **`getUserBalance` does not call `assertActiveMember`.** Unlike every other public method on `ExpensesService`, it performs its own inline membership check (`members.find((m) => m.userId === userId)`, throwing `ForbiddenException` directly at lines 919-921) rather than delegating to the shared helper. This asymmetry is preserved verbatim when `getUserBalance` moves into `ExpensesBalancesService` — it is **not** changed to call `GroupMembershipService.assertActiveMember` instead, because doing so would be a (probably harmless, but out-of-scope) behavior change. `ExpensesBalancesService` still injects `GroupMembershipService` because its other two methods (`getBalances` directly, `getSettlements` indirectly via `getBalances`) need it.

## Target structure

### 1. `src/expenses/lib/split-calculations.ts` (new)

Plain exported functions, moved verbatim (same logic, same parameter/return shapes, `this` removed, no `@Injectable()`):

```typescript
export function allocateByWeights(weights: number[], totalCents: number): number[]
export function calculateDebtFlows(
  payers: { memberId: string; amount: number }[],
  splits: { memberId: string; amountCents: number }[],
): DebtFlow[]
export function validatePayersTotal(
  payers: { amount: number }[],
  totalCents: number,
  amount: number,
): void
export function calculateSplitData(
  splitType: SplitType,
  totalCents: number,
  amount: number,
  splits: SplitInput[],
): SplitData[]
```

Imports needed: `BadRequestException` from `@nestjs/common` (used by `allocateByWeights`, `calculateSplitData`), `SplitType` from `@prisma/client`, `fromCents`/`toCents` from `../../helpers/number.helper`, `DebtFlow`/`SplitData`/`SplitInput` from `../types/expense-internal.types`.

Internal call graph, preserved as plain-function calls (no change in shape, just no `this.`): `calculateSplitData` calls `allocateByWeights` three times (EVEN case, PERCENTAGE case, SHARES case — currently lines 160, 203, 222). No other cross-calls among the four.

**Sole consumer:** `ExpensesService` (the piece that stays). `create` calls `validatePayersTotal` and `calculateSplitData`; `updateExpense` calls the same two; `applyExpenseEffects` and `reverseExpenseEffects` call `calculateDebtFlows`. No other new service needs anything from this module — none of `ExpensesBalancesService`, `ExpensesAnalyticsService`, `ExpensesExportService`, or `GroupMembershipService` reference any of these four functions in the current source.

### 2. `src/expenses/group-membership.service.ts` (new)

```typescript
@Injectable()
export class GroupMembershipService {
  constructor(private prisma: PrismaService) {}

  async assertActiveMember(groupId: string, userId: string) {
    // moved verbatim from ExpensesService, lines 247-262
  }
}
```

Return type and thrown exception (`ForbiddenException('You are not a member of this group')`) unchanged. Injected into `ExpensesService` (for `create`, `getGroupTransactions`, `updateExpense`, `deleteExpense`), `ExpensesBalancesService` (for `getBalances`; `getSettlements` gets the check transitively by calling `this.getBalances`), `ExpensesAnalyticsService` (for all four analytics methods), and `ExpensesExportService` (for `exportExpenses`). Every call site changes from `this.assertActiveMember(groupId, userId)` to `this.groupMembership.assertActiveMember(groupId, userId)`.

Exact call sites to update (10 total, all in the pieces that keep calling it — `getUserBalance` is deliberately excluded, see "Notable findings" #2):
- `ExpensesService.create` (currently line 271)
- `ExpensesService.getGroupTransactions` (currently line 384)
- `ExpensesService.updateExpense` (currently line 1044)
- `ExpensesService.deleteExpense` (currently line 1169)
- `ExpensesBalancesService.getBalances` (currently line 858)
- `ExpensesAnalyticsService.getSpendingByCategory` (currently line 507)
- `ExpensesAnalyticsService.getSpendingByPerson` (currently line 546)
- `ExpensesAnalyticsService.getSpendingByPersonCategory` (currently line 601)
- `ExpensesAnalyticsService.getTopExpenses` (currently line 672)
- `ExpensesExportService.exportExpenses` (currently line 713)

### 3. `src/expenses/expenses-balances.service.ts` (new)

```typescript
@Injectable()
export class ExpensesBalancesService {
  constructor(
    private prisma: PrismaService,
    private groupMembership: GroupMembershipService,
  ) {}

  async getBalances(groupId: string, userId: string): Promise<BalancesByCurrency>   // moved verbatim, lines 853-908
  async getUserBalance(groupId: string, userId: string): Promise<UserBalanceResponse> // moved verbatim, lines 910-950
  async getSettlements(groupId: string, userId: string): Promise<RecommendedSettlement[]> // moved verbatim, lines 952-1035
}
```

`getSettlements` calls `this.getBalances(groupId, userId)` (currently line 956) — unchanged, since both methods live on the same class after the move.

### 4. `src/expenses/expenses-analytics.service.ts` (new)

```typescript
@Injectable()
export class ExpensesAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private groupMembership: GroupMembershipService,
  ) {}

  async getSpendingByCategory(...): Promise<CategorySpending[]>       // moved verbatim, lines 500-536
  async getSpendingByPerson(...): Promise<PersonSpending[]>           // moved verbatim, lines 538-592
  async getSpendingByPersonCategory(...): Promise<PersonCategorySpending[]> // moved verbatim, lines 594-662
  async getTopExpenses(...): Promise<TopExpenseItem[]>                // moved verbatim, lines 664-707
}
```

Fully self-contained — no cross-service calls beyond `GroupMembershipService`.

### 5. `src/expenses/expenses-export.service.ts` (new)

```typescript
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
  ): Promise<{ buffer: Buffer; filename: string; filenameUtf8: string }>
  // moved verbatim, lines 709-851, with two call-site changes:
  //   this.getBalances(groupId, userId)    -> this.balancesService.getBalances(groupId, userId)     (was line 738)
  //   this.getSettlements(groupId, userId) -> this.balancesService.getSettlements(groupId, userId)   (was line 739)
  // and this.assertActiveMember -> this.groupMembership.assertActiveMember (was line 713)
}
```

Keeps its existing `import ExcelJS from 'exceljs';` and `import { buildExportFilename } from '../helpers/filename.helper';` — these don't move, `exportExpenses` just takes them with it into the new file. See "Notable findings" #1 for why `ExpensesBalancesService` is a required constructor dependency here, not just `PrismaService`/`GroupMembershipService` as originally scoped.

### 6. `expenses.service.ts` (shrinks to ~565 lines, 6 methods)

```typescript
@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private groupMembership: GroupMembershipService,
  ) {}

  async create(...): Promise<ExpenseResponse>                          // stays, lines 264-376
  async getGroupTransactions(...): Promise<PaginatedTransactionHistory> // stays, lines 378-498
  async updateExpense(...): Promise<ExpenseResponse>                   // stays, lines 1037-1162
  async deleteExpense(...): Promise<void>                              // stays, lines 1164-1194
  private async reverseExpenseEffects(...)                             // stays, lines 1196-1266
  private async applyExpenseEffects(...)                               // stays, lines 1268-1327
}
```

Imports: adds `import { GroupMembershipService } from './group-membership.service';` and `import { allocateByWeights, calculateDebtFlows, validatePayersTotal, calculateSplitData } from './lib/split-calculations';` (only `calculateDebtFlows`, `validatePayersTotal`, `calculateSplitData` are actually called directly by the methods that stay — `allocateByWeights` is only called from `calculateSplitData` itself, so `ExpensesService` does not need to import it directly). Drops `import ExcelJS from 'exceljs';` and `import { buildExportFilename } from '../helpers/filename.helper';` (no longer used here). Keeps `PrismaService`, `EventsGateway`, DTO imports, response-type imports actually still used by the 6 remaining methods (`ExpenseResponse`, `PaginatedTransactionHistory` only — the other response types in the current shared import block move to whichever new file uses them), `updateDebtAtomic`, `withIdempotency`, `fromCents`/`toCents`, `DebtFlow`/`ExpenseWithRelations`/`SplitData`/`SplitInput` (still needed by `reverseExpenseEffects`/`applyExpenseEffects`'s type annotations and `calculateDebtFlows` calls).

Call-site changes inside the 6 remaining methods: `this.assertActiveMember` → `this.groupMembership.assertActiveMember` (4 sites: `create` line 271, `getGroupTransactions` line 384, `updateExpense` line 1044, `deleteExpense` line 1169); `this.validatePayersTotal` → `validatePayersTotal` (2 sites: `create` line 275, `updateExpense` line 1075); `this.calculateSplitData` → `calculateSplitData` (2 sites: `create` line 278, `updateExpense` line 1076); `this.calculateDebtFlows` → `calculateDebtFlows` (2 sites: `applyExpenseEffects` line 1316, `reverseExpenseEffects` line 1254).

### Controller: `expenses.controller.ts`

Constructor changes from one param to four:

```typescript
constructor(
  private readonly expensesService: ExpensesService,
  private readonly expensesBalancesService: ExpensesBalancesService,
  private readonly expensesAnalyticsService: ExpensesAnalyticsService,
  private readonly expensesExportService: ExpensesExportService,
) {}
```

Every route path, HTTP method, `@Param`/`@Body`/`@Query`/`@Req`/`@Res`/`@Headers` decorator, DTO type, response type, and `@ApiOperation`/`@ApiResponse` stays byte-for-byte identical — only the body of each handler changes which injected field it delegates to:

| Route | Handler | Currently calls | After refactor calls |
|---|---|---|---|
| `POST expenses` | `create` | `expensesService.create` | unchanged |
| `PATCH expenses/:expenseId` | `update` | `expensesService.updateExpense` | unchanged |
| `DELETE expenses/:expenseId` | `remove` | `expensesService.deleteExpense` | unchanged |
| `GET transactions` | `getTransactions` | `expensesService.getGroupTransactions` | unchanged |
| `GET balances` | `getBalances` | `expensesService.getBalances` | `expensesBalancesService.getBalances` |
| `GET balances/me` | `getMyBalance` | `expensesService.getUserBalance` | `expensesBalancesService.getUserBalance` |
| `GET settlements` | `getSettlements` | `expensesService.getSettlements` | `expensesBalancesService.getSettlements` |
| `GET expenses/by-category` | `getSpendingByCategory` | `expensesService.getSpendingByCategory` | `expensesAnalyticsService.getSpendingByCategory` |
| `GET expenses/by-person` | `getSpendingByPerson` | `expensesService.getSpendingByPerson` | `expensesAnalyticsService.getSpendingByPerson` |
| `GET expenses/by-person-category` | `getSpendingByPersonCategory` | `expensesService.getSpendingByPersonCategory` | `expensesAnalyticsService.getSpendingByPersonCategory` |
| `GET expenses/top` | `getTopExpenses` | `expensesService.getTopExpenses` | `expensesAnalyticsService.getTopExpenses` |
| `GET expenses/export` | `exportExpenses` | `expensesService.exportExpenses` | `expensesExportService.exportExpenses` |

### Module: `expenses.module.ts`

```typescript
@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    ExpensesBalancesService,
    ExpensesAnalyticsService,
    ExpensesExportService,
    GroupMembershipService,
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}
```

`exports` stays `[ExpensesService]` only — confirmed via grep that nothing outside `src/expenses/` imports `ExpensesService` today (only `ExpensesModule` is imported by `app.module.ts`), so there is no functional need to export any of the four new providers. `imports` (`PrismaModule`, `EventsModule`) is unchanged — all new services only need `PrismaService`, already available via `PrismaModule`.

## Test split

`expenses.service.spec.ts` (1102 lines, 8 `describe` blocks) splits along the same lines as the production code:

| New/kept file | Content |
|---|---|
| `expenses.service.spec.ts` (slimmed) | `create (idempotency wiring)`, `updateExpense (category preserve-on-omit)` — the two blocks whose target method stays in `ExpensesService`. `mockEventsGateway` stays here (nothing else needs it). |
| `expenses-balances.service.spec.ts` (new) | `getUserBalance` — the only existing block for a method moving here. |
| `expenses-analytics.service.spec.ts` (new) | `getSpendingByCategory`, `getSpendingByPerson`, `getSpendingByPersonCategory`, `getTopExpenses`. |
| `expenses-export.service.spec.ts` (new) | `exportExpenses`. |
| `lib/split-calculations.spec.ts` (new) | New direct unit tests (none exist today) for `allocateByWeights`, `calculateDebtFlows`, `validatePayersTotal`, `calculateSplitData` — plain `describe('functionName', ...)` blocks per function, no `TestingModule`, no mocking, following `settlement.algo.spec.ts`'s exact convention (plain `import { fn } from './split-calculations';`, direct assertions). Covers at minimum: `allocateByWeights` largest-remainder distribution and the zero-total-weight `BadRequestException`; `calculateDebtFlows` basic 1-payer/1-splitter and multi-payer proportional-overlap cases; `validatePayersTotal` matching-total pass-through and mismatched-total `BadRequestException`; `calculateSplitData` one sub-case per `SplitType` (EVEN/EXACT/PERCENTAGE/SHARES) plus its invalid-input `BadRequestException`s. |
| `group-membership.service.spec.ts` (new) | New direct unit tests (none exist today as a dedicated block — currently only exercised indirectly via each public method's own "throws ForbiddenException" test) for `GroupMembershipService.assertActiveMember`: returns the member when active, throws `ForbiddenException` when no `GroupMember` row exists, throws `ForbiddenException` when the row's `deletedAt` is set. Standard `Test.createTestingModule` with a mocked `PrismaService` (`groupMember.findUnique`), following the existing per-service spec convention in this codebase. |

**Cross-cutting testing convention, applied uniformly to preserve identical assertions:** every new/slimmed spec file's `TestingModule` provides a **real** `GroupMembershipService` instance (constructed against the same mocked `PrismaService`), not a `jest.fn()`-mocked one — because the existing "throws `ForbiddenException` when not an active member" tests assert on the *real* `assertActiveMember` logic running against `mockPrisma.groupMember.findUnique`, and that behavior must be preserved identically post-split. The same applies to `expenses-export.service.spec.ts`: its `TestingModule` provides a **real** `ExpensesBalancesService` instance (not mocked), because the existing xlsx-content assertions (e.g. the "Balances"/"Settlement plan" summary-block row tests) depend on `getBalances`/`getSettlements`'s real computation running against mocked `PrismaService` data — mocking `ExpensesBalancesService` itself would require re-deriving those assertions from scratch, which is out of scope for a zero-behavior-change split.

Total describe-block accounting: 8 original blocks → 2 stay + 1 (`getUserBalance`) + 4 (analytics) + 1 (`exportExpenses`) = 8, all relocated, none dropped, none duplicated. Two new spec files (`lib/split-calculations.spec.ts`, `group-membership.service.spec.ts`) are net-new test coverage, not relocations.

## 19-method accounting (spec coverage check)

| Method | Destination |
|---|---|
| `allocateByWeights` | `lib/split-calculations.ts` |
| `calculateDebtFlows` | `lib/split-calculations.ts` |
| `validatePayersTotal` | `lib/split-calculations.ts` |
| `calculateSplitData` | `lib/split-calculations.ts` |
| `assertActiveMember` | `group-membership.service.ts` (as `GroupMembershipService.assertActiveMember`) |
| `create` | `expenses.service.ts` (stays) |
| `getGroupTransactions` | `expenses.service.ts` (stays) |
| `getSpendingByCategory` | `expenses-analytics.service.ts` |
| `getSpendingByPerson` | `expenses-analytics.service.ts` |
| `getSpendingByPersonCategory` | `expenses-analytics.service.ts` |
| `getTopExpenses` | `expenses-analytics.service.ts` |
| `exportExpenses` | `expenses-export.service.ts` |
| `getBalances` | `expenses-balances.service.ts` |
| `getUserBalance` | `expenses-balances.service.ts` |
| `getSettlements` | `expenses-balances.service.ts` |
| `updateExpense` | `expenses.service.ts` (stays) |
| `deleteExpense` | `expenses.service.ts` (stays) |
| `reverseExpenseEffects` | `expenses.service.ts` (stays, private) |
| `applyExpenseEffects` | `expenses.service.ts` (stays, private) |

19 methods in, 19 accounted for: 4 → `lib/split-calculations.ts`, 1 → `GroupMembershipService`, 3 → `ExpensesBalancesService`, 4 → `ExpensesAnalyticsService`, 1 → `ExpensesExportService`, 6 → `ExpensesService`.

## Baselines (verified fresh this session, HEAD as of design time)

- `npx tsc --noEmit` from `money-split-backend/`: **13 pre-existing errors**, none in production `expenses.service.ts`. Two are in `expenses.service.spec.ts` itself (`mockPrisma` implicit-any at line 18, an implicit-any-returning arrow function at line 51) — both from the untyped `mockPrisma` object literal pattern, which is a pre-existing, repo-wide convention also present verbatim in `groups.service.spec.ts` and `settlements.service.spec.ts` (confirmed by matching error text). The remaining 11 are entirely within `settlements.service.spec.ts`, unrelated to this refactor.
- **Splitting the `mockPrisma` pattern across multiple new spec files will very likely change the *exact* tsc error count**, even though it changes none of the *underlying* convention: each new spec file that declares its own `const mockPrisma = { ... }` object literal following the same established pattern will independently trigger the same two implicit-any diagnostics NestJS/TypeScript already flag on `expenses.service.spec.ts` today. This is expected and acceptable — it's the same accepted, repo-wide convention, just now instantiated in more places — but it means the plan's verification steps must recompute and state the exact expected new tsc error count after the test split (rather than assuming the original "13" holds unchanged), and confirm every additional error is one of these same two known diagnostics in a new-but-conventional location, not a novel error class.
- `npx eslint src/expenses/` from `money-split-backend/`: **206 problems (205 errors, 1 warning)** — all 205 errors are in `expenses.service.spec.ts` (the file-wide `@typescript-eslint/no-unsafe-*` family, from the same untyped-mock convention), the 1 warning is in `expenses.service.ts` line 161 (`no-unsafe-argument` inside `allocateByWeights`, which is moving to `lib/split-calculations.ts` — the warning moves with it, unchanged in kind). `expenses.controller.ts` and `expenses.module.ts` currently produce zero lint problems. As with tsc, splitting the spec file across multiple files following the same mock convention will likely change the exact per-file distribution and total count of these same errors without introducing a new error class — the plan's verification steps must recompute rather than assume.

## Out of scope (restated)

- `src/settlements/` (`SettlementsService`, `calculateMinimalTransfers`, `settlement.algo.ts`) — completely untouched.
- Any behavior, bug, or logic change to any moved method, including the `getUserBalance` membership-check asymmetry noted above.
- `src/expenses/interfaces/expense-calculation.interface.ts` — confirmed dead code, left as-is.
- Adding `getBalances`/`getSettlements` direct test coverage — genuinely missing today, not added here.
- Any frontend (`money-split-app`) change — this is a backend-only internal refactor with an unchanged public API.
