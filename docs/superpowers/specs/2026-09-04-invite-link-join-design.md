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
- Special-casing the "already a member" `409 ConflictException` that `GroupsService.join()` already throws (`groups.service.ts:287`) — on `/join/:code` this surfaces as a plain error message on the confirmation/auto-join UI, exactly like `JoinGroupOverlay.tsx` already does today (it has no special-case handling for this either — `localError`/`error` just render the raw message). No new UX is invented for this case.
- Generating, copying, or displaying invite **links** anywhere in the app (e.g. a "copy link" button next to the existing invite-code pill in `GroupDetail.tsx`). This design only adds the destination page the link points to; producing/sharing the link itself (which is just `<frontend origin>/join/<code>`, computable from data the app already has) is out of scope and can be a trivial follow-up.
- Any backend change to how invite codes are generated, validated for format, or rotated.
- Rate limiting or abuse protection on the new public preview endpoint. It leaks no more than a group's name, currency, and member count to anyone holding (or guessing) an 8-char code — the same exposure `POST /groups/join` already has today for anyone willing to attempt a join (join also requires no prior membership check on the caller, just auth).
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

The lookup (`inviteCode.toUpperCase()` combined with `deletedAt: null` in the same `findUnique` where-clause) is copied verbatim from `join()` (`groups.service.ts:256-261`) so the two endpoints agree on exactly which codes resolve to a group. `_count: { select: { members: true } }` with no additional `deletedAt` filter on the `members` relation matches the existing unfiltered-count convention already used by `findAll()` (`groups.service.ts:76-79`) and `findOne()` (`groups.service.ts:127-131`) — this is a documented, consistent choice, not an oversight: `memberCount` may include soft-deleted (removed) members, same as those two existing counts do today.

`import { GroupInvitePreview } from './types/group-invite-preview.type';` is added to `groups.service.ts`'s imports.

### Controller route

Added to `money-split-backend/src/groups/groups.controller.ts` directly after `findAll()` (currently ending at line 68) and **before** `findOne()`'s `@Get(':id')` handler (currently starting at line 70). Route order matters here: Nest/Express match routes in registration order for the same HTTP method at the same path depth, so `preview/:inviteCode` must be registered before `:id`, otherwise a request to `/groups/preview/ABC12345` would be captured by `findOne()` with `id` bound to the literal string `"preview"`.

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

New imports added to `groups.controller.ts`: `import { Public } from '../common/decorators/public.decorator';` and `import { GroupInvitePreview } from './types/group-invite-preview.type';`.

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

