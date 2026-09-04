# Invite Link Join Design

## Context

Today, joining a group requires: get the 8-character invite code from someone → open the app → log in with Google → find and open the "Join Group" overlay (`money-split-app/src/components/auth/JoinGroupOverlay.tsx`) → manually type/paste the code into a text field, which then calls `useGroup().joinGroup(code)` (`money-split-app/src/context/GroupContext.tsx:183-187`, wrapping the `groups/join` thunk in `money-split-app/src/store/slices/groupSlice.ts:178-180`, which calls `POST /groups/join` on the backend). Invite codes are generated as 8-char uppercase hex (`crypto.createHash('sha256').update(id).digest('hex').substring(0, 8).toUpperCase()`, `money-split-backend/src/groups/groups.service.ts:26-31`) — fully URL-safe, no encoding concerns.

This design adds a shareable invite **link** (`/join/:code`) that skips the manual-paste step: opening the link previews the group and joins with one click, handling both the "already logged in" and "not yet logged in" cases. It reuses the existing `joinGroup` call exactly as-is and adds exactly one new read-only backend endpoint plus one new, genuinely reusable auth primitive (a `@Public()` route decorator — this codebase currently has no way to exempt a route from `JwtAuthGuard`, confirmed by reading `money-split-backend/src/auth/guards/jwt-auth.guard.ts` in full: it is a five-line class with no `canActivate` override, and grepping `src/auth/` and `src/common/` turns up no existing `IS_PUBLIC_KEY`/`@Public()`-style pattern).

The existing manual-paste flow (`JoinGroupOverlay.tsx`) is untouched — this is purely additive.

## Goals

- A user with a `/join/:CODE` link sees a preview of the group (name, currency, member count) before joining, whether or not they are logged in.
- One click joins the group if already authenticated ("Join group").
- One click starts Google sign-in if not authenticated ("Sign in to join"), and the join completes automatically after the OAuth round-trip returns to the app — no second confirmation click, and no re-typing/re-pasting of the code.
- An invalid or expired invite code shows a clear error state, both on first load and if it becomes invalid between confirming and finishing sign-in.
- `/join/:code` is reachable for a user who has never opened the app before (no session, no Redux state) and for an already-logged-in user who is not yet a member of that specific group.
- The new backend preview endpoint is read-only: it never adds the caller to the group and never requires the caller to already be a member.
- The new `@Public()` mechanism is additive and reusable: every other existing route keeps requiring auth exactly as it does today.

## Non-goals

- Any change to `JoinGroupOverlay.tsx`'s manual-paste flow, its UI, or its call into `joinGroup` — it keeps working exactly as it does today, unchanged.
- Special-casing the "already a member" `409 ConflictException` that `GroupsService.join()` already throws (`groups.service.ts:287`) — on `/join/:code` this surfaces as a plain error message with the server's raw text, not a custom "you're already in this group" screen, exactly like `JoinGroupOverlay.tsx` already does today (it has no special-case handling for this either — `localError`/`error` just render the raw message). Where that plain message appears (inline on the confirmation card for a manual click, or the full-page error state for an auto-join) follows the general manual-vs-auto error routing described under "Frontend: `/join/:code` page" below — no *additional* UX is invented specifically for the 409 case.
- Generating, copying, or displaying invite **links** anywhere in the app (e.g. a "copy link" button next to the existing invite-code pill in `GroupDetail.tsx`). This design only adds the destination page the link points to; producing/sharing the link itself (which is just `<frontend origin>/join/<code>`, computable from data the app already has) is out of scope and can be a trivial follow-up.
- Any backend change to how invite codes are generated, validated for format, or rotated.
- Rate limiting or abuse protection on the new public preview endpoint. This is a real tradeoff, stated honestly rather than papered over with a false equivalence: unlike `POST /groups/join`, which requires an authenticated account (an attributable caller, and a call that actually mutates state), the new preview endpoint is fully anonymous, side-effect-free, and freely repeatable — a materially better brute-force/probing oracle than anything else in this backend today, which has no rate-limiting/throttling infrastructure anywhere. Shipping without it anyway rests on three points: (1) invite codes are 8-character hex strings — 16^8 ≈ 4.3 billion possible values — making brute-forcing a specific or even *any* valid code impractical even fully unthrottled; (2) the only information disclosed (group name, currency, and an active-member count) is low-sensitivity and non-financial; (3) it is already effectively shared with anyone the group owner chooses to send the invite code/link to, since sharing it is the code's entire purpose. If this endpoint's response ever grows to include anything more sensitive, rate-limiting should be revisited then.
- A generic public-route allowlist/config mechanism. `@Public()` is added as a small, standard, reusable decorator + guard check; it is applied to exactly one route in this change.
- Any change to `AuthCallback.tsx`'s existing token-decode/credential-storage logic, or to its `/login` failure paths — only the final navigation target changes, conditionally.

