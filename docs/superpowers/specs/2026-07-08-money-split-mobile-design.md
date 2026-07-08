# money-split Mobile — Design Spec

Date: 2026-07-08
Status: Approved for planning

## 1. Vision & Scope

A React Native + Expo companion app to the existing `money-split-app` web frontend — same product (expense-splitting for small trusted groups), different platform. The previous `money-split-mobile` attempt (10+ commits, GitHub repo `MinhDuc0400/money-split-mobile`) was deleted; this is a clean-slate rebuild.

This is a **personal/portfolio project**, not a commercial venture. No monetization pressure. Priorities: technical depth, polish, and real usability with friends/family — not growth metrics.

Decided constraints (not open for reconsideration in this spec):
- Platform: **React Native + Expo**
- Scope: **MVP first**, full parity with web in later phases
- Backend: existing NestJS + Prisma + PostgreSQL REST + WebSocket API — no backend changes assumed unless explicitly flagged as a risk

## 2. Target Users & Business Positioning

**Personas:**
- Roommates — recurring shared costs, long-lived groups, care about running balances.
- Trip/travel groups — bursty expense entry, often on unreliable connectivity, need fast mobile entry.
- Friend circles — ad hoc groups, dinners/gifts/subscriptions, often include guest participants.

**Demo scenarios (portfolio material):**
1. **Weekend trip** — create group, add a guest member, log 6-8 expenses across all four split types, show the settlement plan collapse to minimal payments. Richest single demo.
2. **Real-time multiplayer** — two devices (or a device + the web app) on the same group; add an expense on one, watch it appear live on the other with no refresh. Strongest "wow" moment for a technical reviewer.
3. **Roommates settle up** — ongoing group, balance history, single debt settle vs. settle-all bulk action.

**Portfolio positioning — what to prioritize, ranked:**
1. **Real-time sync done well** — the single most differentiating technical feature vs. a typical CRUD portfolio project. Backend already has a Redis-backed Socket.IO gateway; reusing it on mobile is high leverage.
2. **Correct, non-trivial split logic** — percentage/shares/exact splits with proper rounding, and a debt-simplification settlement algorithm (already implemented server-side). Surface this clearly in the UI.
3. **Native mobile UX polish** — gesture-appropriate flows, platform-native navigation, custom numeric keypad.
4. **Offline resilience** — even a modest version (network-error states, reconnect handling) is disproportionately impressive since most portfolio CRUD apps assume perfect connectivity.
5. **Cross-platform code/architecture quality** — shared patterns with the backend/web, sensible state management, clean structure.

De-prioritize: anything reading as growth/monetization plumbing (analytics dashboards, paywalls) — irrelevant to this project's goals.

## 3. MVP Feature Scope

| Ships in MVP | Rationale |
|---|---|
| Google OAuth login | Reuses existing backend auth (`/auth/google/mobile`), table stakes |
| Join group via invite code (manual entry, login required) | **Revised from initial business draft** — see §3.1 below |
| Create/view groups, member management (add/remove, add guest) | Core loop |
| Add expense — full flow: amount, payer(s) single/multiple, all 4 split types (even/exact/percentage/shares) | Strongest differentiator; backend already supports all four |
| Edit/delete expense | Real usability — mistakes happen |
| Balance view (per-member) | Core value proposition |
| Settlement plan (who owes whom, minimized) | Showcases the settlement algorithm |
| Settle up (single) + settle all | Completes the expense lifecycle |
| **Real-time WebSocket updates** | Headline portfolio differentiator — must be in MVP, not deferred |
| Basic history/activity list | Cheap, makes the app feel finished |
| Dark mode | Low cost, expected baseline polish |

**Deferred to later phases:**
- Offline-first / full local persistence + conflict resolution (high complexity, better as a deliberate Phase 2/4 story)
- Push notifications (needs APNs/FCM + backend notification service)
- True unauthenticated guest-join-via-link (see §3.1 — needs new backend work)
- Multi-currency (not on web either; needs backend FX support)
- Group customization beyond member management (avatars, categories, recurring expenses)
- Advanced roles/permissions (backend only models OWNER/MEMBER today)
- Receipt photo attachment / OCR
- In-app export/reports

### 3.1 Guest-join-via-link — resolved gap

The original business framing assumed "guest join via invite link" (tap a link, join instantly, no login) as an MVP feature, central to the "weekend trip" demo. Reading the actual code surfaced that **this doesn't exist on web or backend today**:
- `InvitationBox.tsx` shows a raw 8-character code, not a shareable URL.
- `POST /groups/join` requires the user to already be authenticated (`JwtAuthGuard`).
- "Guests" (`POST /groups/:id/guests`) are added *by* an existing member from inside the app, not self-joined.

