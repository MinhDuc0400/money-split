# Invite Link Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shareable `/join/:code` frontend route that previews a group and joins it in one click — automatically completing the join after a Google sign-in round-trip when the visitor wasn't already authenticated — backed by a new, unauthenticated `GET /groups/preview/:inviteCode` endpoint.

**Architecture:** Backend: a new, reusable `@Public()` decorator (`SetMetadata` + `Reflector`) lets `JwtAuthGuard` skip its Passport check for exactly one route; `GroupsService.previewByInviteCode` reuses `join()`'s exact invite-code lookup pattern and returns only `{ name, currency, memberCount }`; `GroupsController` registers `GET preview/:inviteCode` before its existing `GET :id` route so Express's path matching doesn't swallow it. Frontend: a new `JoinInvite.tsx` page (in the existing `components/auth/` family alongside `Login.tsx`/`AuthCallback.tsx`/`JoinGroupOverlay.tsx`) drives a small `loading | ready | joining | error` state machine, calling `previewInvite`/`joinGroup` (both added to/reused from `useGroup()`); an invite code is stashed via new `authUtils` helpers across the Google OAuth redirect, and a `?autoJoin=1` query param (appended by `AuthCallback.tsx` on its post-login navigation) tells `JoinInvite.tsx` to complete the join automatically instead of showing the confirmation card again.

**Tech Stack:** Backend: NestJS 11, `@nestjs/passport`'s `AuthGuard`, `@nestjs/core`'s `Reflector` (no schema changes), Jest (TDD, mocked `PrismaService`). Frontend: React 19, React Router (`useParams`/`useSearchParams`), Redux Toolkit (`createAsyncThunk`, no new reducer cases), no new dependency.

## Global Constraints

- Repo paths are `money-split-backend/` and `money-split-app/` as git submodules under the `money-split/` root — each submodule is its own git repo; commits happen inside each submodule, then the root repo's submodule pointers are updated and committed separately as the final task, matching this repo's existing `chore: update submodule pointers to latest commits` commits.
- **Do not touch anything under `money-split-backend/src/expenses/`** — an unrelated in-progress refactor (`refactor/expenses-service-split` branch) owns that directory. This plan's backend work is entirely within `src/groups/`, `src/auth/`, and `src/common/`, a disjoint file set.
- **Endpoint contract** (binding for both backend and frontend tasks — see Task 2's and Task 3's Interfaces blocks for the full text): `GET /groups/preview/:inviteCode`, no auth required (`@Public()`), no query params. Success is `200` with JSON body `{ name: string; currency: string; memberCount: number }`. Failure is `404` with Nest's standard JSON error body when no non-deleted group has that invite code. No other failure mode exists (no auth failures possible).
- The invite-code lookup in `previewByInviteCode` must uppercase the code and filter `deletedAt: null` in the same `findUnique` where-clause, copied verbatim from `GroupsService.join()` (`groups.service.ts:256-261`), so both endpoints agree on which codes resolve to a group.
- `memberCount` is an **unfiltered** count of `GroupMember` rows (may include soft-deleted/removed members) — matching the existing unfiltered `_count` convention already used by `findAll()` and `findOne()` in `groups.service.ts`. This is a documented choice, not a bug.
- Route order matters: `GET preview/:inviteCode` must be registered in `GroupsController` **before** the existing `GET :id` handler, or a request to `/groups/preview/ABC12345` gets captured by `findOne()` with `id` bound to the literal string `"preview"`.
- `@Public()` is applied to exactly one route (`previewByInviteCode`) in this change. Every other route on `GroupsController`, `ExpensesController`, and `SettlementsController` is unannotated and keeps requiring auth via `JwtAuthGuard` exactly as it does today — this is additive and non-breaking, confirmed by the guard's fallback branch always running `super.canActivate(context)` when no `@Public()` metadata is present.
- The frontend preview thunk (`previewGroupByInviteCode`) gets **no `.addCase(pending/fulfilled/rejected)` reducers** — same "thunk with zero reducer cases" pattern already established by `exportGroupExpenses`. Its result is read via `.unwrap()` into the caller's own return value, never stored in `GroupState`.
- The invite code survives the Google OAuth redirect via **`localStorage`** (new `authUtils.setPendingInviteCode`/`getPendingInviteCode`/`clearPendingInviteCode`, key `splitmoney_pending_invite_code`) — the same mechanism already used for the JWT token and user object across that exact redirect. The "is this a post-login auto-join return" signal is a **`?autoJoin=1` query param** appended by `AuthCallback.tsx`'s `navigate()` call, not a second storage flag — `AuthCallback.tsx` already reads query params via `useSearchParams()`, and a query param needs no cleanup/leak handling the way a forgotten storage flag would.
- `JoinInvite.tsx`'s post-login auto-join path must **never render the confirmation (`ready`) card** — the preview promise's `.then()` branches directly into `performJoin` (setting `joining`) when `autoJoin && isAuthenticated`, skipping `ready` entirely, so there is no flash of the card between `loading` and `joining`.
- `/join/:code` must be reachable in `App.tsx` regardless of `isAuthenticated` — a new `isJoinPage` check is added alongside the existing `isAuthPage` check, exempting `/join/:code` from the "unauthenticated → redirect to `/login`" branch, but (unlike `isAuthPage`) **not** from being shown to an already-authenticated user.
- The "already a member" `409 ConflictException` from `joinGroup` is **not** special-cased — it surfaces as a plain error message on `JoinInvite.tsx`, exactly like `JoinGroupOverlay.tsx` already does today for the same error.
- Backend testing: Jest, TDD (RED then GREEN), mocked `PrismaService`. Frontend: no test runner exists in `money-split-app` (`package.json` scripts are only `dev`/`build`/`lint`/`preview`) — verification is `npx tsc --noEmit`, `npx eslint <changed files>`, and manual/live-preview click-through, consistent with every prior plan in this repo.