Non-breaking confirmation: `JwtAuthGuard` is applied exclusively via `@UseGuards(JwtAuthGuard)` at controller-class level (confirmed by grep: it appears only in `groups.controller.ts`, `expenses.controller.ts`, and `settlements.controller.ts`'s import lists, and `main.ts` registers no global guard/`APP_GUARD`). For every route on every one of those controllers except the new `previewByInviteCode`, `context.getHandler()`/`context.getClass()` carry no `isPublic` metadata, so `getAllAndOverride` returns `undefined` (falsy), the `if (isPublic)` branch is skipped, and `super.canActivate(context)` runs exactly as it did before this change — identical behavior, zero regression risk for existing routes.

## Frontend: `/join/:code` page

### New page component

New file `money-split-app/src/components/auth/JoinInvite.tsx`, alongside `Login.tsx`, `AuthCallback.tsx`, and `JoinGroupOverlay.tsx` in the same `components/auth/` directory (matching this codebase's existing convention of grouping all auth-flow screens together) and named to parallel `AuthCallback.tsx` (a full-page route target, not an overlay).

State machine (local `useState`, no new Redux state — see the "New Redux thunk" section below for why the API call itself still goes through the existing thunk pattern):

```typescript
type Status = 'loading' | 'ready' | 'joining' | 'error';
```

- **`loading`** — initial state; the preview fetch is in flight.
- **`ready`** — preview succeeded; shows the confirmation card. Only entered when this is *not* a post-login auto-join visit (see below).
- **`joining`** — the `joinGroup` call is in flight (either from a manual click on `ready`, or automatically on a post-login return). Shown as a spinner, same visual language as `loading`.
- **`error`** — either the preview call or the join call failed. Renders the error message returned by the failed call (mirroring `JoinGroupOverlay.tsx`'s existing `localError || error` pattern) with a "Back to app" link.

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

Notes on this design, made explicit to avoid ambiguity:

- **Why `ready` is skipped entirely for a post-login auto-join return.** The preview promise's `.then()` branches *before* ever calling `setStatus('ready')`: if `autoJoin && isAuthenticated`, it calls `performJoin` directly (which sets `'joining'`), so the confirmation card is never rendered on that code path — satisfying "should NOT show the confirmation card again" exactly, with no flash of the card between `loading` and `joining`.
- **`joinGroup(code)` is called with the code exactly as it appears in the URL**, not force-uppercased on the frontend. The backend's `join()` (`groups.service.ts:258`) and the new `previewByInviteCode()` both call `.toUpperCase()` on their end, so case in the URL never matters — this mirrors `JoinGroupOverlay.tsx`, which *does* uppercase client-side (`code.trim().toUpperCase()`, line 23) only because it's normalizing free-text keyboard input; a code copied verbatim out of a URL doesn't need that client-side massaging (the referenced generation format is already always-uppercase, so the value already in the URL will already be uppercase whenever the link came from this app).
- **`errorMessage` can render inside the `ready` state, not just the `error` state.** This handles a manual "Join group" click failing (e.g. the code became invalid, or a genuine already-a-member conflict) while `preview` data is still valid and worth keeping on screen — the user stays on the confirmation card with the error shown below the subtitle, matching `JoinGroupOverlay.tsx`'s own pattern of showing an inline error without leaving the form. `performJoin`'s catch sets `status` to `'error'` only when triggered via the `autoJoin` path (there is no `preview` context worth preserving there, so the full-page error state is more appropriate); a manual click's failure is caught by the same `performJoin`, which currently always sets `'error'` — **resolved design choice:** `performJoin`'s `catch` always transitions to the shared `'error'` status regardless of trigger source, for one simple, uniform failure path with no branch on "how did we get here." The `error` screen's copy ("Invite link invalid") is generic enough to also read sensibly for a failed join attempt (e.g. "You are already a member of this group" or "Group not found" both fit under it), so no second error-rendering code path is introduced.

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
PREVIEW: (code: string) => `${API_BASE_URL}/groups/preview/${code}`,
```

### `lib/auth.ts` change: stashing the pending invite code

`money-split-app/src/lib/auth.ts` already centralizes every localStorage key this app uses for auth state (`TOKEN_KEY = 'splitmoney_auth_token'`, `USER_KEY = 'splitmoney_user'`) behind the `authUtils` object — grepping the whole frontend (`src/`) confirms these two keys, accessed only through `authUtils`, are the *only* existing localStorage/sessionStorage usage in the app; there is no existing sessionStorage usage anywhere to follow as precedent. The pending-invite-code stash follows the same key-naming convention and gets its own `authUtils` methods rather than being touched as a bare string literal from two different components:

```typescript
const PENDING_INVITE_KEY = 'splitmoney_pending_invite_code';
```

Added to `authUtils`, directly after the existing `clearUser` method:

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

**Why `localStorage`, and why a query param (not `sessionStorage`) signals the auto-join return — the concrete resolution of the "avoid double confirmation" mechanism:**

Two separate things need to survive the redirect to Google and back: (1) *which code to join*, and (2) *whether this particular page load should auto-join instead of showing the confirmation card*. This design uses two different, deliberately distinct mechanisms for those two questions:

1. **The code itself → `localStorage`, via `authUtils.setPendingInviteCode`/`getPendingInviteCode`/`clearPendingInviteCode`.** This must survive a full-page navigation to `accounts.google.com` and back (`window.location.href = API_ENDPOINTS.AUTH.GOOGLE`, the exact mechanism `Login.tsx`'s `handleGoogleLogin` already uses and that this design reuses unchanged) — `localStorage` is the only web storage this codebase already uses for exactly this kind of "must survive a full navigation, same origin" auth-flow data (the JWT token and user object are stashed the same way for the same reason). `sessionStorage` would very likely also survive an OAuth redirect in most browsers, but there is zero existing precedent for it anywhere in this codebase, and `localStorage` is both proven-safe here (the whole login flow already depends on it working across this exact redirect) and simpler (one storage mechanism for all auth-adjacent persisted values, not two).
2. **"Is this an auto-join return?" → a `?autoJoin=1` query parameter appended to the `/join/:code` URL by `AuthCallback.tsx` on that one redirect, not a second storage flag.** `AuthCallback.tsx` already reads its own query params via `useSearchParams()` (`AuthCallback.tsx:2,8,13`) — query params are this codebase's existing, established mechanism for the *destination page* to know something about *how it was navigated to*, whereas `localStorage` in this codebase is used for state that outlives a single navigation (the auth session itself). Using a query param here means `JoinInvite.tsx` doesn't need to read or clear a second piece of ad hoc storage at all — reading `searchParams.get('autoJoin')` is synchronous, requires no cleanup (the flag simply isn't present on a normal, non-auto-join visit to `/join/:code`), and can't leak stale state across visits the way a forgotten-to-clear storage flag could (e.g. a user bookmarking `/join/:code` while a stale flag from a previous visit is still sitting in storage). The invite *code* still needs `localStorage` because it must survive the entire external OAuth round-trip; the *auto-join intent* only needs to survive one internal `navigate()` call that `AuthCallback.tsx` itself performs, which a query param handles with no persistence at all.

This makes the full round-trip: `JoinInvite.tsx`'s "Sign in to join" → `authUtils.setPendingInviteCode(code)` → `window.location.href = API_ENDPOINTS.AUTH.GOOGLE` → Google OAuth → backend redirects to `/auth/callback?token=...` → `AuthCallback.tsx` sets credentials, reads and clears the pending code, then `navigate(`/join/${code}?autoJoin=1`)` → `JoinInvite.tsx` mounts fresh, sees `autoJoin=1` and `isAuthenticated === true`, and joins automatically without ever rendering the confirmation card.

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

                    const pendingInviteCode = authUtils.getPendingInviteCode();
                    if (pendingInviteCode) {
                        authUtils.clearPendingInviteCode();
                        navigate(`/join/${pendingInviteCode}?autoJoin=1`);
                    } else {
                        navigate('/');
                    }
```

No other line in `AuthCallback.tsx` changes: the token-decode logic, the `userData` validity check, both failure branches (`dispatch(setError(...)); navigate('/login');`), and the `finally` block are untouched. When there is no pending invite code (the overwhelming majority of logins), behavior is byte-for-byte identical to today.

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
    memberCount: number; // count of GroupMember rows for this group (unfiltered by deletedAt, same convention as the existing findAll()/findOne() _count usages)
  }
  ```
- **Failure response**: `404` with Nest's standard JSON error body (`{ statusCode: 404, message: 'Group with invite code "<code>" not found', error: 'Not Found' }`) when no non-deleted group has that invite code. No other failure mode exists for this endpoint (no auth failures possible; no validation beyond the Prisma lookup itself).
- **Side effects**: none. Does not create, modify, or touch any `GroupMember` row; does not require or check membership of the caller.
- **Frontend type**: `money-split-app/src/types/group.types.ts`'s `GroupInvitePreview`, structurally identical to the backend type above (this is the single contract both `money-split-backend/src/groups/types/group-invite-preview.type.ts` and the frontend type must match field-for-field).

## Testing

- **Backend** (`money-split-backend`):
  - `describe('previewByInviteCode', ...)` added to `money-split-backend/src/groups/groups.service.spec.ts`, following the file's existing mocked-`PrismaService` style (`mockPrisma` gains a `group: { findUnique: jest.fn() }` entry): a matching, non-deleted group returns `{ name, currency, memberCount }` built from the mocked `group._count.members`; a missing/deleted invite code (mocked `findUnique` resolving `null`) throws `NotFoundException`; the invite code passed to `prisma.group.findUnique` is asserted to be upper-cased regardless of the input case (e.g. calling with `'ab123456'` asserts the mock was called with `inviteCode: 'AB123456'`).
  - A small guard-level test (new `money-split-backend/src/auth/guards/jwt-auth.guard.spec.ts`, since none exists today): constructs `JwtAuthGuard` with a mocked `Reflector`, asserts `canActivate` returns `true` immediately (without invoking Passport's `super.canActivate`) when `reflector.getAllAndOverride` resolves truthy, and asserts it delegates to `AuthGuard('jwt')`'s own `canActivate` when the reflector resolves falsy/undefined — covering both the new bypass path and the untouched default path in isolation from any real controller/module wiring.
  - `npx tsc --noEmit` and the full `npx jest --silent` suite, matching every other backend task in this repo's plans.
- **Frontend** (`money-split-app`): no test runner exists in this project (confirmed: `package.json` scripts are only `dev`/`build`/`lint`/`preview`, no `jest`/`vitest`/`@testing-library/*` dependency), consistent with every prior plan in this repo. Verification is `npx tsc --noEmit`, `npx eslint <changed files>`, and manual/live-preview click-through covering:
  - Fresh (never-logged-in) browser session, visit `/join/<valid code>` directly: confirm the loading spinner appears then the confirmation card renders with the correct name/member count/currency and a "Sign in to join" button (not "Join group").
  - Click "Sign in to join": confirm redirect to Google, then after completing OAuth, landing back in the app already joined to the group, on `/group/:id/details`, with **no** intermediate confirmation card shown.
  - Already-authenticated session, not yet a member of the target group, visit `/join/<valid code>`: confirm the card shows "Join group"; click it and confirm navigation to `/group/:id/details` with the group now present in the sidebar/group list.
  - Visit `/join/<invalid or garbage code>`: confirm the error card renders with a "Back to app" link, both as a fresh (unauthenticated) visitor and as an authenticated one.
  - Already a member of the target group, click "Join group" again (or reload `/join/<code>` for a group already joined): confirm the resulting 409 error message renders inline without crashing the page.
  - Confirm `JoinGroupOverlay.tsx`'s manual-paste flow (from within the app, "Join Group" button) still works completely unchanged.
  - Confirm every pre-existing authenticated route (`/`, `/groups`, `/group/:id`, `/group/:id/details`) and the pre-existing `/login`/`/auth/callback` flow (a normal Google login with no pending invite code) are unaffected by the `App.tsx` routing change.