**Decision: MVP mobile matches web as-is.** Deep-link support (`money-split://join/[code]`) prefills the invite-code field, but joining still requires login and manual code confirmation — same UX as web today. True frictionless guest join becomes a Phase 2 item requiring a new backend endpoint (public join-preview + relaxed guest-session issuance). Do not build backend scope into this mobile-only effort.

## 4. Success Criteria (MVP "done" bar)

Demo-readiness and usability, not analytics:
- The "weekend trip" scenario runs clean, twice in a row, in under 5 minutes, without a developer narrating around bugs.
- Real-time sync is provably instant: two clients reflect the same group state within ~1 second of a change, verified side-by-side.
- All four split types produce mathematically correct results including cent-rounding edge cases (e.g. splitting $10.01 three ways).
- No dead-end states — every screen has a way forward/back, no crashes on empty states.
- MVP feature table above is 100% functional on a real physical device, not just simulator.
- Navigation/gestures/input feel like a purpose-built mobile app, not "web app in a WebView."
- Dark mode has no visual bugs (contrast, readability) across all MVP screens.
- A cold install → login → join/create group → add expense → see balance update flow works for someone who has never seen the app before.

## 5. Phasing Roadmap

**Phase 2 — Reach & Resilience**
- Push notifications (new expense, settled up, invited to group)
- Minimal offline: optimistic local writes + sync queue + "pending sync" UI state
- True unauthenticated guest-join-via-link (requires new backend endpoint)
- Multi-payer/split-type UX refinements from real usage

**Phase 3 — Full Parity + Depth**
- Remaining feature-parity gaps vs. web
- Recurring expenses
- Expense categories/tags + lightweight in-app spending breakdown (e.g. category pie chart)
- Receipt photo attachment

**Phase 4 (stretch)**
- Full offline-first with conflict resolution
- Native platform widgets (iOS/Android home-screen "you're owed $X")
- Multi-currency (needs coordinated backend + web + mobile work)

## 6. Design System

### 6.1 Visual Identity

Philosophy: calm and trustworthy (banking-app register — Monzo/Wise/N26), not gamified. Saturated reds/greens only as accents on numbers, never backgrounds.

| Role | Light | Dark | Notes |
|---|---|---|---|
| Primary | `#3D5AFE` | `#7C93FF` | Confident cool blue — avoids Splitwise-green collision |
| Primary Dark (pressed) | `#2540C9` | `#5A75E0` | |
| Secondary/Accent | `#00BFA6` | `#3ED9C0` | Add-Expense FAB, success confirmations |
| "You are owed" | `#12A454` | `#4ADE80` | Muted forest green |
| "You owe" | `#E5484D` | `#F87171` | Warm, slightly desaturated red |
| "Settled" | `#8A93A6` | `#9CA6BC` | $0 balances |
| Background | `#F7F8FA` | `#0F1218` | Off-white/off-black, never pure |
| Surface (cards) | `#FFFFFF` | `#1A1F29` | |
| Surface Raised (modals) | `#FFFFFF` | `#232937` | |
| Border/Divider | `#E4E7EC` | `#2A3142` | |
| Text Primary | `#111827` | `#F3F4F6` | |
| Text Secondary | `#6B7280` | `#9CA3AF` | |
| Text Disabled | `#C1C7D0` | `#4B5563` | |

### 6.2 Typography

**Inter** via `@expo-google-fonts/inter` — consistent cross-platform rendering, tabular-figure support critical for aligned currency columns. Weights: `Inter_400Regular`, `Inter_500Medium`, `Inter_600SemiBold`, `Inter_700Bold`. Enable `fontVariant: ['tabular-nums']` on all currency figures.

| Token | Size/LH | Weight | Usage |
|---|---|---|---|
| `display` | 32/40 | Bold | Large balance figures |
| `h1` | 24/32 | SemiBold | Screen titles (rare) |
| `h2` | 20/28 | SemiBold | Section headers |
| `h3` | 17/24 | SemiBold | Card titles, list primary text |
| `body` | 15/22 | Regular | Standard text |
| `bodyMedium` | 15/22 | Medium | Button labels, active states |
| `caption` | 13/18 | Regular | Timestamps, metadata |
| `micro` | 11/14 | Medium | Badges, tags |
| `currencyLarge` | 28/34, tabular | Bold | Balance hero numbers |
| `currencyInline` | 15/22, tabular | SemiBold | Inline list amounts |

### 6.3 Design System Foundations