---

## File Structure

**Backend (`money-split-backend/`):**
- Create: `src/common/decorators/public.decorator.ts` — Task 1
- Modify: `src/auth/guards/jwt-auth.guard.ts` (check `@Public()` via `Reflector`) — Task 1
- Create: `src/auth/guards/jwt-auth.guard.spec.ts` — Task 1
- Create: `src/groups/types/group-invite-preview.type.ts` — Task 2
- Modify: `src/groups/groups.service.ts` (add `previewByInviteCode`) — Task 2
- Modify: `src/groups/groups.service.spec.ts` (add `describe('previewByInviteCode', ...)`) — Task 2
- Modify: `src/groups/groups.controller.ts` (add `GET preview/:inviteCode`) — Task 2

**Frontend (`money-split-app/`):**
- Modify: `src/types/group.types.ts` (add `GroupInvitePreview`) — Task 3
- Modify: `src/constants/api.constants.ts` (add `GROUPS.PREVIEW`) — Task 3
- Modify: `src/store/slices/groupSlice.ts` (add `previewGroupByInviteCode` thunk, no reducer cases) — Task 3
- Modify: `src/lib/auth.ts` (add pending-invite-code storage helpers) — Task 3
- Modify: `src/context/GroupContext.tsx` (add `previewInvite`) — Task 4
- Create: `src/components/auth/JoinInvite.tsx` — Task 4
- Modify: `src/components/auth/AuthCallback.tsx` (conditional post-login navigation) — Task 5
- Modify: `src/App.tsx` (new `isJoinPage` branch and route) — Task 5

**Root repo (`money-split/`):**
- Modify: `money-split-app` and `money-split-backend` submodule pointers — Task 6 (review/verification, runs after Tasks 1-5 are all complete)

---

### Task 1: Backend — `@Public()` decorator and `JwtAuthGuard` change

**Files:**
- Create: `money-split-backend/src/common/decorators/public.decorator.ts`
- Modify: `money-split-backend/src/auth/guards/jwt-auth.guard.ts`
- Create: `money-split-backend/src/auth/guards/jwt-auth.guard.spec.ts`

**Interfaces:**
- Produces: `Public(): MethodDecorator & ClassDecorator` and `IS_PUBLIC_KEY: string`, exported from `../common/decorators/public.decorator` (relative to `src/groups/`) / `../../common/decorators/public.decorator` (relative to `src/auth/guards/`). Task 2 imports `Public` from this exact path to annotate the new controller route.

- [ ] **Step 1: Write the failing guard test**

Create `money-split-backend/src/auth/guards/jwt-auth.guard.spec.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

describe('JwtAuthGuard', () => {
  const buildContext = (): ExecutionContext => {
    const handler = () => undefined;
    const klass = () => undefined;
    return {
      getHandler: () => handler,
      getClass: () => klass,
    } as unknown as ExecutionContext;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true immediately, without invoking the Passport check, when the route is marked @Public()', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const passportCanActivate = jest.spyOn(
      Object.getPrototypeOf(JwtAuthGuard.prototype) as {
        canActivate: (...args: unknown[]) => unknown;
      },
      'canActivate',
    );

    const context = buildContext();
    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('delegates to the default Passport JWT check when the route is not marked @Public()', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const passportCanActivate = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype) as {
          canActivate: (...args: unknown[]) => unknown;
        },
        'canActivate',
      )
      .mockReturnValue(true);

    const context = buildContext();
    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(passportCanActivate).toHaveBeenCalledWith(context);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd money-split-backend && npx jest jwt-auth.guard --silent
```

