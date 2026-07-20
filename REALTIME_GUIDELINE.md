# Real-Time Support Guideline — Money Split

## Tech-Stack Context

| Layer   | Stack                                    |
|---------|------------------------------------------|
| Backend | NestJS 11, Prisma, PostgreSQL            |
| Web     | React 19, Vite, Redux Toolkit            |
| Mobile  | Expo (React Native), Redux Toolkit       |

---

## Real-Time Technology Options

### Option 1 — WebSocket via `@nestjs/websockets` + `socket.io` ✅ Recommended

| | |
|---|---|
| **Best for** | Bi-directional, low-latency events (expense added, member joined, settlement updated) |
| **Backend** | `@nestjs/websockets` + `@nestjs/platform-socket.io` |
| **Web client** | `socket.io-client` |
| **Mobile client** | `socket.io-client` (works in Expo out of the box) |
| **Pros** | Automatic reconnect, rooms/namespaces, fallback to long-polling, easy auth via handshake |
| **Cons** | Slightly heavier than raw WS; stateful (needs Redis adapter for horizontal scaling) |

### Option 2 — Server-Sent Events (SSE)

| | |
|---|---|
| **Best for** | Server-to-client only push (read-only dashboards, notifications) |
| **Backend** | NestJS `@Sse()` decorator (built-in, zero extra deps) |
| **Clients** | `EventSource` (web) / `expo-sse` polyfill (mobile) |
| **Pros** | Zero extra dep on backend, HTTP/2 compatible, simple |
| **Cons** | One-way only; mobile SSE support in Expo needs a polyfill |

### Option 3 — Native WebSocket (`ws`)

| | |
|---|---|
| **Best for** | Ultra-lean setup, no Socket.IO overhead |
| **Backend** | `@nestjs/platform-ws` |
| **Clients** | Native `WebSocket` API (supported in both web and React Native) |
| **Pros** | Smallest footprint |
| **Cons** | No rooms, no auto-reconnect, no fallback — you implement everything yourself |

### Option 4 — Managed Service (Pusher / Ably / Supabase Realtime)

| | |
|---|---|
| **Best for** | No-infra realtime, fast prototyping |
| **Backend** | HTTP trigger from NestJS service layer |
| **Pros** | Handles scaling, presence, and message history out of the box |
| **Cons** | Cost, vendor lock-in, extra network hop |

---

## Why Socket.IO is the Right Choice Here

- All three platforms (NestJS / React / Expo) have mature `socket.io-client` support
- Group-scoped **rooms** are a natural fit for the data model (`groupId` → room)
- JWT auth via handshake reuses the existing Passport/JWT infrastructure
- Horizontal scaling later requires only adding `@socket.io/redis-adapter` + Redis

---

## Architecture Overview

```
[Expo Mobile]  ──socket.io-client──┐
[React Web]    ──socket.io-client──┤──► NestJS Gateway (/events) ──► Prisma DB
                                   │         │
                                   └─────────┘ (group rooms, JWT auth handshake)
```

---

## Implementation Guide

### Step 1 — Install Dependencies

**Backend**
```bash
cd money-split-backend
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
```

**Web app**
```bash
cd money-split-app
npm install socket.io-client
```

**Mobile app**
```bash
cd money-split-mobile
npm install socket.io-client
```

---

### Step 2 — Create the NestJS WebSocket Gateway

**`src/events/events.gateway.ts`**
```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' }, // tighten in production
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) client.disconnect();
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  /** Client joins a group room to receive group-scoped events */
  @SubscribeMessage('join_group')
  handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { groupId: string },
  ) {
    client.join(`group:${payload.groupId}`);
    return { event: 'joined', data: payload.groupId };
  }

  @SubscribeMessage('leave_group')
  handleLeaveGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { groupId: string },
  ) {
    client.leave(`group:${payload.groupId}`);
  }

  // ── Emit helpers called by services ──────────────────────────────

  emitExpenseCreated(groupId: string, expense: unknown) {
    this.server.to(`group:${groupId}`).emit('expense_created', expense);
  }

  emitExpenseUpdated(groupId: string, expense: unknown) {
    this.server.to(`group:${groupId}`).emit('expense_updated', expense);
  }

  emitExpenseDeleted(groupId: string, expenseId: string) {
    this.server.to(`group:${groupId}`).emit('expense_deleted', { expenseId });
  }

  emitSettlementUpdated(groupId: string, settlement: unknown) {
    this.server.to(`group:${groupId}`).emit('settlement_updated', settlement);
  }

  emitMemberJoined(groupId: string, member: unknown) {
    this.server.to(`group:${groupId}`).emit('member_joined', member);
  }
}
```

**`src/events/events.module.ts`**
```typescript
import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
```

**Register in `src/app.module.ts`**
```typescript
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    // ...existing modules
    EventsModule,
  ],
})
export class AppModule {}
```

---

### Step 3 — JWT Guard for WebSocket