- **Spacing** (4pt grid): `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Screen padding `16`, card padding `16`, stacked-card gap `12`.
- **Corner radius**: chips/inputs `8`, cards/rows `12`, buttons `10`, bottom sheets `20` (top only), avatars/FAB full circle.
- **Elevation**: 3 tokens (`elevation-0` flat+border for most UI, `elevation-1` subtle lift for floating cards, `elevation-2` for modals/sheets/FAB). Prefer flat cards with hairline borders over heavy shadows (current fintech consensus — Wise/Monzo/Revolut).
- **Iconography**: `@expo/vector-icons`, Feather set preferred (thinner, calmer than default Material). Outline for inactive, filled/solid for active/selected. Sizes: 20 inline, 24 standard, 32 empty-states. One icon set only.

### 6.4 Navigation

Bottom tab bar (persistent) + nested stack per tab + modal for creation flows:

```
Tabs: Groups | Activity | [+Add, modal] | Balances | Profile
Groups tab: Groups Home (list) -> Group Detail (push) -> Expense Detail (push)
Add Expense: full-screen modal, own internal step stack (not a tab destination)
Balances tab: cross-group "who owes what" rollup + Settle Up
```

React Navigation (`@react-navigation/native` + bottom-tabs + native-stack), Expo Router for file-based routing. Add Expense as modal (not tab push) so it can be cleanly dismissed and reinforces "transient action" — matches Splitwise/Venmo/Cash App convention.

### 6.5 Key Screens (text wireframes)

**Groups Home**: header greeting + notif/settings icons; hero "Total balance" card (elevation-1, currencyLarge, semantic color); "Your Groups" section — flat rows (elevation-0, 12px radius, hairline border) with group emoji/avatar, name, member count, right-aligned balance in semantic color; pull-to-refresh; subtle pulsing "live" dot when WS connected.

**Group Detail**: back + group name + overflow menu; segmented control (Expenses / Balances / Members) to avoid three separate push destinations; Balances tab shows hero balance card, "Settlement Plan" section with directional avatar→avatar rows + per-row "Settle" button, full-width "Settle All Up" primary button, FAB for Add Expense.

**Add Expense** (3-step modal): Step 1 — amount via custom numeric keypad + description + category chips; Step 2 — payer selection (single/multi) + split-type selector (Even/Exact/%/Shares) revealing relevant sub-UI; Step 3 — plain-language review summary before Save. Thin progress bar under header, not literal "Step N of 3" text.

**Settle Up** (bottom sheet, not full modal): grabber handle, centered currencyLarge amount, "Full amount" vs "Custom amount" chip toggle, primary "Confirm Settlement" + text "Cancel".

### 6.6 Dark Mode

Token-based theme object (`light`/`dark`), consumed via `useTheme()` hook driven by `useColorScheme()` with manual override persisted to AsyncStorage. Rules: dark-mode accent colors are lightened/desaturated versions of light-mode ones (not naive inversion); surfaces get lighter as they approach the user (inverse of light mode's shadow-based elevation, per Material dark-elevation model); shadows mostly disabled in dark mode, communicated via surface-color steps + thin border instead; never pure black background.

### 6.7 Polish Investments (portfolio leverage)

1. Custom numeric keypad + tabular-nums everywhere money appears.
2. Skeleton loading states (shimmer placeholders shaped like real content), not spinners.
3. Thoughtful empty states with illustration + CTA — "All settled up! 🎉" should feel celebratory.
4. Haptic feedback (`expo-haptics`) on tab switches, toggles, and especially "Settle Up confirmed"/"Expense saved."
5. **Animated count-up/down on balance changes** (`react-native-reanimated`) when a WebSocket update lands — makes the real-time architecture visually legible rather than invisible plumbing. Also: gentle slide/fade for new list items arriving via WS.
6. Restrained motion for screen transitions and the Add Expense modal's step transitions (horizontal slide, not abrupt re-render).

## 7. Solution Architecture

Grounded in the actual codebase (verified by reading source, not just docs):
- Web app: React 19, Redux Toolkit 2.11 + `redux-persist` (persists only `auth`), React Router v7, fetch-based API client (no axios), `socket.io-client` 4.8.3.
- Backend: NestJS 11, Prisma 7 + PostgreSQL, Passport JWT + Google OAuth20, `@nestjs/websockets` gateway at `/events` with Redis adapter already wired.
- `REALTIME_GUIDELINE.md` / `WEBSOCKET_CLIENT_LLD.md` at repo root already describe the live gateway/guard/client pattern.
- **`GET /auth/google/mobile?mobile_redirect=`** already exists in `auth.controller.ts` — a deep-link-aware OAuth entry point built for this mobile app.

### 7.1 Project Structure (Expo Router)

```
money-split-mobile/
├── app/
│   ├── _layout.tsx                 # Redux Provider, PersistGate, SocketManager, theme
│   ├── index.tsx                   # redirect -> /login or /(tabs)
│   ├── login.tsx                   # Google OAuth entry
│   ├── auth/callback.tsx           # deep-link token handler
│   ├── join/[code].tsx             # deep-link target: money-split://join/ABCD1234
│   ├── (tabs)/
│   │   ├── _layout.tsx             # bottom tab navigator
│   │   ├── index.tsx               # multi-group overview
│   │   ├── groups.tsx
│   │   └── activity.tsx            # cross-group history
│   └── group/[id]/
│       ├── _layout.tsx             # mounts useGroupEvents(id)
│       ├── index.tsx               # balances, quick add
│       ├── details.tsx             # history + settlement plan
│       ├── members.tsx
│       └── expense/
│           ├── new.tsx             # multi-step add-expense flow
│           └── [expenseId]/edit.tsx
├── src/
│   ├── store/{index,hooks}.ts + slices/{auth,group,finance}Slice.ts
│   ├── lib/{api,auth,socket}.ts
│   ├── hooks/useGroupEvents.ts
│   ├── constants/api.constants.ts
│   ├── components/{expense-form,group-detail,dashboard,member-manager,ui}/
│   └── types/
├── .env                             # EXPO_PUBLIC_API_URL, EXPO_PUBLIC_API_PUBLIC_URL
└── app.json                         # scheme: "money-split"
```

`src/lib`, `src/store/slices`, `src/hooks` deliberately mirror web folder names so slices/hooks can be ported with minimal translation and stay in sync across platforms.

### 7.2 State Management — Redux Toolkit (matches web exactly)

**Decision: Redux Toolkit, not TanStack Query or Zustand.** The web app's `groupSlice.ts` already blends server-state async thunks (`fetchGroups`, `fetchTransactions`, `createExpense`, ...) with real-time sync reducers (`socketExpenseAdded`, `socketSettlementAdded`, `socketMemberJoined`, ...) in one slice — exactly the "push updates into a cache" pattern TanStack Query is weakest at and RTK handles natively via plain reducers. `redux-persist` already persists only `auth` (`blacklist: ['groups', 'finance']`) on web; map directly via `redux-persist` + `@react-native-async-storage/async-storage`, same blacklist.

Port verbatim: `authSlice` (plain reducers), `groupSlice` (thunks + socket sync reducers), `financeSlice` (client-side split bookkeeping, pure sync). Local-only UI state (form step progress, modal open/close) stays in component state, not Redux — matches web's `StepDots`/`StepNav` pattern.

### 7.3 API Layer

Plain `fetch` wrapper ported near-verbatim from `money-split-app/src/lib/api.ts` (web uses no axios). Key divergence: `authUtils.getToken()` becomes **async** (SecureStore vs. localStorage), so every call site awaits it.

No refresh-token logic needed — backend issues a flat `JWT_EXPIRES_IN` (default `7d`) token with no rotation (see risk #2 below). On 401, call `onUnauthorized` → `logout()` → clear SecureStore → route to `/login`, matching web.

Add a network-error distinction (`TypeError: Network request failed`) beyond web's generic error handling, since mobile hits real connectivity loss far more often.

`EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_API_PUBLIC_URL` are the mobile analogs of web's `VITE_API_URL`/`VITE_API_PUBLIC_URL`, already documented in the root README's env table.

### 7.4 Auth Flow

Use the backend's existing mobile-specific redirect flow — do not build a native Google Sign-In SDK integration:

1. `app.json` registers URL scheme `"money-split"`.
2. `expo-web-browser`'s `openAuthSessionAsync` opens `${EXPO_PUBLIC_API_PUBLIC_URL}/auth/google/mobile?mobile_redirect=money-split://auth/callback`.
3. Backend redirects through Google OAuth, then back to `money-split://auth/callback?token=<jwt>`.
4. `app/auth/callback.tsx` parses the token (via `expo-linking`), decodes the JWT payload, dispatches `setCredentials`.
5. Persist token via `expo-secure-store` (Keychain/Keystore-backed — tokens are credentials, unlike the rest of the persisted `auth` slice which is fine in AsyncStorage).