Expected: `FAIL` — `Cannot find module '../../common/decorators/public.decorator'` (and/or `JwtAuthGuard` constructor doesn't accept an argument yet — `new JwtAuthGuard(reflector)` calling a zero-arg constructor is still valid JS, so the more informative failure is the missing module).

- [ ] **Step 3: Create the `@Public()` decorator**

Create `money-split-backend/src/common/decorators/public.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 4: Update `JwtAuthGuard` to check it**

Replace the full contents of `money-split-backend/src/auth/guards/jwt-auth.guard.ts` (currently just `@Injectable() export class JwtAuthGuard extends AuthGuard('jwt') {}`) with:

```typescript
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
```

`Reflector` needs no explicit provider registration in any module — it is a core Nest provider injectable globally out of the box, and `JwtAuthGuard` is only ever instantiated via `@UseGuards(JwtAuthGuard)` at controller-class level (in `groups.controller.ts`, `expenses.controller.ts`, `settlements.controller.ts`), never via `APP_GUARD` — confirmed by grep of `main.ts` and every `*.module.ts`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd money-split-backend && npx jest jwt-auth.guard --silent
```

Expected: `PASS`, both tests.

- [ ] **Step 6: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Lint**

```bash
cd money-split-backend && npx eslint src/common/decorators/public.decorator.ts src/auth/guards/jwt-auth.guard.ts src/auth/guards/jwt-auth.guard.spec.ts
```

Expected: no new errors.

- [ ] **Step 8: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: `PASS`, same count as before plus the 2 new `JwtAuthGuard` tests. No pre-existing test regresses (every controller using `@UseGuards(JwtAuthGuard)` still requires auth exactly as before — this change is additive).

- [ ] **Step 9: Commit**

```bash
cd money-split-backend
git add src/common/decorators/public.decorator.ts src/auth/guards/jwt-auth.guard.ts src/auth/guards/jwt-auth.guard.spec.ts
git commit -m "feat: add reusable @Public() route decorator and wire it into JwtAuthGuard"
```

---

### Task 2: Backend — `GET /groups/preview/:inviteCode` endpoint

**Files:**
- Create: `money-split-backend/src/groups/types/group-invite-preview.type.ts`
- Modify: `money-split-backend/src/groups/groups.service.ts`
- Modify: `money-split-backend/src/groups/groups.service.spec.ts`
- Modify: `money-split-backend/src/groups/groups.controller.ts`

**Interfaces:**
- Consumes: `Public()` from Task 1 (`../common/decorators/public.decorator`, relative to `src/groups/groups.controller.ts`).
- Produces: `GroupsService.previewByInviteCode(inviteCode: string): Promise<GroupInvitePreview>`. `GET /groups/preview/:inviteCode` — **the full endpoint contract, binding for Task 3's frontend implementation**: no auth header required; no query params; success is `200` with JSON body `{ name: string; currency: string; memberCount: number }`; failure is `404` with Nest's standard JSON error body (`{ statusCode: 404, message: 'Group with invite code "<code>" not found', error: 'Not Found' }`) when no non-deleted group has that invite code.

- [ ] **Step 1: Write the failing service tests**

In `money-split-backend/src/groups/groups.service.spec.ts`, add a `group: { findUnique: jest.fn() }` entry to the existing `mockPrisma` object (currently lines 10-21), so it becomes:

```typescript
  const mockPrisma = {
    group: {
      findUnique: jest.fn(),
    },
    groupMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    memberBalance: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };
```

Add this new `describe` block directly after the closing `});` of the `describe('removeGuest', ...)` block (currently ends at line 231), before the file's final closing `});` (currently line 232):

```typescript
  describe('previewByInviteCode', () => {
    const inviteCode = 'AB123456';

    it('returns name, currency, and memberCount for a matching non-deleted group', async () => {
      mockPrisma.group.findUnique.mockResolvedValueOnce({
        id: 'group-1',
        name: 'Trip to Japan',
        currency: 'USD',
        _count: { members: 4 },
      });

      const result = await service.previewByInviteCode(inviteCode);

      expect(result).toEqual({
        name: 'Trip to Japan',
        currency: 'USD',
        memberCount: 4,
      });
    });

    it('uppercases the invite code before looking it up, regardless of input case', async () => {
      mockPrisma.group.findUnique.mockResolvedValueOnce({
        id: 'group-1',
        name: 'Trip to Japan',
        currency: 'USD',
        _count: { members: 1 },
      });

      await service.previewByInviteCode('ab123456');

      expect(mockPrisma.group.findUnique).toHaveBeenCalledWith({
        where: { inviteCode: 'AB123456', deletedAt: null },
        include: { _count: { select: { members: true } } },
      });
    });

    it('throws NotFoundException when no matching non-deleted group exists', async () => {
      mockPrisma.group.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.previewByInviteCode(inviteCode),
      ).rejects.toThrow(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd money-split-backend && npx jest groups.service --silent
```

Expected: `FAIL` — `service.previewByInviteCode is not a function`.

- [ ] **Step 3: Create the response type**

Create `money-split-backend/src/groups/types/group-invite-preview.type.ts`:

```typescript
export interface GroupInvitePreview {
  name: string;
  currency: string;
  memberCount: number;
}
```

- [ ] **Step 4: Implement `previewByInviteCode`**

In `money-split-backend/src/groups/groups.service.ts`, add this import directly after the existing `import { EventsGateway } from '../events/events.gateway';` line:

```typescript
import { GroupInvitePreview } from './types/group-invite-preview.type';
```

Add this method directly after `join()` (which currently ends at line 309), before the `assertActiveMember` private helper (currently starting at line 311):

```typescript
  /**
   * Read-only preview of a group by invite code, for the /join/:code
   * frontend page. Unlike join(), this does not require the caller to be
   * authenticated and never adds anyone to the group. Returns only
   * non-sensitive fields — no member list, no financial data.
   */
  async previewByInviteCode(inviteCode: string): Promise<GroupInvitePreview> {
    const group = await this.prisma.group.findUnique({
      where: {
        inviteCode: inviteCode.toUpperCase(),
        deletedAt: null,
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException(
        `Group with invite code "${inviteCode}" not found`,
      );
    }

    return {
      name: group.name,
      currency: group.currency,
      memberCount: group._count.members,
    };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd money-split-backend && npx jest groups.service --silent
```

Expected: `PASS`, all tests including the 3 new `previewByInviteCode` tests.

- [ ] **Step 6: Add the controller route**

In `money-split-backend/src/groups/groups.controller.ts`, add these two imports directly after the existing `import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';` line:

```typescript
import { Public } from '../common/decorators/public.decorator';
import { GroupInvitePreview } from './types/group-invite-preview.type';
```

Add this method directly after `findAll()` (currently ending at line 68) and **before** `findOne()`'s `@Get(':id')` handler (currently starting at line 70) — this ordering is required so `/groups/preview/ABC12345` isn't captured by `findOne()`'s `:id` param route:

```typescript
  @Public()
  @Get('preview/:inviteCode')
  @ApiOperation({ summary: 'Preview a group by invite code (no authentication required)' })
  @ApiResponse({ status: 200, description: 'Returns minimal, non-sensitive group info.' })
  @ApiResponse({ status: 404, description: 'Invite code not found.' })
  previewByInviteCode(
    @Param('inviteCode') inviteCode: string,
  ): Promise<GroupInvitePreview> {
    return this.groupsService.previewByInviteCode(inviteCode);
  }
```

- [ ] **Step 7: Typecheck**

```bash
cd money-split-backend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 8: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: `PASS`, same count as before this task, plus the 3 new `previewByInviteCode` service tests. No pre-existing test regresses.

- [ ] **Step 9: Lint**

```bash
cd money-split-backend && npx eslint src/groups/types/group-invite-preview.type.ts src/groups/groups.service.ts src/groups/groups.service.spec.ts src/groups/groups.controller.ts
```

Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
cd money-split-backend
git add src/groups/types/group-invite-preview.type.ts src/groups/groups.service.ts src/groups/groups.service.spec.ts src/groups/groups.controller.ts
git commit -m "feat: add GET /groups/preview/:inviteCode public preview endpoint"
```

---

### Task 3: Frontend — Types, API constant, Redux thunk, and pending-invite storage

**Files:**
- Modify: `money-split-app/src/types/group.types.ts`
- Modify: `money-split-app/src/constants/api.constants.ts`
- Modify: `money-split-app/src/store/slices/groupSlice.ts`
- Modify: `money-split-app/src/lib/auth.ts`

**Interfaces:**
- Consumes: `GET /groups/preview/:inviteCode` — **the full endpoint contract this task builds against (do not look at or wait on the backend implementation; this is the sole source of truth):**
  - Method/path: `GET {API_BASE_URL}/groups/preview/:inviteCode`.
  - Auth: none required. If an `Authorization` header is present anyway, it is ignored — `api.get`'s existing token-attachment logic needs no special-casing here.
  - Request body/query: none.
  - Success: `200`, JSON body `{ name: string; currency: string; memberCount: number }`.
  - Failure: standard Nest JSON error body (`{ statusCode, message, error }`), `404` when the code doesn't match any non-deleted group.
- Produces: `GroupInvitePreview` type (`money-split-app/src/types/group.types.ts`); `API_ENDPOINTS.GROUPS.PREVIEW(code: string): string`; `previewGroupByInviteCode(inviteCode: string): AsyncThunk` returning a `GroupInvitePreview`, with **no `.addCase` reducers**; `authUtils.setPendingInviteCode(code: string): void`, `authUtils.getPendingInviteCode(): string | null`, `authUtils.clearPendingInviteCode(): void`. Task 4 imports the thunk and type; Task 4 and Task 5 both use the `authUtils` methods.

- [ ] **Step 1: Add the `GroupInvitePreview` type**

In `money-split-app/src/types/group.types.ts`, add this directly after the existing `GroupMember` interface (currently ends at line 30):

```typescript
export interface GroupInvitePreview {
    name: string;
    currency: string;
    memberCount: number;
}
```

- [ ] **Step 2: Add the API endpoint constant**

In `money-split-app/src/constants/api.constants.ts`, add to the `GROUPS` object, directly after the existing `JOIN` entry (currently line 14):

```typescript
        PREVIEW: (code: string) => `${API_BASE_URL}/groups/preview/${code}`,
```

- [ ] **Step 3: Add the preview thunk**

In `money-split-app/src/store/slices/groupSlice.ts`, change the existing type-only import (currently line 2):

```typescript
import type { GroupMeta, GroupDetail, GroupMember } from '../../types/group.types';
```

to:

```typescript
import type { GroupMeta, GroupDetail, GroupMember, GroupInvitePreview } from '../../types/group.types';
```

Add this directly after the existing `joinGroup` thunk (currently lines 178-180) — no `.addCase` reducers are added for it, matching `exportGroupExpenses`'s existing zero-reducer-cases pattern (`groupSlice.ts:155-160`):

```typescript
export const previewGroupByInviteCode = createAsyncThunk('groups/previewByInviteCode', async (inviteCode: string) => {
    return await api.get<GroupInvitePreview>(API_ENDPOINTS.GROUPS.PREVIEW(inviteCode));
});
```

- [ ] **Step 4: Add pending-invite-code storage helpers**

In `money-split-app/src/lib/auth.ts`, add this constant directly after the existing `const USER_KEY = 'splitmoney_user';` line (currently line 4):

```typescript
const PENDING_INVITE_KEY = 'splitmoney_pending_invite_code';
```

Add these three methods to the `authUtils` object, directly after the existing `clearUser` method (currently lines 35-37):

```typescript
    setPendingInviteCode: (code: string) => {
        localStorage.setItem(PENDING_INVITE_KEY, code);
    },
    getPendingInviteCode: (): string | null => {
        return localStorage.getItem(PENDING_INVITE_KEY);
    },
    clearPendingInviteCode: () => {
        localStorage.removeItem(PENDING_INVITE_KEY);
    },
```

- [ ] **Step 5: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6: Lint**

```bash
cd money-split-app && npx eslint src/types/group.types.ts src/constants/api.constants.ts src/store/slices/groupSlice.ts src/lib/auth.ts
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
cd money-split-app
git add src/types/group.types.ts src/constants/api.constants.ts src/store/slices/groupSlice.ts src/lib/auth.ts
git commit -m "feat: add invite-preview type, thunk, API constant, and pending-invite storage helpers"
```

---

### Task 4: Frontend — `GroupContext.previewInvite` and the `JoinInvite.tsx` page

**Files:**
- Modify: `money-split-app/src/context/GroupContext.tsx`
- Create: `money-split-app/src/components/auth/JoinInvite.tsx`

**Interfaces:**
- Consumes: `previewGroupByInviteCode`, `GroupInvitePreview`, and `authUtils.setPendingInviteCode` from Task 3 (same submodule); existing `joinGroup: (code: string) => Promise<GroupMember>` already on `GroupContextType` (`GroupContext.tsx:57`, unchanged by this task); existing `GroupMember.groupId: string` field (`money-split-app/src/types/group.types.ts:22`).
- Produces: `useGroup().previewInvite: (code: string) => Promise<GroupInvitePreview>`; the `JoinInvite` React component (`export const JoinInvite: React.FC`), default page for the route `/join/:code`. Task 5 imports `JoinInvite` from `./components/auth/JoinInvite` in `App.tsx`.

- [ ] **Step 1: Add `previewInvite` to `GroupContext.tsx`**

In `money-split-app/src/context/GroupContext.tsx`, change the existing import (currently line 4):

```typescript
import { type GroupMeta, type GroupDetail, type GroupMember, type UserBalanceResponse, type GroupSettlement, type GroupBalancesResponse, type CreateSettlementRequest } from '../types/group.types';
```

to:

```typescript
import { type GroupMeta, type GroupDetail, type GroupMember, type GroupInvitePreview, type UserBalanceResponse, type GroupSettlement, type GroupBalancesResponse, type CreateSettlementRequest } from '../types/group.types';
```

Change the existing thunk import (currently line 11):

```typescript
import {
    fetchGroups, createGroup, updateGroupApi, deleteGroupApi, setActiveGroup, joinGroup, fetchGroupById, createExpense, updateExpense, deleteExpense, fetchTransactionsFirstPage, fetchUserBalance, fetchSettlements, fetchGroupBalances, fetchSpendingByCategory, createSettlement, fetchBalanceSummary, leaveGroupApi, addGuest, renameGuest, removeGuest
} from '../store/slices/groupSlice';
```

to:

```typescript
import {
    fetchGroups, createGroup, updateGroupApi, deleteGroupApi, setActiveGroup, joinGroup, previewGroupByInviteCode, fetchGroupById, createExpense, updateExpense, deleteExpense, fetchTransactionsFirstPage, fetchUserBalance, fetchSettlements, fetchGroupBalances, fetchSpendingByCategory, createSettlement, fetchBalanceSummary, leaveGroupApi, addGuest, renameGuest, removeGuest
} from '../store/slices/groupSlice';
```

In the `GroupContextType` interface, add this directly after the existing `joinGroup` line (currently line 57):

```typescript
    joinGroup: (code: string) => Promise<GroupMember>;
    previewInvite: (code: string) => Promise<GroupInvitePreview>;
```

Add this handler directly after `handleJoinGroup` (currently lines 183-187):

```typescript
    const handlePreviewInvite = useCallback(async (code: string) => {
        return await dispatch(previewGroupByInviteCode(code)).unwrap();
    }, [dispatch]);
```

In the provider's returned context value, add this directly after the existing `joinGroup: handleJoinGroup,` line (currently line 269):

```typescript
                joinGroup: handleJoinGroup,
                previewInvite: handlePreviewInvite,
```

- [ ] **Step 2: Typecheck (confirms the context wiring compiles before writing the page that consumes it)**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Create `JoinInvite.tsx`**

Create `money-split-app/src/components/auth/JoinInvite.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Users, XCircle } from 'lucide-react';
import { useGroup } from '../../context/GroupContext';
import { authUtils } from '../../lib/auth';
import { API_ENDPOINTS } from '../../constants';
import type { RootState } from '../../store';
import type { GroupInvitePreview } from '../../types/group.types';

type Status = 'loading' | 'ready' | 'joining' | 'error';

export const JoinInvite: React.FC = () => {
    const { code } = useParams<{ code: string }>();
    const [searchParams] = useSearchParams();
    const autoJoin = searchParams.get('autoJoin') === '1';
    const navigate = useNavigate();
    const { previewInvite, joinGroup } = useGroup();
    const { isAuthenticated } = useSelector((state: RootState) => state.auth);

    const [status, setStatus] = useState<Status>('loading');
    const [preview, setPreview] = useState<GroupInvitePreview | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const performJoin = useCallback(async (inviteCode: string) => {
        setStatus('joining');
        setErrorMessage(null);
        try {
            const member = await joinGroup(inviteCode);
            navigate(`/group/${member.groupId}/details`, { replace: true });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to join group. Please try again.';
            setErrorMessage(msg);
            setStatus('error');
        }
    }, [joinGroup, navigate]);

    useEffect(() => {
        if (!code) {
            setStatus('error');
            setErrorMessage('This invite link is invalid.');
            return;
        }

        let cancelled = false;
        setStatus('loading');

        previewInvite(code)
            .then((result) => {
                if (cancelled) return;
                setPreview(result);
                if (autoJoin && isAuthenticated) {
                    void performJoin(code);
                } else {
                    setStatus('ready');
                }
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : 'This invite link is invalid or has expired.';
                setErrorMessage(msg);
                setStatus('error');
            });

        return () => {
            cancelled = true;
        };
        // Runs once per `code` on mount / code change; autoJoin, isAuthenticated,
        // and performJoin are read at that moment and don't need to re-trigger it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code]);

    const handleJoinClick = () => {
        if (code) void performJoin(code);
    };

    const handleSignInToJoin = () => {
        if (code) authUtils.setPendingInviteCode(code);
        window.location.href = API_ENDPOINTS.AUTH.GOOGLE;
    };

    const NotNowLink = (
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Not now
        </Link>
    );

    if (status === 'loading' || status === 'joining') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center gap-6">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-muted-foreground animate-pulse">
                    {status === 'joining' ? 'Joining group…' : 'Loading invite…'}
                </p>
                {NotNowLink}
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
                <div className="bg-card p-8 rounded-2xl shadow-xl border border-border max-w-md w-full">
                    <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <XCircle className="w-8 h-8 text-destructive" />
                    </div>
                    <h1 className="text-xl font-bold mb-2">Invite link invalid</h1>
                    <p className="text-muted-foreground mb-8 text-sm">
                        {errorMessage || 'This invite link is invalid or has expired.'}
                    </p>
                    <Link
                        to="/"
                        className="inline-block w-full bg-primary text-primary-foreground font-semibold py-3 px-4 rounded-lg hover:bg-primary/90 transition-all active:scale-[0.98]"
                    >
                        Back to app
                    </Link>
                </div>
            </div>
        );
    }

    // status === 'ready'
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
            <div className="bg-card p-8 rounded-2xl shadow-xl border border-border max-w-md w-full">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Users className="w-8 h-8 text-primary" />
                </div>
                <h1 className="text-2xl font-bold mb-2">
                    You're invited to join <span className="text-primary">{preview?.name}</span>
                </h1>
                <p className="text-muted-foreground mb-8 text-sm">
                    {preview?.memberCount} member{preview?.memberCount === 1 ? '' : 's'} · {preview?.currency}
                </p>
                {errorMessage && (
                    <p className="text-sm text-destructive font-medium mb-4">{errorMessage}</p>
                )}
                <button
                    onClick={isAuthenticated ? handleJoinClick : handleSignInToJoin}
                    className="w-full bg-primary text-primary-foreground font-semibold py-3 px-4 rounded-lg hover:bg-primary/90 transition-all active:scale-[0.98]"
                >
                    {isAuthenticated ? 'Join group' : 'Sign in to join'}
                </button>
                <div className="mt-4">{NotNowLink}</div>
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Lint**

```bash
cd money-split-app && npx eslint src/context/GroupContext.tsx src/components/auth/JoinInvite.tsx
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
cd money-split-app
git add src/context/GroupContext.tsx src/components/auth/JoinInvite.tsx
git commit -m "feat: add JoinInvite page and GroupContext.previewInvite"
```

---

### Task 5: Frontend — `AuthCallback.tsx` auto-join navigation and `App.tsx` route registration

**Files:**
- Modify: `money-split-app/src/components/auth/AuthCallback.tsx`
- Modify: `money-split-app/src/App.tsx`

**Interfaces:**
- Consumes: `authUtils.getPendingInviteCode`/`clearPendingInviteCode` from Task 3; `JoinInvite` component from Task 4 (`./components/auth/JoinInvite`, relative to `App.tsx`).
- Produces: nothing consumed by another task — this is the last user-facing wiring. Task 6 (review) exercises the full round-trip via manual click-through.

- [ ] **Step 1: Update `AuthCallback.tsx`'s post-login navigation**

In `money-split-app/src/components/auth/AuthCallback.tsx`, change the success branch (currently lines 30-36):

```typescript
                    // Store in Redux
                    dispatch(setCredentials({ user, token }));

                    authUtils.setToken(token);
                    authUtils.setUser(user);

                    navigate('/');
```

to:

```typescript
                    // Store in Redux
                    dispatch(setCredentials({ user, token }));

                    authUtils.setToken(token);
                    authUtils.setUser(user);

                    const pendingInviteCode = authUtils.getPendingInviteCode();
                    if (pendingInviteCode) {
                        authUtils.clearPendingInviteCode();
                        navigate(`/join/${pendingInviteCode}?autoJoin=1`);
                    } else {
                        navigate('/');
                    }
```

No other line in this file changes: the token-decode logic, the `userData` validity check, both failure branches (`dispatch(setError(...)); navigate('/login');`), and the `finally` block are untouched.

- [ ] **Step 2: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Lint**

```bash
cd money-split-app && npx eslint src/components/auth/AuthCallback.tsx
```

Expected: no new errors.

- [ ] **Step 4: Commit the `AuthCallback.tsx` change**

```bash
cd money-split-app
git add src/components/auth/AuthCallback.tsx
git commit -m "feat: navigate to the pending invite after login instead of home"
```

- [ ] **Step 5: Add the `/join/:code` route to `App.tsx`**

In `money-split-app/src/App.tsx`, add this import directly after the existing `import { AuthCallback } from './components/auth/AuthCallback';` line (currently line 7):

```typescript
import { JoinInvite } from './components/auth/JoinInvite';
```

Change `AppInner`'s body (currently lines 25-70) from:

```typescript
function AppInner() {
    const location = useLocation();
    const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
    const handleOpenAddExpense = useCallback(() => setIsAddExpenseOpen(true), []);
    const handleCloseAddExpense = useCallback(() => setIsAddExpenseOpen(false), []);
    const { isAuthenticated } = useSelector((state: RootState) => state.auth);

    const isAuthPage = location.pathname === '/login' || location.pathname === '/auth/callback';

    if (!isAuthenticated && !isAuthPage) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (isAuthenticated && isAuthPage) {
        return <Navigate to="/" replace />;
    }

    if (isAuthPage) {
        return (
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
            </Routes>
        );
    }

    return (
        <Layout onAddExpense={handleOpenAddExpense}>
            <Suspense fallback={null}>
                <Routes>
                    <Route path="/" element={<GlobalDashboard />} />
                    <Route path="/groups" element={<MobileGroupList />} />
                    <Route path="/group/:id" element={<Dashboard />} />
                    <Route path="/group/:id/details" element={<GroupDetail />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
            {isAddExpenseOpen ? (
                <Suspense fallback={null}>
                    <AddExpense onClose={handleCloseAddExpense} />
                </Suspense>
            ) : null}
            <UndoToastContainer />
        </Layout>
    );
}
```

to:

```typescript
function AppInner() {
    const location = useLocation();
    const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
    const handleOpenAddExpense = useCallback(() => setIsAddExpenseOpen(true), []);
    const handleCloseAddExpense = useCallback(() => setIsAddExpenseOpen(false), []);
    const { isAuthenticated } = useSelector((state: RootState) => state.auth);

    const isAuthPage = location.pathname === '/login' || location.pathname === '/auth/callback';
    const isJoinPage = location.pathname.startsWith('/join/');

    if (!isAuthenticated && !isAuthPage && !isJoinPage) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (isAuthenticated && isAuthPage) {
        return <Navigate to="/" replace />;
    }

    if (isAuthPage) {
        return (
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
            </Routes>
        );
    }

    if (isJoinPage) {
        return (
            <Routes>
                <Route path="/join/:code" element={<JoinInvite />} />
            </Routes>
        );
    }

    return (
        <Layout onAddExpense={handleOpenAddExpense}>
            <Suspense fallback={null}>
                <Routes>
                    <Route path="/" element={<GlobalDashboard />} />
                    <Route path="/groups" element={<MobileGroupList />} />
                    <Route path="/group/:id" element={<Dashboard />} />
                    <Route path="/group/:id/details" element={<GroupDetail />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
            {isAddExpenseOpen ? (
                <Suspense fallback={null}>
                    <AddExpense onClose={handleCloseAddExpense} />
                </Suspense>
            ) : null}
            <UndoToastContainer />
        </Layout>
    );
}
```

Note: `isAuthenticated && isAuthPage` intentionally still checks only `isAuthPage`, not `isJoinPage` — an already-authenticated user must still be able to load `/join/:code` (that's the "already-logged-in user clicks a link for a group they're not yet in" case), so `/join/:code` must never be redirected away just because the user is authenticated, unlike `/login`/`/auth/callback` which should bounce an authenticated user straight to `/`.

- [ ] **Step 6: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Lint**

```bash
cd money-split-app && npx eslint src/App.tsx
```

Expected: no new errors.

- [ ] **Step 8: Manual verification via live preview**

Start the app (`preview_start` with the frontend and backend launch configs). Confirm:
- In a fresh/incognito session (no prior login), visiting `/join/<a real group's invite code>` shows a brief loading spinner, then a confirmation card with the correct group name, member count, and currency, and a "Sign in to join" button.
- Clicking "Sign in to join" redirects to Google; after completing sign-in, the browser lands on `/group/:id/details` for that group, having auto-joined — with **no** intermediate confirmation card shown along the way.
- In an already-authenticated session for a user not yet in that group, visiting `/join/<code>` shows "Join group"; clicking it navigates to `/group/:id/details` and the group now appears in the group list/sidebar.
- Visiting `/join/<a garbage/invalid code>` shows the "Invite link invalid" error card with a working "Back to app" link, both as a fresh and as an authenticated visitor.
- Visiting `/join/<code>` for a group the current user is already a member of, then clicking "Join group" again, shows the resulting error message inline without crashing.
- The existing "Join Group" overlay (paste-a-code flow, reached from within the app) still works unchanged.
- Every pre-existing route (`/`, `/groups`, `/group/:id`, `/group/:id/details`, `/login`, `/auth/callback` with a normal login and no pending invite code) still works exactly as before.

- [ ] **Step 9: Commit the `App.tsx` change**

```bash
cd money-split-app
git add src/App.tsx
git commit -m "feat: register /join/:code route reachable regardless of auth state"
```

---

### Task 6: Review and verification (run after Tasks 1-5 are all complete)

**Files:** none modified except the root repo's submodule pointers (final step).

**Interfaces:** None produced — this task only verifies Tasks 1-5's combined output and syncs submodule pointers. It assumes both the backend track (Tasks 1-2) and the frontend track (Tasks 3-5) have already been committed independently, by different workers if applicable, with no coordination beyond the endpoint contract fixed in Task 2/Task 3's Interfaces blocks.

- [ ] **Step 1: Verify both submodules are on their expected commits**

```bash
cd /Users/ducnguyen/code/money-split
git -C money-split-backend log --oneline -3
git -C money-split-app log --oneline -4
```

Expected: the backend log shows, at the top, the two commits from Tasks 1-2 (`feat: add GET /groups/preview/:inviteCode public preview endpoint` and `feat: add reusable @Public() route decorator and wire it into JwtAuthGuard`); the app log shows, at the top, the four commits from Tasks 3-5 (`feat: register /join/:code route reachable regardless of auth state`, `feat: navigate to the pending invite after login instead of home`, `feat: add JoinInvite page and GroupContext.previewInvite`, `feat: add invite-preview type, thunk, API constant, and pending-invite storage helpers`).

- [ ] **Step 2: Run the full backend test suite**

```bash
cd money-split-backend && npx jest --silent
```

Expected: `PASS`, including the 2 new `JwtAuthGuard` tests and the 3 new `previewByInviteCode` tests. No pre-existing test regresses.

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

This confirms the actual JSON the backend endpoint returns — with no `Authorization` header at all — matches exactly what Task 3's `previewGroupByInviteCode` thunk expects, without needing a full authenticated browser session. It creates its own test group directly via Prisma (using the local dev Postgres already configured in `money-split-backend/.env`'s `DATABASE_URL`), hits the live endpoint with no auth header, asserts on it, and cleans up all rows it created — including on failure.

Create `money-split-backend/scripts/verify-preview-endpoint.ts`:

```typescript
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

async function main() {
  const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter: pool });
  const suffix = randomUUID().slice(0, 8);
  let group: { id: string } | null = null;
  let user: { id: string } | null = null;

  try {
    user = await prisma.user.create({
      data: { email: `preview-verify-${suffix}@example.com`, name: 'Preview Verify' },
    });

    group = await prisma.group.create({
      data: {
        name: `Preview Verify ${suffix}`,
        inviteCode: `PVCODE${suffix}`.slice(0, 8).toUpperCase(),
        currency: 'EUR',
        createdBy: user.id,
      },
    });

    await prisma.groupMember.create({
      data: { groupId: group.id, userId: user.id, name: 'Preview Verify', role: 'OWNER' },
    });

    // Deliberately lower-cased in the request, to confirm server-side
    // upper-casing works over a real HTTP call, not just in the mocked unit test.
    const lowercaseCode = group.inviteCode.toLowerCase();
    const res = await fetch(
      `http://localhost:${process.env.PORT ?? 3000}/groups/preview/${lowercaseCode}`,
    );

    console.log('status:', res.status);
    const body = await res.json();
    console.log('body:', body);

    if (res.status !== 200) {
      throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    }
    if (body.name !== group.name || body.currency !== 'EUR' || body.memberCount !== 1) {
      throw new Error(`Unexpected response body: ${JSON.stringify(body)}`);
    }

    const notFoundRes = await fetch(
      `http://localhost:${process.env.PORT ?? 3000}/groups/preview/NOTREAL1`,
    );
    console.log('not-found status:', notFoundRes.status);
    if (notFoundRes.status !== 404) {
      throw new Error(`Expected 404 for an unknown code, got ${notFoundRes.status}`);
    }

    console.log('OK: preview endpoint returns the documented contract with no auth header, and 404s for an unknown code.');
  } finally {
    if (group) {
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
cd money-split-backend && npx ts-node scripts/verify-preview-endpoint.ts
```

Expected output ends with:

```
status: 200
body: { name: 'Preview Verify <suffix>', currency: 'EUR', memberCount: 1 }
not-found status: 404
OK: preview endpoint returns the documented contract with no auth header, and 404s for an unknown code.
```

If it prints `FAILED: ...` instead, stop and diagnose — this means the backend's actual response does not match the contract Task 3's frontend was built against, and the mismatch must be fixed in the backend submodule before proceeding (do not adjust the frontend to work around it; the contract in Task 2/3's Interfaces blocks is the source of truth).

Stop the dev server (`Ctrl+C` in its terminal) once the script prints `OK`.

- [ ] **Step 7: Delete the throwaway script**

```bash
cd money-split-backend && rm scripts/verify-preview-endpoint.ts
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
