# WebSocket Client LLD — Money Split (Web & Mobile)

## Overview

This document is the Low-Level Design reference for integrating Socket.IO real-time events into the **Web** (`money-split-app`) and **Mobile** (`money-split-mobile`) clients. The backend gateway is already implemented at `/events` namespace (see `REALTIME_GUIDELINE.md` and `money-split-backend/src/events/events.gateway.ts`).

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         NestJS Backend                          │
│  EventsGateway  /events  (Socket.IO namespace)                  │
│  Rooms: group:<groupId>                                         │
│  Auth: JWT in handshake.auth.token                              │
└────────────────┬────────────────────────────────────────────────┘
                 │  socket.io-client
     ┌───────────┴────────────┐
     │                        │
┌────▼──────────┐    ┌────────▼──────────┐
│  money-split- │    │  money-split-     │
│  app (Web)    │    │  mobile (Expo)    │
│               │    │                   │
│  src/lib/     │    │  src/lib/         │
│    socket.ts  │    │    socket.ts      │
│               │    │                   │
│  src/hooks/   │    │  src/hooks/       │
│    useGroup   │    │    useGroup       │
│    Events.ts  │    │    Events.ts      │
│               │    │                   │
│  Redux Store  │    │  Redux Store      │
│  groupSlice   │    │  groupSlice       │
│  financeSlice │    │  financeSlice     │
└───────────────┘    └───────────────────┘
```

---

## Event Catalogue

| Event name         | Direction        | Payload                                          | Trigger                        |
|--------------------|------------------|--------------------------------------------------|--------------------------------|
| `join_group`       | Client → Server  | `{ groupId: string }`                            | User opens a group screen      |
| `leave_group`      | Client → Server  | `{ groupId: string }`                            | User leaves a group screen     |
| `expense_created`  | Server → Client  | `ExpenseResponse`                                | New expense saved              |
| `expense_updated`  | Server → Client  | `ExpenseResponse`                                | Expense edited                 |
| `expense_deleted`  | Server → Client  | `{ expenseId: string }`                          | Expense soft-deleted           |
| `settlement_updated` | Server → Client | `SettlementResponse`                            | Settlement created / settle-up |
| `member_joined`    | Server → Client  | `GroupMember`                                    | New member joins group         |
| `group_updated`    | Server → Client  | `Group`                                          | Group name / info updated      |

---

## Web Client (`money-split-app`)

### New Files to Create

```
money-split-app/src/
├── lib/
│   └── socket.ts               ← Socket.IO singleton
├── hooks/
│   └── useGroupEvents.ts       ← React hook — subscribe to group room events
└── store/
    └── slices/
        └── socketSlice.ts      ← (optional) connection status in Redux