This avoids embedding Google OAuth client credentials in the mobile bundle entirely — the app never talks to Google directly.

Guest-join-via-link: see §3.1 — MVP matches web (login + manual code entry, deep link only prefills the field).

### 7.5 Real-Time Integration

Mirror the web app's pattern exactly (already spec'd for mobile in `REALTIME_GUIDELINE.md`/`WEBSOCKET_CLIENT_LLD.md`, and the backend gateway is already live):

- `src/lib/socket.ts`: singleton `socket.io-client` v4.8.3, namespace `/events`, JWT in handshake auth, `transports: ['websocket']` only (skip long-polling on mobile), `reconnectionAttempts: 10`.
- `useGroupEvents(groupId)`: port verbatim from web — joins `group:<id>` room, listens for `expense_created/updated/deleted`, `settlement_updated`, `member_joined/left`, `group_updated`; dispatches sync reducer immediately then re-fires the matching `fetchX` thunk for authoritative data.
- **Mobile-specific divergence**: wire `AppState` — disconnect socket on background (mobile OS aggressively suspends background network anyway; a stale connection produces silent missed-event bugs), reconnect + rejoin all mounted group rooms on foreground via each `useGroupEvents`'s existing `connect` listener.

### 7.6 Offline/Error Handling — MVP Scope