## Backend: `GET /groups/preview/:inviteCode`

### New response type

New file `money-split-backend/src/groups/types/group-invite-preview.type.ts` (the `groups` module has no `types/` directory today — this follows the sibling convention already established in `src/expenses/types/expense-responses.type.ts` for the same purpose: a plain response-shape interface, not a Prisma model):

```typescript
export interface GroupInvitePreview {
  name: string;
  currency: string;
  memberCount: number;
}
```

Deliberately excludes: the group `id`, `inviteCode`, `createdBy`, member list, expenses, balances, or anything else — everything not needed to render "You're invited to join **{name}**" plus a light "N members · CURRENCY" subline.

### Service method

Added to `money-split-backend/src/groups/groups.service.ts` directly after `join()` (which currently ends at line 309), before the `assertActiveMember` private helper:

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
        select: { members: { where: { deletedAt: null } } },
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

The lookup (`inviteCode.toUpperCase()` combined with `deletedAt: null` in the same `findUnique` where-clause) is copied verbatim from `join()` (`groups.service.ts:256-261`) so the two endpoints agree on exactly which codes resolve to a group. `_count: { select: { members: { where: { deletedAt: null } } } }` is a Prisma 7 filtered count, excluding soft-deleted (removed) members. Note this deliberately diverges from `findAll()`'s own `_count` (`groups.service.ts:76-82`), which counts *all* `GroupMember` rows for a group with no `deletedAt` filter and would visibly overcount for a public preview shown to people who aren't members. It's consistent, however, with how `findOne()` treats members elsewhere in that same method: `findOne()` filters its own `members` include by `deletedAt: null` (`groups.service.ts:101-106`) — it just never turns that into a `_count`; its one `_count` counts `expenses`, not members (`groups.service.ts:127-131`). So there is no existing "unfiltered members count" precedent worth following here; a public-facing member count should reflect current, active membership, and the filtered form above does that.

`import { GroupInvitePreview } from './types/group-invite-preview.type';` is added to `groups.service.ts`'s imports.

### Controller route

Added to `money-split-backend/src/groups/groups.controller.ts` directly after `findAll()` (currently ending at line 68) and **before** `findOne()`'s `@Get(':id')` handler (currently starting at line 70). This ordering was checked against the project's actual Express version: `:id` only ever matches a single path segment, so a two-segment path like `/groups/preview/ABC12345` can never bind to `findOne()`'s `@Get(':id')` regardless of declaration order — there is no failure mode here to guard against. Declaring `preview/:inviteCode` before `:id` is still the conventional, tidy ordering (the controller already has a similar non-conflicting pair, `:id/leave` declared before `:id`), so it's followed here as hygiene, not correctness.

```typescript
@Public()
@ApiSecurity({})
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

New imports added to `groups.controller.ts`: `import { Public } from '../common/decorators/public.decorator';` and `import { GroupInvitePreview } from './types/group-invite-preview.type';`. The existing `@nestjs/swagger` import list also gains `ApiSecurity` (alongside `ApiTags`, `ApiOperation`, `ApiResponse`, `ApiBearerAuth`), becoming `import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';` — needed because `GroupsController` carries a class-level `@ApiBearerAuth()` (line 29), which would otherwise make the generated Swagger docs claim this route requires a bearer token even though it doesn't; `@ApiSecurity({})` overrides the security requirement to "none" for this one handler.

This is the only route in `GroupsController` that carries `@Public()`. Every other existing method (`create`, `join`, `findAll`, `findOne`, `update`, `leave`, `remove`, `addGuest`, `renameGuest`, `removeGuest`) is unannotated and keeps requiring auth via the controller's unchanged class-level `@UseGuards(JwtAuthGuard)` (line 31).

## Backend: the `@Public()` decorator and guard change

### New decorator

New file `money-split-backend/src/common/decorators/public.decorator.ts` (the `src/common/` directory today holds only `interfaces/request-user.interface.ts`, confirmed by listing it — this is the first file in a new `decorators/` subfolder there, a standard, conventional Nest layout):