```

### 1. Socket Singleton — `src/lib/socket.ts`

Single `socket.io-client` instance shared across the whole app.

```typescript
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Returns (or lazily creates) the shared socket. */
export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL + '/events', {
      auth: { token },
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

/** Call on logout — tears down the connection and clears the singleton. */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
```

**Rules:**
- Call `getSocket(token)` once after a successful login (e.g., inside `authSlice` extra reducer or `App.tsx`).
- Call `disconnectSocket()` inside the `logout` reducer or a logout side-effect.
- Never import `socket` directly; always go through `getSocket()`.

---

### 2. Group Events Hook — `src/hooks/useGroupEvents.ts`

Mount this hook in any component that renders a group's detail view.

```typescript
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { getSocket } from '../lib/socket';
import {
  fetchGroupTransactions,
  fetchGroupBalances,
  setActiveGroup,
} from '../store/slices/groupSlice';

export function useGroupEvents(groupId: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((state) => state.auth.token);

  useEffect(() => {
    if (!token || !groupId) return;

    const socket = getSocket(token);

    // 1. Join the group room
    socket.emit('join_group', { groupId });

    // 2. Handle incoming events
    socket.on('expense_created', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('expense_updated', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('expense_deleted', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('settlement_updated', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('member_joined', () => {
      dispatch(setActiveGroup(groupId)); // reload group detail
    });

    socket.on('group_updated', () => {
      dispatch(setActiveGroup(groupId));
    });

    // 3. Cleanup — leave the room and remove listeners
    return () => {
      socket.emit('leave_group', { groupId });
      socket.off('expense_created');
      socket.off('expense_updated');
      socket.off('expense_deleted');
      socket.off('settlement_updated');
      socket.off('member_joined');
      socket.off('group_updated');
    };
  }, [groupId, token, dispatch]);
}
```

**Usage — `src/components/GroupDetail.tsx`:**
```typescript
import { useGroupEvents } from '../hooks/useGroupEvents';

export function GroupDetail({ groupId }: { groupId: string }) {
  useGroupEvents(groupId);
  // ... rest of component
}
```

---

### 3. Socket Lifecycle in `src/App.tsx`

Connect on app boot if already authenticated; disconnect on logout.

```typescript
import { useEffect } from 'react';
import { useAppSelector } from './store/hooks';
import { getSocket, disconnectSocket } from './lib/socket';

function SocketManager() {
  const token = useAppSelector((state) => state.auth.token);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated && token) {
      getSocket(token); // establish connection
    } else {
      disconnectSocket(); // tear down on logout
    }
  }, [isAuthenticated, token]);

  return null;
}

// Mount inside App root:
// <Provider store={store}><SocketManager /><RouterProvider ... /></Provider>
```

---

### 4. Environment Variable

Add to `.env` (already used for REST API):
```
VITE_API_URL=http://localhost:3000
```

The socket connects to `VITE_API_URL + '/events'` — no extra variable needed.

---

### 5. Redux Slice Integration

No new Redux state is required for socket data. Socket events trigger refetch thunks (`fetchGroupTransactions`, `fetchGroupBalances`) that already exist in `groupSlice.ts`. This keeps the data flow simple:

```
Socket event arrives
  → dispatch(fetchGroupTransactions(groupId))   // existing thunk
  → API call → state updated → component re-renders
```

If you want optimistic/instant updates without a round-trip, you can dispatch `groupSlice` actions directly with the socket payload instead of a thunk — but the refetch pattern is simpler and stays consistent with REST responses.

---

## Mobile Client (`money-split-mobile`)

### New Files to Create

```
money-split-mobile/src/
├── lib/
│   └── socket.ts               ← Socket.IO singleton (Expo-aware)
└── hooks/
    └── useGroupEvents.ts       ← Same pattern as web
```

---

### 1. Socket Singleton — `src/lib/socket.ts`

```typescript
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Returns (or lazily creates) the shared socket. */
export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(process.env.EXPO_PUBLIC_API_URL + '/events', {
      auth: { token },
      // Force WebSocket transport — skip long-polling on mobile for lower latency
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

/** Call on logout. */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
```

> **Expo note:** If you see `"global is not defined"` at runtime, add the following at the very top of `app/_layout.tsx` before any other import:
> ```typescript
> // @ts-ignore
> global.global = global;
> ```

---

### 2. Group Events Hook — `src/hooks/useGroupEvents.ts`

Identical logic to the web hook; only the import for `useAppDispatch`/`useAppSelector` comes from the mobile store.

```typescript
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { getSocket } from '../lib/socket';
import {
  fetchGroupTransactions,
  fetchGroupBalances,
  fetchGroupDetail,
} from '../store/slices/groupSlice';

export function useGroupEvents(groupId: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((state) => state.auth.token);

  useEffect(() => {
    if (!token || !groupId) return;

    const socket = getSocket(token);
    socket.emit('join_group', { groupId });

    socket.on('expense_created', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('expense_updated', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('expense_deleted', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('settlement_updated', () => {
      dispatch(fetchGroupTransactions(groupId));
      dispatch(fetchGroupBalances(groupId));
    });

    socket.on('member_joined', () => {
      dispatch(fetchGroupDetail(groupId));
    });

    socket.on('group_updated', () => {
      dispatch(fetchGroupDetail(groupId));
    });

    return () => {
      socket.emit('leave_group', { groupId });
      socket.off('expense_created');
      socket.off('expense_updated');
      socket.off('expense_deleted');
      socket.off('settlement_updated');
      socket.off('member_joined');
      socket.off('group_updated');
    };
  }, [groupId, token, dispatch]);
}
```

**Usage — `app/group/[id]/index.tsx`:**
```typescript
import { useGroupEvents } from '../../../src/hooks/useGroupEvents';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useGroupEvents(id);
  // ... rest of screen
}
```

---

### 3. Socket Lifecycle in `app/_layout.tsx`

Connect when authenticated; disconnect on logout — mirrors the web pattern.

```typescript
import { useEffect } from 'react';
import { useAppSelector } from '../src/store/hooks';
import { getSocket, disconnectSocket } from '../src/lib/socket';

function SocketManager() {
  const token = useAppSelector((state) => state.auth.token);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated && token) {
      getSocket(token);
    } else {
      disconnectSocket();
    }
  }, [isAuthenticated, token]);

  return null;
}

// Add <SocketManager /> inside <PersistGate> in the existing RootLayout:
// <PersistGate ...>
//   <ThemeProvider>
//     <SocketManager />       ← add here
//     <Stack ...>
```

---

### 4. Environment Variable

`money-split-mobile/.env` (already exists):
```
EXPO_PUBLIC_API_URL=http://localhost:3000
```

---

### 5. Install Dependency

```bash
cd money-split-mobile
npm install socket.io-client
```

---

## Connection Lifecycle Summary

```
App boots
  └─ Auth state = authenticated + token present
       └─ SocketManager mounts → getSocket(token) → connects to /events
            └─ User opens group screen
                 └─ useGroupEvents(groupId) mounts
                      └─ socket.emit('join_group', { groupId })
                           └─ Server adds client to room group:<groupId>
                                └─ Any member makes a change (expense, settlement, etc.)
                                     └─ Server emits event to room
                                          └─ Client receives event
                                               └─ dispatch(fetchXxx(groupId))
                                                    └─ Redux state updated → UI re-renders
            └─ User leaves group screen
                 └─ useGroupEvents cleanup: socket.emit('leave_group'), socket.off(...)
  └─ User logs out
       └─ SocketManager effect: disconnectSocket() → connection closed, singleton cleared
```

---

## Security Notes

- The JWT token is sent **only once** in the Socket.IO handshake (`auth.token`). It is not sent with every message.
- The backend `EventsGateway.handleConnection()` disconnects any client that does not present a valid token at connection time.
- Never store the raw token in component state — read it from the Redux store (`state.auth.token`) which is already managed securely.

---

## Dependencies Summary

| Package           | Web | Mobile | Purpose                        |
|-------------------|-----|--------|--------------------------------|
| `socket.io-client`| ✅  | ✅     | Socket.IO client               |

Both `money-split-app` and `money-split-mobile` need this single package.

```bash
# Web
cd money-split-app && npm install socket.io-client

# Mobile
cd money-split-mobile && npm install socket.io-client
```