Build: network-error banner distinct from generic errors, socket reconnect indicator, retry-on-foreground refetch of the active screen's core data, standard pull-to-refresh, idempotency keys on mutating calls (`createExpense`, `createSettlement`, `settleAllApi` — web already sends these, straight port).

Defer: offline write queue/mutation replay (no backend conflict-detection support exists to build against), local persistent cache for full offline viewing (web deliberately blacklists `groups`/`finance` from persistence to avoid stale financial data — keep that on mobile), background sync/push for missed events (separate initiative, needs APNs/FCM).

### 7.7 Key Dependencies

Expo SDK 52+ baseline, versions pinned via `npx expo install`.

| Package | Purpose |
|---|---|
| `expo`, `expo-router` | Runtime + file-based nav |
| `@reduxjs/toolkit`, `react-redux` | State (match web major versions) |
| `redux-persist` + `@react-native-async-storage/async-storage` | Persist `auth` slice only |
| `expo-secure-store` | JWT storage (Keychain/Keystore) |
| `socket.io-client` `^4.8.3` | Real-time, pinned to match backend/web |
| `expo-web-browser` | OAuth browser session |
| `expo-linking` | Deep link parsing |
| `react-hook-form` (optional) | Multi-step expense form — RN benefits more than web given native input quirks |
| `zod` | Client-side DTO validation mirroring backend's `class-validator` strictness |
| `lucide-react-native` | Icons, parity with web's `lucide-react` |
| `expo-clipboard` | Copy invite code (RN equivalent of `navigator.clipboard`) |
| `react-native-safe-area-context`, `react-native-screens` | Required by Expo Router |
| `react-native-reanimated` | Balance count animations, screen/step transitions |
| `expo-haptics` | Haptic feedback on key actions |
| `@gorhom/bottom-sheet` | Settle Up sheet |

Explicitly not adding: axios, TanStack Query, native Google Sign-In SDK — none needed given the patterns above.

### 7.8 Risks / Open Items

1. **Guest-join-via-link gap** — resolved, see §3.1.
2. **No refresh token** — flat 7-day JWT expiry, more disruptive on mobile than web (users expect apps to stay logged in). Worth a backend follow-up (sliding expiry or refresh tokens) before/soon after mobile ships.
3. **WebSocket gateway CORS** — `events.gateway.ts`'s `getAllowedOrigins()` falls back to `FRONTEND_URL` or a localhost regex; verify this doesn't reject the mobile app's handshake in a production build (Socket.IO's CORS check behaves differently from plain HTTP CORS). Test against a production build, not just Expo Go.
4. **Strict DTO validation** — backend's `ValidationPipe({ forbidNonWhitelisted: true })` will hard-reject any extra/wrong field on `SplitDto` (`{ memberId, amount?, share?, percentage? }`). The multi-step form must send exactly the right optional field per split mode or submissions 400.
5. **Multi-payer is already backend-supported** (`payers: PayerDto[]`) — port `MultiPayerSelector.tsx` from web, don't simplify to single-payer.
6. **Backend README is stale** (lists Expenses/Settlements as "To Be Implemented"; they're fully implemented). Trust Swagger (`/docs`) or controller source, not the README, for API surface.
7. Redis adapter for the gateway is already wired server-side — no mobile-side scaling accommodation needed.

## 8. Open Questions for Implementation Planning

None blocking — all decisions above are final for this spec. The writing-plans phase should sequence: project scaffold → auth → groups/members → expense CRUD + split types → balances/settlement → real-time wiring → polish pass (design system tokens, haptics, animations, dark mode).