```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### `JwtAuthGuard` change

`money-split-backend/src/auth/guards/jwt-auth.guard.ts` today is exactly:

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

It has no `canActivate` override, so it always falls through to Passport's default `AuthGuard('jwt')` behavior (validate the JWT via `JwtStrategy`, `src/auth/strategies/jwt.strategy.ts`, reject with 401 if missing/invalid). It becomes:

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

`Reflector` is a core Nest provider available for constructor injection in any class without explicit module registration (confirmed: `money-split-backend/src/auth/auth.module.ts` registers no `Reflector` provider anywhere in this codebase today, and none is needed — `@nestjs/core`'s `Reflector` is injectable globally out of the box). `getAllAndOverride` checks the handler (`context.getHandler()`, i.e. the specific method like `previewByInviteCode`) before the class (`context.getClass()`, i.e. `GroupsController`), so a route-level `@Public()` always wins; this codebase has no class-level `@Public()` usage today, only the one route-level use described above.

Non-breaking confirmation: `JwtAuthGuard` is applied exclusively via `@UseGuards(JwtAuthGuard)` at controller-class level (confirmed by grep across `src/`: it appears in five controllers — `groups.controller.ts`, `expenses.controller.ts`, `settlements.controller.ts`, `exchange-rates.controller.ts`, and `balances.controller.ts` — always as a class-level `@UseGuards(JwtAuthGuard)`, and `main.ts` registers no global guard/`APP_GUARD`). For every route on every one of those five controllers except the new `previewByInviteCode`, `context.getHandler()`/`context.getClass()` carry no `isPublic` metadata, so `getAllAndOverride` returns `undefined` (falsy), the `if (isPublic)` branch is skipped, and `super.canActivate(context)` runs exactly as it did before this change — identical behavior, zero regression risk for existing routes.

## Frontend: `/join/:code` page

### New page component

New file `money-split-app/src/components/auth/JoinInvite.tsx`, alongside `Login.tsx`, `AuthCallback.tsx`, and `JoinGroupOverlay.tsx` in the same `components/auth/` directory (matching this codebase's existing convention of grouping all auth-flow screens together) and named to parallel `AuthCallback.tsx` (a full-page route target, not an overlay).

State machine (local `useState`, no new Redux state — see the "New Redux thunk" section below for why the API call itself still goes through the existing thunk pattern):

```typescript
type Status = 'loading' | 'ready' | 'joining' | 'error';
```

- **`loading`** — initial state; the preview fetch is in flight.
- **`ready`** — preview succeeded; shows the confirmation card. Only entered when this is *not* a post-login auto-join visit (see below). Also re-entered after a **manual** join failure, with the error rendered inline on the same card (mirroring `JoinGroupOverlay.tsx`'s existing `localError || error` pattern) — see "Notes on this design" below for why manual and auto failures diverge.
- **`joining`** — the `joinGroup` call is in flight (either from a manual click on `ready`, or automatically on a post-login return). Shown as a spinner, same visual language as `loading`.
- **`error`** — a full-page state reached three ways: no `code` in the URL, the preview call failed (an unresolvable invite code), or an **auto**-join call failed (no card was ever shown on this visit to return to). Renders context-appropriate headline/message (see below) with a "Back to app" link.

A **"Not now"** link back to `/` is rendered in every one of these four states (it does not cancel an in-flight request, it just navigates away).

Full component:

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
// Which failure produced the full-page 'error' status — the two cases need
// different headline copy (see the 'error' render branch below).
type ErrorContext = 'invalid-link' | 'join-failed';

const DEFAULT_ERROR_MESSAGE: Record<ErrorContext, string> = {
    'invalid-link': 'This invite link is invalid or has expired.',
    'join-failed': 'We could not complete joining this group. Please try again.',
};

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
    const [errorContext, setErrorContext] = useState<ErrorContext>('invalid-link');

    const performJoin = useCallback(async (inviteCode: string, trigger: 'manual' | 'auto') => {
        setStatus('joining');
        setErrorMessage(null);
        try {
            const member = await joinGroup(inviteCode);
            navigate(`/group/${member.groupId}/details`, { replace: true });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : DEFAULT_ERROR_MESSAGE['join-failed'];
            setErrorMessage(msg);
            if (trigger === 'manual') {
                // Manual click from the confirmation card: preview data is
                // still valid, so stay on the card and show the error
                // inline — matching JoinGroupOverlay.tsx's existing pattern
                // of never blanking the form on a failed join.
                setStatus('ready');
            } else {
                // Auto-join after the OAuth round-trip: no card was ever
                // shown on this visit, so there's no card context to return
                // to — fall back to the full-page error state instead.
                setErrorContext('join-failed');
                setStatus('error');
            }
        }
    }, [joinGroup, navigate]);

    useEffect(() => {
        if (!code) {
            setErrorContext('invalid-link');
            setErrorMessage('This invite link is invalid.');
            setStatus('error');
            return;
        }

        let cancelled = false;
        setStatus('loading');

        previewInvite(code)
            .then((result) => {
                if (cancelled) return;
                setPreview(result);
                if (autoJoin && isAuthenticated) {
                    void performJoin(code, 'auto');
                } else {
                    setStatus('ready');
                }
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : DEFAULT_ERROR_MESSAGE['invalid-link'];
                setErrorContext('invalid-link');
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
        if (code) void performJoin(code, 'manual');
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
        const isJoinFailure = errorContext === 'join-failed';
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
                <div className="bg-card p-8 rounded-2xl shadow-xl border border-border max-w-md w-full">
                    <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <XCircle className="w-8 h-8 text-destructive" />
                    </div>
                    <h1 className="text-xl font-bold mb-2">
                        {isJoinFailure ? "Couldn't complete your join" : 'Invite link invalid'}
                    </h1>
                    <p className="text-muted-foreground mb-8 text-sm">
                        {errorMessage || DEFAULT_ERROR_MESSAGE[errorContext]}
                    </p>
                    <Link
                        to="/"
                        className="inline-block w-full bg-primary text-primary-foreground font-semibold py-3 px-4 rounded-lg hover:bg-primary/90 transition-all active:scale-[0.98]"
                    >
                        Back to app
                    </Link>
                    <div className="mt-4">{NotNowLink}</div>
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

Notes on this design, made explicit to avoid ambiguity:

- **Why `ready` is skipped entirely for a post-login auto-join return.** The preview promise's `.then()` branches *before* ever calling `setStatus('ready')`: if `autoJoin && isAuthenticated`, it calls `performJoin(code, 'auto')` directly (which sets `'joining'`), so the confirmation card is never rendered on that code path — satisfying "should NOT show the confirmation card again" exactly, with no flash of the card between `loading` and `joining`.
- **`joinGroup(code)` is called with the code exactly as it appears in the URL**, not force-uppercased on the frontend. The backend's `join()` (`groups.service.ts:258`) and the new `previewByInviteCode()` both call `.toUpperCase()` on their end, so case in the URL never matters — this mirrors `JoinGroupOverlay.tsx`, which *does* uppercase client-side (`code.trim().toUpperCase()`, line 23) only because it's normalizing free-text keyboard input; a code copied verbatim out of a URL doesn't need that client-side massaging (the referenced generation format is already always-uppercase, so the value already in the URL will already be uppercase whenever the link came from this app).
- **Manual join failures stay on the confirmation card; auto-join failures go to the full-page error state — and each gets error copy that fits.** `performJoin` now takes a `trigger: 'manual' | 'auto'` argument so its `catch` branch can tell the two cases apart, resolving what was previously a self-contradiction in this document (one passage said manual failures should keep the card with an inline error; another said the catch always transitions to `'error'` regardless of trigger, which would have made the `{errorMessage && ...}` block inside the `ready` branch dead code). The resolved behavior: a **manual** "Join group" click failing (e.g. the code became invalid, or a genuine already-a-member conflict) keeps `preview` on screen and returns to `'ready'` with `errorMessage` set, so the user stays on the confirmation card with the error shown inline below the subtitle and can retry — matching `JoinGroupOverlay.tsx`'s own pattern of never blanking the form on a failed join. An **auto** join failure (the post-OAuth-redirect path) has no card context to return to — no card was ever shown on this page visit — so it transitions to the full-page `'error'` status instead. Because the two failure modes now render through the same `'error'` branch as two different underlying causes (an unresolvable invite code vs. a valid, previewed invite whose join attempt itself failed), `errorContext` tracks which one occurred so the headline and default message are accurate for both: `"Invite link invalid"` when the code itself never resolved (missing `code` param, or the preview fetch's `404`), and `"Couldn't complete your join"` when the code was fine and the group was already confirmed but the join call failed (e.g. a transient network error, or the already-a-member `409`).

### `GroupContext.tsx` change

`useGroup()`'s `joinGroup` is reused exactly as-is (no change to `handleJoinGroup`, `groups.service.ts`'s `join()`, or the `groups/join` thunk). One new method, `previewInvite`, is added alongside it so `JoinInvite.tsx` accesses both group actions through the same `useGroup()` context every other component uses, rather than dispatching a thunk directly.

In `money-split-app/src/context/GroupContext.tsx`:

- Import line 11 gains `previewGroupByInviteCode`:
  ```typescript
  import {
      fetchGroups, createGroup, updateGroupApi, deleteGroupApi, setActiveGroup, joinGroup, previewGroupByInviteCode, fetchGroupById, createExpense, updateExpense, deleteExpense, fetchTransactionsFirstPage, fetchUserBalance, fetchSettlements, fetchGroupBalances, fetchSpendingByCategory, createSettlement, fetchBalanceSummary, leaveGroupApi, addGuest, renameGuest, removeGuest
  } from '../store/slices/groupSlice';
  ```
- `import { type GroupMeta, type GroupDetail, type GroupMember, type GroupInvitePreview, type UserBalanceResponse, type GroupSettlement, type GroupBalancesResponse, type CreateSettlementRequest } from '../types/group.types';` (adds `GroupInvitePreview` to the existing type-only import on line 4).
- `GroupContextType` interface gains, directly after the existing `joinGroup` line (57):
  ```typescript
  joinGroup: (code: string) => Promise<GroupMember>;
  previewInvite: (code: string) => Promise<GroupInvitePreview>;
  ```
- A new handler, directly after `handleJoinGroup` (`GroupContext.tsx:183-187`):
  ```typescript
  const handlePreviewInvite = useCallback(async (code: string) => {
      return await dispatch(previewGroupByInviteCode(code)).unwrap();
  }, [dispatch]);
  ```
- The provider's returned value gains `previewInvite: handlePreviewInvite,` directly after the existing `joinGroup: handleJoinGroup,` line (269).

### New Redux thunk

`money-split-app/src/store/slices/groupSlice.ts`, added directly after the existing `joinGroup` thunk (lines 178-180):

```typescript
export const previewGroupByInviteCode = createAsyncThunk('groups/previewByInviteCode', async (inviteCode: string) => {
    return await api.get<GroupInvitePreview>(API_ENDPOINTS.GROUPS.PREVIEW(inviteCode));
});
```

`GroupInvitePreview` is added to the existing `import type { GroupMeta, GroupDetail, GroupMember } from '../../types/group.types';` line (2), becoming `import type { GroupMeta, GroupDetail, GroupMember, GroupInvitePreview } from '../../types/group.types';`.

No `.addCase(previewGroupByInviteCode.pending/fulfilled/rejected, ...)` reducer cases are added — same "thunk with zero reducer cases" pattern already established by `exportGroupExpenses` (`groupSlice.ts:155-160`, added by the xlsx-export feature): the result is read directly via `.unwrap()` by the caller (`GroupContext.tsx`'s `handlePreviewInvite`) into that caller's own return value, not written into `GroupState`. This is deliberate: the preview is single-use, scoped to one page visit, and never needs to be read back from global state by any other component — storing it in `GroupState` would add a field nothing else reads.

`api.get` (not a new `requestBlob`-style helper) is reused unmodified — this endpoint returns plain JSON, exactly like every other `api.get` call in this codebase. `api.get` always attaches the `Authorization` header when a token exists (`money-split-app/src/lib/api.ts`), but the backend's `@Public()` route ignores it entirely (no guard runs), so this call works identically whether the visitor is authenticated or not — no conditional header logic is needed on the frontend.

### New type

`money-split-app/src/types/group.types.ts` gains, directly after the existing `GroupMember` interface (ends line 30):

```typescript
export interface GroupInvitePreview {
    name: string;
    currency: string;
    memberCount: number;
}
```

Field-for-field identical to the backend's `GroupInvitePreview` (`money-split-backend/src/groups/types/group-invite-preview.type.ts`) — see "Endpoint contract summary" below for the single source of truth both sides implement.

### New API endpoint constant

`money-split-app/src/constants/api.constants.ts`, added to `API_ENDPOINTS.GROUPS` directly after the existing `JOIN` entry (line 14):

```typescript
PREVIEW: (code: string) => `${API_BASE_URL}/groups/preview/${encodeURIComponent(code)}`,
```

`code` here originates from a third-party-controlled link (whatever landed in the URL's `:code` param), not from the API/database the way most other IDs interpolated elsewhere in this file do — so it's wrapped in `encodeURIComponent()` for defense in depth, even though the backend's own generation format (8-char uppercase hex) never actually needs escaping.

### `lib/auth.ts` change: stashing the pending invite code

`money-split-app/src/lib/auth.ts` already centralizes every localStorage key this app uses for auth state (`TOKEN_KEY = 'splitmoney_auth_token'`, `USER_KEY = 'splitmoney_user'`) behind the `authUtils` object — grepping the whole frontend (`src/`) confirms these two keys, accessed only through `authUtils`, are the *only* existing localStorage/sessionStorage usage in the app; there is no existing sessionStorage usage anywhere to follow as precedent. The pending-invite-code stash follows the same key-naming convention and gets its own `authUtils` methods rather than being touched as a bare string literal from two different components:

```typescript
const PENDING_INVITE_KEY = 'splitmoney_pending_invite_code';
// How long a stashed invite code stays valid across the OAuth round-trip.
// Long enough to cover "click sign-in, go through Google's consent screens,
// come back"; short enough that it can never survive to an unrelated later
// login (see the security rationale below).
const PENDING_INVITE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingInviteCodeEntry {
    code: string;
    ts: number; // Date.now() at the moment it was stashed
}
```

Added to `authUtils`, directly after the existing `clearUser` method:

```typescript
setPendingInviteCode: (code: string) => {
    const entry: PendingInviteCodeEntry = { code, ts: Date.now() };
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(entry));
},
getPendingInviteCode: (): string | null => {
    const raw = localStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;

    try {
        const entry = JSON.parse(raw) as Partial<PendingInviteCodeEntry>;
        const isWellFormed = typeof entry.code === 'string' && typeof entry.ts === 'number';
        const isExpired = !isWellFormed || Date.now() - entry.ts! > PENDING_INVITE_TTL_MS;

        if (isExpired) {
            // Malformed, or older than the TTL: treat exactly as if nothing
            // had ever been stashed, and clear it so it can't be read again.
            localStorage.removeItem(PENDING_INVITE_KEY);
            return null;
        }

        return entry.code!;
    } catch {
        localStorage.removeItem(PENDING_INVITE_KEY);
        return null;
    }
},
clearPendingInviteCode: () => {
    localStorage.removeItem(PENDING_INVITE_KEY);
},
```

**Why a timestamp and a TTL are part of the stored value — fixing a real security bug, not a defensive nicety.** An earlier version of this design stored the bare code string. That has a concrete, reachable problem: if a not-yet-authenticated user clicks "Sign in to join" (stashing the code) and then abandons the OAuth flow — closes the Google consent tab, changes their mind, anything — nothing ever clears the key. Weeks later, the same browser does a *completely unrelated* login, for a *different* reason entirely. `AuthCallback.tsx`'s post-login logic would find the stale code still sitting there, and because the auto-join path is deliberately designed to skip the confirmation card, it would silently join that user to the old group with **no confirmation shown at all** — and the backend's `emitMemberJoined` would broadcast the user's name/avatar to that group's members over websocket. That's a real privacy/security bug, not a hypothetical one, since the only thing guarding it before was "the user happens to log in again before ever revisiting `/join/:code`," which is not a safety property.

The fix: `setPendingInviteCode` now stores `{ code, ts }` instead of a bare string, and `getPendingInviteCode` enforces the TTL itself — any read that's missing, malformed, or older than `PENDING_INVITE_TTL_MS` (10 minutes) is treated as absent: the stale key is cleared and `null` is returned, exactly as if nothing had ever been stashed. Because the TTL check lives inside `getPendingInviteCode` itself, `AuthCallback.tsx`'s consuming code (below) needs no special-casing — it already does the right thing (`navigate('/')`) whenever `getPendingInviteCode()` returns `null`, which now includes "was here, but expired."

**Why `localStorage`, and why a query param (not `sessionStorage`) signals the auto-join return — the concrete resolution of the "avoid double confirmation" mechanism:**

Two separate things need to survive the redirect to Google and back: (1) *which code to join*, and (2) *whether this particular page load should auto-join instead of showing the confirmation card*. This design uses two different, deliberately distinct mechanisms for those two questions:

1. **The code itself → `localStorage`, via `authUtils.setPendingInviteCode`/`getPendingInviteCode`/`clearPendingInviteCode`, now carrying a timestamp and a 10-minute TTL as described above.** This must survive a full-page navigation to `accounts.google.com` and back (`window.location.href = API_ENDPOINTS.AUTH.GOOGLE`, the exact mechanism `Login.tsx`'s `handleGoogleLogin` already uses and that this design reuses unchanged) — `localStorage` is the only web storage this codebase already uses for exactly this kind of "must survive a full navigation, same origin" auth-flow data (the JWT token and user object are stashed the same way for the same reason). `sessionStorage` would very likely also survive an OAuth redirect in most browsers, but there is zero existing precedent for it anywhere in this codebase, and `localStorage` is both proven-safe here (the whole login flow already depends on it working across this exact redirect) and simpler (one storage mechanism for all auth-adjacent persisted values, not two). The TTL is what keeps `localStorage`'s indefinite persistence from becoming a liability.
2. **"Is this an auto-join return?" → a `?autoJoin=1` query parameter appended to the `/join/:code` URL by `AuthCallback.tsx` on that one redirect, not a second storage flag.** `AuthCallback.tsx` already reads its own query params via `useSearchParams()` (`AuthCallback.tsx:2,8,13`) — query params are this codebase's existing, established mechanism for the *destination page* to know something about *how it was navigated to*, whereas `localStorage` in this codebase is used for state that outlives a single navigation (the auth session itself). Using a query param here means `JoinInvite.tsx` doesn't need to read or clear a second piece of ad hoc storage at all — reading `searchParams.get('autoJoin')` is synchronous, requires no cleanup (the flag simply isn't present on a normal, non-auto-join visit to `/join/:code`), and can't leak stale state across visits the way a forgotten-to-clear storage flag could (e.g. a user bookmarking `/join/:code` while a stale flag from a previous visit is still sitting in storage). The invite *code* still needs `localStorage` because it must survive the entire external OAuth round-trip; the *auto-join intent* only needs to survive one internal `navigate()` call that `AuthCallback.tsx` itself performs, which a query param handles with no persistence at all.

This makes the full round-trip: `JoinInvite.tsx`'s "Sign in to join" → `authUtils.setPendingInviteCode(code)` (stashes `{ code, ts: Date.now() }`) → `window.location.href = API_ENDPOINTS.AUTH.GOOGLE` → Google OAuth → backend redirects to `/auth/callback?token=...` → `AuthCallback.tsx` sets credentials, reads the pending code (TTL-checked inside `getPendingInviteCode`) and clears it, then `navigate(`/join/${code}?autoJoin=1`, { replace: true })` → `JoinInvite.tsx` mounts fresh, sees `autoJoin=1` and `isAuthenticated === true`, and joins automatically without ever rendering the confirmation card. If the round-trip took longer than 10 minutes, or this is an unrelated login with a stale/no stashed code, `getPendingInviteCode()` returns `null` and `AuthCallback.tsx` falls through to `navigate('/')` exactly as it does today — no join, no confirmation, no surprise.

### `AuthCallback.tsx` change

`money-split-app/src/components/auth/AuthCallback.tsx`'s success branch (currently lines 30-36) changes from:

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

                    // getPendingInviteCode() already treats a missing,
                    // malformed, or expired (>10 min old) stash as absent —
                    // see lib/auth.ts — so this falls through to navigate('/')
                    // exactly as if no code had ever been stashed in those cases.
                    const pendingInviteCode = authUtils.getPendingInviteCode();
                    if (pendingInviteCode) {
                        authUtils.clearPendingInviteCode();
                        navigate(`/join/${pendingInviteCode}?autoJoin=1`, { replace: true });
                    } else {
                        navigate('/');
                    }
```