**`src/auth/guards/ws-jwt.guard.ts`**
```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient();
    const token = client.handshake?.auth?.token;
    if (!token) throw new WsException('Unauthorized');
    try {
      client.data.user = this.jwtService.verify(token);
      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
```

---

### Step 4 — Emit Events from Services

Inject `EventsGateway` into any service and call emit helpers after every DB mutation.

**`src/expenses/expenses.service.ts`** (example)
```typescript
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
  ) {}

  async createExpense(dto: CreateExpenseDto) {
    const expense = await this.prisma.expense.create({ data: dto });
    this.eventsGateway.emitExpenseCreated(expense.groupId, expense); // 🔔 push
    return expense;
  }

  async updateExpense(id: string, dto: UpdateExpenseDto) {
    const expense = await this.prisma.expense.update({ where: { id }, data: dto });
    this.eventsGateway.emitExpenseUpdated(expense.groupId, expense);
    return expense;
  }

  async deleteExpense(id: string) {
    const expense = await this.prisma.expense.delete({ where: { id } });
    this.eventsGateway.emitExpenseDeleted(expense.groupId, id);
    return expense;
  }
}
```

> Apply the same pattern in `settlements.service.ts` and `groups.service.ts`.

---

### Step 5 — Web Client (`money-split-app`)

**`src/lib/socket.ts`**
```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL + '/events', {
      auth: { token },
      autoConnect: true,
      reconnectionAttempts: 5,
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
```

**`src/hooks/useGroupEvents.ts`**
```typescript
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { getSocket } from '../lib/socket';
import {
  expenseAdded,
  expenseUpdated,
  expenseRemoved,
} from '../store/expensesSlice';

export function useGroupEvents(groupId: string, token: string) {
  const dispatch = useDispatch();

  useEffect(() => {
    const socket = getSocket(token);
    socket.emit('join_group', { groupId });

    socket.on('expense_created',  (data)           => dispatch(expenseAdded(data)));
    socket.on('expense_updated',  (data)           => dispatch(expenseUpdated(data)));
    socket.on('expense_deleted',  ({ expenseId })  => dispatch(expenseRemoved(expenseId)));
    socket.on('settlement_updated', (data)         => { /* dispatch settlement action */ });

    return () => {
      socket.emit('leave_group', { groupId });
      socket.off('expense_created');
      socket.off('expense_updated');
      socket.off('expense_deleted');
      socket.off('settlement_updated');
    };
  }, [groupId, token, dispatch]);
}
```

Usage inside any group page:
```typescript
useGroupEvents(groupId, authToken);
```

---

### Step 6 — Mobile Client (`money-split-mobile`)

**`lib/socket.ts`**
```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(process.env.EXPO_PUBLIC_API_URL + '/events', {
      auth: { token },
      transports: ['websocket'], // skip long-polling on mobile
      reconnectionAttempts: 5,
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
```

**`hooks/useGroupEvents.ts`** — identical to the web hook above; Redux dispatch calls are the same.

> **Expo note:** If you encounter `"global is not defined"` at runtime, add the following line at the very top of `app/_layout.tsx`:
> ```typescript
> global.global = global;
> ```

---

### Step 7 — Environment Variables

**Web** `.env`
```env
VITE_API_URL=http://localhost:3000
```

**Mobile** `.env`
```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

> The backend needs no new variables — Socket.IO shares the same HTTP port (e.g., `3000`).

---

## Event Catalogue

| Event name           | Direction        | Payload              | Trigger                      |
|----------------------|------------------|----------------------|------------------------------|
| `expense_created`    | Server → Client  | `Expense` object     | New expense saved            |
| `expense_updated`    | Server → Client  | `Expense` object     | Expense edited               |
| `expense_deleted`    | Server → Client  | `{ expenseId }`      | Expense removed              |
| `settlement_updated` | Server → Client  | `Settlement` object  | Settlement status changes    |
| `member_joined`      | Server → Client  | `User` object        | New member joins group       |
| `join_group`         | Client → Server  | `{ groupId }`        | Client opens group screen    |
| `leave_group`        | Client → Server  | `{ groupId }`        | Client leaves group screen   |

---

## Scaling Consideration

When deploying multiple backend instances (Docker Swarm / Kubernetes), add the Redis adapter so all instances share a single Socket.IO broadcast channel:

```bash
npm install @socket.io/redis-adapter ioredis
```

**`src/main.ts`**
```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'ioredis';
import { IoAdapter } from '@nestjs/platform-socket.io';

const pubClient = createClient({ host: 'redis', port: 6379 });
const subClient = pubClient.duplicate();
app.useWebSocketAdapter(new IoAdapter(app));
// attach adapter after both clients are connected
await Promise.all([pubClient.connect(), subClient.connect()]);
const io = app.get(Server);
io.adapter(createAdapter(pubClient, subClient));
```

Add a Redis service to `docker-compose.yml`:
```yaml
redis:
  image: redis:7-alpine
  ports:
    - '6379:6379'
```