No other line in `AuthCallback.tsx` changes: the token-decode logic, the `userData` validity check, both failure branches (`dispatch(setError(...)); navigate('/login');`), and the `finally` block are untouched. When there is no pending invite code (the overwhelming majority of logins), behavior is byte-for-byte identical to today. `{ replace: true }` is added to the new navigation so the one-time `/auth/callback?token=...` URL (which carries a token that shouldn't be revisitable) doesn't linger in browser history.

### `App.tsx` route registration

`money-split-app/src/App.tsx` currently branches `AppInner()` into exactly two mutually-exclusive layouts based on `isAuthPage = location.pathname === '/login' || location.pathname === '/auth/callback'`: an unauthenticated user on a non-auth-page is redirected to `/login`; an authenticated user on an auth-page is redirected to `/`; an auth-page renders `Login`/`AuthCallback` with no `Layout` wrapper; everything else renders inside the authenticated `Layout` with its own nested `Routes`.

`/join/:code` needs to behave like a third category: reachable regardless of `isAuthenticated` (per the Goals above), and — like `Login`/`AuthCallback` — rendered standalone, without the authenticated app shell (`Layout`'s sidebar/nav), since an unauthenticated visitor has no group data for that shell to show and the page is a single self-contained card either way.

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

This final block is completely unchanged from today's `App.tsx` (`App.tsx:51-70`) — shown here in full only so the new `isJoinPage` branch's placement relative to it is unambiguous, not because anything inside it changes.

Notes:

- `isAuthenticated && isAuthPage` intentionally still only checks `isAuthPage`, **not** `isJoinPage` — an already-authenticated user must still be able to load `/join/:code` (that's the whole "already-logged-in user clicks a link for a group they're not yet in" case from the Goals), so `/join/:code` must never be redirected away just because the user is authenticated, unlike `/login`/`/auth/callback` which *should* bounce an authenticated user straight to `/`.
- The new `isJoinPage` branch is placed after the `isAuthPage` branch and before the final authenticated-`Layout` return, so its `<Routes>` block is reached by both an unauthenticated visitor (who would otherwise have been redirected to `/login` by the first `if`, were it not for the `&& !isJoinPage` exemption) and an authenticated one (who falls through the first two `if`s and the `isAuthPage` branch untouched).
- `JoinInvite` is imported eagerly at the top of `App.tsx`, alongside `Login` and `AuthCallback` (`import { JoinInvite } from './components/auth/JoinInvite';`) rather than via the `lazy()` pattern used for `Dashboard`/`GlobalDashboard`/`GroupDetail`/`AddExpense`/`MobileGroupList`. Those are lazily loaded because they only render *after* a user is already authenticated and inside the main app shell, where a brief `Suspense` fallback is acceptable mid-session. `/join/:code`, like `/login` and `/auth/callback`, is a first-paint entry point for a cold, unauthenticated visitor following a shared link — it should render immediately with the same eager-bundle treatment those two already get, not show a lazy-load flash before a user has any other context for what's loading.

## Endpoint contract summary (frontend/backend interface)

- **Method/path**: `GET /groups/preview/:inviteCode`
- **Auth**: none required — carries `@Public()`, bypassing `JwtAuthGuard` entirely. If an `Authorization` header is present anyway (e.g. an already-logged-in user), it is ignored; the response does not vary based on caller identity.
- **Path param**: `inviteCode` — matched case-insensitively (uppercased server-side before lookup, same as `POST /groups/join`).
- **Request body/query**: none.
- **Success response**: `200`, JSON body:
  ```typescript
  interface GroupInvitePreview {
    name: string;       // Group.name, verbatim
    currency: string;   // Group.currency, verbatim (e.g. "USD")
    memberCount: number; // count of active GroupMember rows for this group (filtered by deletedAt: null — soft-deleted/removed members are excluded)
  }
  ```
- **Failure response**: `404` with Nest's standard JSON error body (`{ statusCode: 404, message: 'Group with invite code "<code>" not found', error: 'Not Found' }`) when no non-deleted group has that invite code. No other failure mode exists for this endpoint (no auth failures possible; no validation beyond the Prisma lookup itself).
- **Side effects**: none. Does not create, modify, or touch any `GroupMember` row; does not require or check membership of the caller.
- **Frontend type**: `money-split-app/src/types/group.types.ts`'s `GroupInvitePreview`, structurally identical to the backend type above (this is the single contract both `money-split-backend/src/groups/types/group-invite-preview.type.ts` and the frontend type must match field-for-field).

## Testing

- **Backend** (`money-split-backend`):
  - `describe('previewByInviteCode', ...)` added to `money-split-backend/src/groups/groups.service.spec.ts`, following the file's existing mocked-`PrismaService` style (`mockPrisma` gains a `group: { findUnique: jest.fn() }` entry): a matching, non-deleted group returns `{ name, currency, memberCount }` built from the mocked `group._count.members`; a missing/deleted invite code (mocked `findUnique` resolving `null`) throws `NotFoundException`; the invite code passed to `prisma.group.findUnique` is asserted to be upper-cased regardless of the input case (e.g. calling with `'ab123456'` asserts the mock was called with `inviteCode: 'AB123456'`) and to use the filtered `_count: { select: { members: { where: { deletedAt: null } } } }` shape, not an unfiltered `members: true`.
  - A small guard-level test (new `money-split-backend/src/auth/guards/jwt-auth.guard.spec.ts`, since none exists today): constructs `JwtAuthGuard` with a mocked `Reflector`, asserts `canActivate` returns `true` immediately (without invoking Passport's `super.canActivate`) when `reflector.getAllAndOverride` resolves truthy, and asserts it delegates to `AuthGuard('jwt')`'s own `canActivate` when the reflector resolves falsy/undefined — covering both the new bypass path and the untouched default path in isolation from any real controller/module wiring.
  - `npx tsc --noEmit` and the full `npx jest --silent` suite, matching every other backend task in this repo's plans.
- **Frontend** (`money-split-app`): no test runner exists in this project (confirmed: `package.json` scripts are only `dev`/`build`/`lint`/`preview`, no `jest`/`vitest`/`@testing-library/*` dependency), consistent with every prior plan in this repo. This also means there is no automated test file to update for the new `authUtils` TTL logic — its correctness is verified via `npx tsc --noEmit` plus the manual/devtools checks below, alongside the rest of the click-through:
  - Fresh (never-logged-in) browser session, visit `/join/<valid code>` directly: confirm the loading spinner appears then the confirmation card renders with the correct name/member count/currency and a "Sign in to join" button (not "Join group").
  - Click "Sign in to join": confirm redirect to Google, then after completing OAuth, landing back in the app already joined to the group, on `/group/:id/details`, with **no** intermediate confirmation card shown, and that the `/auth/callback?token=...` URL is not reachable via the back button (`{ replace: true }` took effect).
  - Already-authenticated session, not yet a member of the target group, visit `/join/<valid code>`: confirm the card shows "Join group"; click it and confirm navigation to `/group/:id/details` with the group now present in the sidebar/group list.
  - Visit `/join/<invalid or garbage code>`: confirm the "Invite link invalid" error card renders with a "Back to app" link and a "Not now" link, both as a fresh (unauthenticated) visitor and as an authenticated one.
  - Already a member of the target group, click "Join group" again from the confirmation card (or reload `/join/<code>` for a group already joined and click "Join group"): confirm the resulting 409 error message renders **inline on the same confirmation card**, not as a full-page error, and that the card remains usable (retry, or "Not now").
  - Force an auto-join failure (e.g. temporarily stop the backend after the preview call succeeds but before the join call, or reuse a pending code for a group the user is already in and let the auto-join path hit the 409): confirm the full-page error state renders with the **join-failure** headline ("Couldn't complete your join"), not the "Invite link invalid" headline.
  - Stale pending invite code, via browser devtools: after `authUtils.setPendingInviteCode('SOMECODE')` has run once, edit the stored value in `localStorage` (key `splitmoney_pending_invite_code`) to set `ts` to more than 10 minutes in the past (or set the whole value to malformed JSON), then complete a normal, unrelated Google login. Confirm the login lands on `/` with no join, no confirmation card, and no `emitMemberJoined` traffic — exactly as if no code had ever been stashed. Also confirm the un-expired (fresh `ts`) case still auto-joins as expected.
  - Confirm `JoinGroupOverlay.tsx`'s manual-paste flow (from within the app, "Join Group" button) still works completely unchanged.
  - Confirm every pre-existing authenticated route (`/`, `/groups`, `/group/:id`, `/group/:id/details`) and the pre-existing `/login`/`/auth/callback` flow (a normal Google login with no pending invite code) are unaffected by the `App.tsx` routing change.
