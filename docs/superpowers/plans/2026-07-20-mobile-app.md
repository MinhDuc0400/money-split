# Split Money Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native + Expo mobile companion to the existing Split Money web app, sharing the same NestJS backend, covering the full MVP feature set (auth, groups, expenses, balances, settlement, real-time).

**Architecture:** Expo Router for file-based navigation, Redux Toolkit (mirroring web's slice structure) with `redux-persist` persisting only `auth`, plain `fetch` API layer with async SecureStore token retrieval, `socket.io-client` for real-time, Google OAuth via `expo-web-browser` deep-link flow.

**Tech Stack:** Expo SDK 52, Expo Router, Redux Toolkit, redux-persist, expo-secure-store, socket.io-client 4.8.3, react-native-reanimated, expo-haptics, @gorhom/bottom-sheet, lucide-react-native, react-hook-form, zod.

## Global Constraints

- Expo managed workflow only — no bare/eject
- `socket.io-client` pinned to `^4.8.3` to match backend and web
- `EXPO_PUBLIC_API_URL` (internal/Docker URL) and `EXPO_PUBLIC_API_PUBLIC_URL` (public OAuth redirect URL) required in `.env`
- App URL scheme: `money-split` (registered in `app.json`)
- Redux blacklist: `['groups', 'finance']` — only `auth` persisted
- All currency figures must use `fontVariant: ['tabular-nums']`
- Primary color: `#3D5AFE` (light) / `#7C93FF` (dark); accent: `#00BFA6`
- Icon set: lucide-react-native only, Feather-style, no mixing
- No axios, no TanStack Query, no native Google SDK

---

### Task 1: Expo project scaffold + design system tokens

**Files:**
- Create: `money-split-mobile/app.json`
- Create: `money-split-mobile/package.json`
- Create: `money-split-mobile/.env.example`
- Create: `money-split-mobile/src/theme/tokens.ts`
- Create: `money-split-mobile/src/theme/useTheme.ts`
- Create: `money-split-mobile/app/_layout.tsx`
- Create: `money-split-mobile/app/index.tsx`

**Interfaces:**
- Produces: `useTheme()` → `{ colors: ThemeColors, spacing: Spacing, radius: Radius }`, `ThemeColors` type

- [ ] **Step 1: Scaffold Expo project**

```bash
cd /Users/ducnguyen/code/money-split
npx create-expo-app@latest money-split-mobile --template blank-typescript
cd money-split-mobile
```

- [ ] **Step 2: Install core dependencies**

```bash
npx expo install expo-router expo-secure-store expo-web-browser expo-linking expo-haptics expo-clipboard react-native-safe-area-context react-native-screens react-native-reanimated react-native-gesture-handler @react-native-async-storage/async-storage
npm install @reduxjs/toolkit react-redux redux-persist socket.io-client@^4.8.3 react-hook-form zod lucide-react-native @gorhom/bottom-sheet
```

- [ ] **Step 3: Configure `app.json`**

```json
{
  "expo": {
    "name": "Split Money",
    "slug": "money-split-mobile",
    "scheme": "money-split",
    "version": "1.0.0",
    "platforms": ["ios", "android"],
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "splash": { "backgroundColor": "#3D5AFE" },
    "ios": { "supportsTablet": false, "bundleIdentifier": "com.ducnguyen.splitmoney" },
    "android": { "package": "com.ducnguyen.splitmoney", "adaptiveIcon": { "backgroundColor": "#3D5AFE" } },
    "plugins": ["expo-router", "expo-secure-store"],
    "experiments": { "typedRoutes": true }
  }
}
```

- [ ] **Step 4: Create `.env.example`**

```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_API_PUBLIC_URL=http://localhost:3000
```

Copy to `.env` and fill real values.

- [ ] **Step 5: Write `src/theme/tokens.ts`**

```typescript
export const lightColors = {
  primary: '#3D5AFE',
  primaryDark: '#2540C9',
  accent: '#00BFA6',
  owed: '#12A454',
  owes: '#E5484D',
  settled: '#8A93A6',
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E4E7EC',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textDisabled: '#C1C7D0',
  error: '#E5484D',
} as const;

export const darkColors = {
  primary: '#7C93FF',
  primaryDark: '#5A75E0',
  accent: '#3ED9C0',
  owed: '#4ADE80',
  owes: '#F87171',
  settled: '#9CA6BC',
  background: '#0F1218',
  surface: '#1A1F29',
  surfaceRaised: '#232937',
  border: '#2A3142',
  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textDisabled: '#4B5563',
  error: '#F87171',
} as const;

export type ThemeColors = typeof lightColors;

export const spacing = { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 48: 48, 64: 64 } as const;
export const radius = { chip: 8, card: 12, button: 10, sheet: 20 } as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
  h2: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  h3: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '500' as const },
  currencyLarge: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as const },
  currencyInline: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const },
};
```

- [ ] **Step 6: Write `src/theme/useTheme.ts`**

```typescript
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, spacing, radius, typography, ThemeColors } from './tokens';

export function useTheme() {
  const scheme = useColorScheme();
  const colors: ThemeColors = scheme === 'dark' ? darkColors : lightColors;
  return { colors, spacing, radius, typography };
}
```

- [ ] **Step 7: Write root `app/_layout.tsx`**

```typescript
import { Stack } from 'expo-router';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { store, persistor } from '../src/store';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <Stack screenOptions={{ headerShown: false }} />
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 8: Write `app/index.tsx` redirect**

```typescript
import { Redirect } from 'expo-router';
import { useAppSelector } from '../src/store/hooks';

export default function Index() {
  const token = useAppSelector(s => s.auth.token);
  return <Redirect href={token ? '/(tabs)' : '/login'} />;
}
```

- [ ] **Step 9: Verify project starts**

```bash
cd money-split-mobile && npx expo start --ios
```
Expected: Expo dev server starts, app loads on simulator without crash.

- [ ] **Step 10: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): scaffold Expo project with design tokens and theme system"
```

---

### Task 2: Redux store — auth + group slices

**Files:**
- Create: `money-split-mobile/src/store/index.ts`
- Create: `money-split-mobile/src/store/hooks.ts`
- Create: `money-split-mobile/src/store/slices/authSlice.ts`
- Create: `money-split-mobile/src/store/slices/groupSlice.ts`
- Create: `money-split-mobile/src/types/index.ts`

**Interfaces:**
- Produces: `useAppSelector`, `useAppDispatch`, `setCredentials(token, user)`, `logout()`, `fetchGroups()`, `fetchGroupDetail(id)`, `socketExpenseAdded(expense)`, `socketExpenseUpdated(expense)`, `socketExpenseDeleted(expenseId)`, `socketSettlementAdded(settlement)`, `socketMemberJoined(member)`, `socketGroupUpdated(group)`

- [ ] **Step 1: Write shared TypeScript types**

```typescript
// src/types/index.ts
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface GroupMember {
  id: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'MEMBER';
  user?: User;
}

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  currency: string;
  members: GroupMember[];
  createdById: string;
}

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES';

export interface ExpenseSplit {
  id: string;
  memberId: string;
  amount: number;
  paid: boolean;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  payerId: string;
  splitType: SplitType;
  date: string;
  splits: ExpenseSplit[];
  payer?: GroupMember;
}

export interface Settlement {
  id: string;
  groupId: string;
  payerId: string;
  payeeId: string;
  amount: number;
  currency: string;
  date: string;
}

export interface MemberBalance {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  balance: number;
}

export interface SettlementSuggestion {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
}

export interface HistoryTransaction {
  type: 'expense' | 'settlement';
  id: string;
  date: string;
  description?: string;
  amount: number;
  payerName: string;
}

export interface GroupState {
  groups: Group[];
  activeGroupId: string | null;
  expenses: Record<string, Expense[]>;
  balances: Record<string, MemberBalance[]>;
  settlements: Record<string, SettlementSuggestion[]>;
  transactions: Record<string, HistoryTransaction[]>;
  loading: boolean;
  error: string | null;
}
```

- [ ] **Step 2: Write `src/store/slices/authSlice.ts`**

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '../../types';

interface AuthState {
  token: string | null;
  user: User | null;
}

const initialState: AuthState = { token: null, user: null };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
    },
    logout(state) {
      state.token = null;
      state.user = null;
    },
  },
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
```

- [ ] **Step 3: Write `src/store/slices/groupSlice.ts`**

```typescript
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../lib/api';
import { Group, Expense, MemberBalance, SettlementSuggestion, HistoryTransaction, GroupMember, Settlement, GroupState } from '../../types';

const initialState: GroupState = {
  groups: [], activeGroupId: null,
  expenses: {}, balances: {}, settlements: {}, transactions: {},
  loading: false, error: null,
};

export const fetchGroups = createAsyncThunk('group/fetchGroups', () => api.get<Group[]>('/groups'));
export const fetchGroupDetail = createAsyncThunk('group/fetchGroupDetail', (id: string) => api.get<Group>(`/groups/${id}`));
export const fetchGroupBalances = createAsyncThunk('group/fetchGroupBalances', (id: string) => api.get<MemberBalance[]>(`/groups/${id}/balances`));
export const fetchSettlements = createAsyncThunk('group/fetchSettlements', (id: string) => api.get<SettlementSuggestion[]>(`/groups/${id}/settlements`));
export const fetchTransactions = createAsyncThunk('group/fetchTransactions', (id: string) => api.get<HistoryTransaction[]>(`/groups/${id}/transactions?limit=20`));

export const createExpense = createAsyncThunk('group/createExpense', ({ groupId, data }: { groupId: string; data: unknown }) =>
  api.post<Expense>(`/groups/${groupId}/expenses`, data));

export const updateExpense = createAsyncThunk('group/updateExpense', ({ groupId, expenseId, data }: { groupId: string; expenseId: string; data: unknown }) =>
  api.patch<Expense>(`/groups/${groupId}/expenses/${expenseId}`, data));

export const deleteExpense = createAsyncThunk('group/deleteExpense', async ({ groupId, expenseId }: { groupId: string; expenseId: string }) => {
  await api.delete(`/groups/${groupId}/expenses/${expenseId}`);
  return expenseId;
});

export const settleUp = createAsyncThunk('group/settleUp', ({ groupId, data }: { groupId: string; data: unknown }) =>
  api.post<Settlement>(`/groups/${groupId}/settle-up`, data));

export const settleAll = createAsyncThunk('group/settleAll', (groupId: string) =>
  api.post<void>(`/groups/${groupId}/settlements/settle-all`, {}));

const groupSlice = createSlice({
  name: 'group',
  initialState,
  reducers: {
    setActiveGroup(state, action: PayloadAction<string>) { state.activeGroupId = action.payload; },
    socketExpenseAdded(state, action: PayloadAction<Expense>) {
      const { groupId } = action.payload;
      if (!state.expenses[groupId]) state.expenses[groupId] = [];
      state.expenses[groupId].unshift(action.payload);
    },
    socketExpenseUpdated(state, action: PayloadAction<Expense>) {
      const { groupId, id } = action.payload;
      if (state.expenses[groupId]) {
        const idx = state.expenses[groupId].findIndex(e => e.id === id);
        if (idx !== -1) state.expenses[groupId][idx] = action.payload;
      }
    },
    socketExpenseDeleted(state, action: PayloadAction<{ groupId: string; expenseId: string }>) {
      const { groupId, expenseId } = action.payload;
      if (state.expenses[groupId]) {
        state.expenses[groupId] = state.expenses[groupId].filter(e => e.id !== expenseId);
      }
    },
    socketSettlementAdded(state, action: PayloadAction<Settlement>) {
      // Balances will be refetched via thunk; clear stale settlements
      delete state.settlements[action.payload.groupId];
    },
    socketMemberJoined(state, action: PayloadAction<{ groupId: string; member: GroupMember }>) {
      const group = state.groups.find(g => g.id === action.payload.groupId);
      if (group) group.members.push(action.payload.member);
    },
    socketGroupUpdated(state, action: PayloadAction<Partial<Group> & { id: string }>) {
      const group = state.groups.find(g => g.id === action.payload.id);
      if (group) Object.assign(group, action.payload);
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchGroups.fulfilled, (state, a) => { state.groups = a.payload; })
      .addCase(fetchGroupDetail.fulfilled, (state, a) => {
        const idx = state.groups.findIndex(g => g.id === a.payload.id);
        if (idx !== -1) state.groups[idx] = a.payload; else state.groups.push(a.payload);
      })
      .addCase(fetchGroupBalances.fulfilled, (state, a) => { state.balances[a.meta.arg] = a.payload; })
      .addCase(fetchSettlements.fulfilled, (state, a) => { state.settlements[a.meta.arg] = a.payload; })
      .addCase(fetchTransactions.fulfilled, (state, a) => { state.transactions[a.meta.arg] = a.payload; })
      .addCase(createExpense.fulfilled, (state, a) => {
        const { groupId } = a.payload;
        if (!state.expenses[groupId]) state.expenses[groupId] = [];
        state.expenses[groupId].unshift(a.payload);
      })
      .addCase(updateExpense.fulfilled, (state, a) => {
        const { groupId, id } = a.payload;
        if (state.expenses[groupId]) {
          const idx = state.expenses[groupId].findIndex(e => e.id === id);
          if (idx !== -1) state.expenses[groupId][idx] = a.payload;
        }
      })
      .addCase(deleteExpense.fulfilled, (state, a) => {
        // Remove from all groups (we don't know which group here without extra logic)
        for (const gid of Object.keys(state.expenses)) {
          state.expenses[gid] = state.expenses[gid].filter(e => e.id !== a.payload);
        }
      });
  },
});

export const { setActiveGroup, socketExpenseAdded, socketExpenseUpdated, socketExpenseDeleted, socketSettlementAdded, socketMemberJoined, socketGroupUpdated } = groupSlice.actions;
export default groupSlice.reducer;
```

- [ ] **Step 4: Write `src/store/index.ts`**

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { combineReducers } from 'redux';
import authReducer from './slices/authSlice';
import groupReducer from './slices/groupSlice';

const authPersistConfig = { key: 'auth', storage: AsyncStorage };

const rootReducer = combineReducers({
  auth: persistReducer(authPersistConfig, authReducer),
  group: groupReducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefault =>
    getDefault({ serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] } }),
});

export const persistor = persistStore(store);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

- [ ] **Step 5: Write `src/store/hooks.ts`**

```typescript
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '.';

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

- [ ] **Step 6: Verify TypeScript compilation**

```bash
cd money-split-mobile && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add money-split-mobile/src/
git commit -m "feat(mobile): add Redux store with auth and group slices"
```

---

### Task 3: API layer + auth flow

**Files:**
- Create: `money-split-mobile/src/lib/api.ts`
- Create: `money-split-mobile/src/lib/auth.ts`
- Create: `money-split-mobile/app/login.tsx`
- Create: `money-split-mobile/app/auth/callback.tsx`

**Interfaces:**
- Consumes: `store.getState().auth.token`, `logout()` action, `setCredentials()` action
- Produces: `api.get<T>(path)`, `api.post<T>(path, body)`, `api.patch<T>(path, body)`, `api.delete(path)`, `startGoogleLogin()`

- [ ] **Step 1: Write `src/lib/api.ts`**

```typescript
import * as SecureStore from 'expo-secure-store';
import { store } from '../store';
import { logout } from '../store/slices/authSlice';

const BASE = process.env.EXPO_PUBLIC_API_URL!;

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('jwt_token');
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Network request failed — check your connection.');
  }

  if (res.status === 401) {
    store.dispatch(logout());
    SecureStore.deleteItemAsync('jwt_token');
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};
```

- [ ] **Step 2: Write `src/lib/auth.ts`**

```typescript
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';

const API_PUBLIC = process.env.EXPO_PUBLIC_API_PUBLIC_URL!;
const CALLBACK = 'money-split://auth/callback';

export async function startGoogleLogin(): Promise<void> {
  const url = `${API_PUBLIC}/auth/google/mobile?mobile_redirect=${encodeURIComponent(CALLBACK)}`;
  await WebBrowser.openAuthSessionAsync(url, CALLBACK);
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync('jwt_token', token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync('jwt_token');
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload));
}
```

- [ ] **Step 3: Write `app/login.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useTheme } from '../src/theme/useTheme';
import { startGoogleLogin } from '../src/lib/auth';

export default function LoginScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [loading, setLoading] = useState(false);

  async function handleGoogleLogin() {
    setLoading(true);
    try { await startGoogleLogin(); } finally { setLoading(false); }
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, padding: spacing[16] }]}>
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card }]}>
        <View style={[s.logoBox, { backgroundColor: colors.primary + '20', borderRadius: radius.card }]}>
          <Text style={{ fontSize: 40 }}>💰</Text>
        </View>
        <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing[16] }]}>
          Split Money
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8], marginBottom: spacing[32] }]}>
          Track shared expenses with friends and family
        </Text>
        <TouchableOpacity
          onPress={handleGoogleLogin}
          disabled={loading}
          style={[s.btn, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.button }]}
        >
          {loading ? <ActivityIndicator color={colors.primary} /> : (
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Continue with Google</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  card: { padding: 24, alignItems: 'center', borderWidth: 1 },
  logoBox: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  btn: { width: '100%', height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
```

- [ ] **Step 4: Write `app/auth/callback.tsx`**

```typescript
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useAppDispatch } from '../../src/store/hooks';
import { setCredentials } from '../../src/store/slices/authSlice';
import { saveToken, decodeJwtPayload } from '../../src/lib/auth';
import { useTheme } from '../../src/theme/useTheme';

export default function AuthCallback() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { colors } = useTheme();

  useEffect(() => {
    const url = Linking.useURL();
    if (!url) return;
    const { queryParams } = Linking.parse(url);
    const token = queryParams?.token as string | undefined;
    if (!token) { router.replace('/login'); return; }

    saveToken(token).then(() => {
      const payload = decodeJwtPayload(token);
      dispatch(setCredentials({
        token,
        user: { id: payload.sub as string, name: payload.name as string, email: payload.email as string, avatarUrl: payload.avatarUrl as string | null },
      }));
      router.replace('/(tabs)');
    });
  }, []);

  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} size="large" /></View>;
}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd money-split-mobile && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): API layer, Google OAuth login, deep-link callback"
```

---

### Task 4: Tab navigator + Groups list screen

**Files:**
- Create: `money-split-mobile/app/(tabs)/_layout.tsx`
- Create: `money-split-mobile/app/(tabs)/index.tsx`
- Create: `money-split-mobile/app/(tabs)/activity.tsx`
- Create: `money-split-mobile/app/(tabs)/profile.tsx`
- Create: `money-split-mobile/src/components/ui/GroupRow.tsx`
- Create: `money-split-mobile/src/components/ui/BalanceBadge.tsx`

**Interfaces:**
- Consumes: `useAppSelector`, `fetchGroups()`, `useTheme()`
- Produces: tab navigator with Groups/Activity/Profile tabs, `<GroupRow group={Group} balance={number} />`, `<BalanceBadge amount={number} />`

- [ ] **Step 1: Write `app/(tabs)/_layout.tsx`**

```typescript
import { Tabs } from 'expo-router';
import { Users, Activity, User } from 'lucide-react-native';
import { useTheme } from '../../src/theme/useTheme';

export default function TabLayout() {
  const { colors } = useTheme();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Groups', tabBarIcon: ({ color }) => <Users size={24} color={color} /> }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <Activity size={24} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <User size={24} color={color} /> }} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Write `src/components/ui/BalanceBadge.tsx`**

```typescript
import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface Props { amount: number }

export function BalanceBadge({ amount }: Props) {
  const { colors, typography, spacing } = useTheme();
  if (amount === 0) return <Text style={[typography.caption, { color: colors.settled }]}>Settled</Text>;
  const color = amount > 0 ? colors.owed : colors.owes;
  const label = amount > 0 ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;
  return (
    <View style={[s.badge, { backgroundColor: color + '20', paddingHorizontal: spacing[8], paddingVertical: spacing[4] }]}>
      <Text style={[typography.currencyInline, { color }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({ badge: { borderRadius: 20 } });
```

- [ ] **Step 3: Write `src/components/ui/GroupRow.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme/useTheme';
import { BalanceBadge } from './BalanceBadge';
import { Group } from '../../types';

interface Props { group: Group; balance: number; onPress: () => void }

export function GroupRow({ group, balance, onPress }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, padding: spacing[16], marginBottom: spacing[8] }]}
    >
      <View style={[s.avatar, { backgroundColor: colors.primary + '20', borderRadius: radius.card }]}>
        <Text style={{ fontSize: 20 }}>👥</Text>
      </View>
      <View style={{ flex: 1, marginLeft: spacing[12] }}>
        <Text style={[typography.h3, { color: colors.textPrimary }]} numberOfLines={1}>{group.name}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{group.members.length} members · {group.currency}</Text>
      </View>
      <BalanceBadge amount={balance} />
      <ChevronRight size={16} color={colors.textDisabled} style={{ marginLeft: spacing[4] }} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 4: Write `app/(tabs)/index.tsx` — Groups list**

```typescript
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useAppDispatch, useAppSelector } from '../../src/store/hooks';
import { fetchGroups, fetchGroupBalances } from '../../src/store/slices/groupSlice';
import { GroupRow } from '../../src/components/ui/GroupRow';
import { useTheme } from '../../src/theme/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function GroupsScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const groups = useAppSelector(s => s.group.groups);
  const balances = useAppSelector(s => s.group.balances);
  const user = useAppSelector(s => s.auth.user);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { dispatch(fetchGroups()); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await dispatch(fetchGroups());
    setRefreshing(false);
  }

  function getMyBalance(groupId: string): number {
    const memberBalances = balances[groupId] ?? [];
    const me = memberBalances.find(b => {
      const group = groups.find(g => g.id === groupId);
      return group?.members.find(m => m.userId === user?.id)?.id === b.memberId;
    });
    return me?.balance ?? 0;
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[s.header, { padding: spacing[16], paddingBottom: spacing[8] }]}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Groups</Text>
        <TouchableOpacity onPress={() => router.push('/group/new')} style={[s.fab, { backgroundColor: colors.primary }]}>
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      <FlatList
        data={groups}
        keyExtractor={g => g.id}
        contentContainerStyle={{ padding: spacing[16] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>🤝</Text>
            <Text style={[typography.h3, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing[12] }]}>No groups yet</Text>
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8] }]}>Create or join a group to get started</Text>
          </View>
        }
        renderItem={({ item }) => (
          <GroupRow
            group={item}
            balance={getMyBalance(item.id)}
            onPress={() => { dispatch(fetchGroupBalances(item.id)); router.push(`/group/${item.id}`); }}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fab: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingTop: 80, alignItems: 'center' },
});
```

- [ ] **Step 5: Write stub screens for activity and profile tabs**

```typescript
// app/(tabs)/activity.tsx
import { View, Text } from 'react-native';
import { useTheme } from '../../src/theme/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export default function ActivityScreen() {
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + spacing[16], paddingHorizontal: spacing[16] }}>
    <Text style={[typography.h1, { color: colors.textPrimary }]}>Activity</Text>
  </View>;
}
```

```typescript
// app/(tabs)/profile.tsx
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../src/theme/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../../src/store/hooks';
import { logout } from '../../src/store/slices/authSlice';
import { clearToken } from '../../src/lib/auth';
import { useRouter } from 'expo-router';
export default function ProfileScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const router = useRouter();
  const user = useAppSelector(s => s.auth.user);
  async function handleLogout() { await clearToken(); dispatch(logout()); router.replace('/login'); }
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + spacing[16], paddingHorizontal: spacing[16] }}>
    <Text style={[typography.h1, { color: colors.textPrimary }]}>Profile</Text>
    <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing[8] }]}>{user?.name}</Text>
    <TouchableOpacity onPress={handleLogout} style={{ marginTop: spacing[32], padding: spacing[16], backgroundColor: colors.owes + '20', borderRadius: radius.button }}>
      <Text style={[typography.bodyMedium, { color: colors.owes, textAlign: 'center' }]}>Log Out</Text>
    </TouchableOpacity>
  </View>;
}
```

- [ ] **Step 6: Verify app starts and tabs appear**

```bash
cd money-split-mobile && npx expo start --ios
```
Expected: bottom tab bar shows Groups / Activity / Profile. Groups list renders (empty state if no groups).

- [ ] **Step 7: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): tab navigator, groups list screen, BalanceBadge"
```

---

### Task 5: Group Detail screen (balances + expenses)

**Files:**
- Create: `money-split-mobile/app/group/[id]/index.tsx`
- Create: `money-split-mobile/app/group/[id]/_layout.tsx`
- Create: `money-split-mobile/src/components/group-detail/BalanceHeroCard.tsx`
- Create: `money-split-mobile/src/components/group-detail/ExpenseRow.tsx`
- Create: `money-split-mobile/src/hooks/useGroupData.ts`

**Interfaces:**
- Consumes: `fetchGroupDetail`, `fetchGroupBalances`, `fetchSettlements`, `fetchTransactions`
- Produces: Group Detail screen showing member balances and recent expenses

- [ ] **Step 1: Write `src/hooks/useGroupData.ts`**

```typescript
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchGroupDetail, fetchGroupBalances, fetchSettlements, fetchTransactions } from '../store/slices/groupSlice';

export function useGroupData(groupId: string) {
  const dispatch = useAppDispatch();
  const group = useAppSelector(s => s.group.groups.find(g => g.id === groupId));
  const balances = useAppSelector(s => s.group.balances[groupId] ?? []);
  const settlements = useAppSelector(s => s.group.settlements[groupId] ?? []);
  const transactions = useAppSelector(s => s.group.transactions[groupId] ?? []);

  useEffect(() => {
    dispatch(fetchGroupDetail(groupId));
    dispatch(fetchGroupBalances(groupId));
    dispatch(fetchSettlements(groupId));
    dispatch(fetchTransactions(groupId));
  }, [groupId]);

  function refresh() {
    dispatch(fetchGroupDetail(groupId));
    dispatch(fetchGroupBalances(groupId));
    dispatch(fetchSettlements(groupId));
    dispatch(fetchTransactions(groupId));
  }

  return { group, balances, settlements, transactions, refresh };
}
```

- [ ] **Step 2: Write `src/components/group-detail/BalanceHeroCard.tsx`**

```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface Props { myBalance: number }

export function BalanceHeroCard({ myBalance }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const isOwed = myBalance > 0;
  const isOwing = myBalance < 0;
  const bgColor = myBalance === 0 ? colors.settled : isOwed ? colors.owed : colors.owes;
  const label = myBalance === 0 ? 'All settled up 🎉' : isOwed ? 'You are owed' : 'You owe';
  const amount = `$${Math.abs(myBalance).toFixed(2)}`;

  return (
    <View style={[s.card, { backgroundColor: bgColor, borderRadius: radius.card, padding: spacing[20], margin: spacing[16] }]}>
      <Text style={[typography.caption, { color: '#fff', opacity: 0.8 }]}>{label}</Text>
      <Text style={[typography.currencyLarge, { color: '#fff', marginTop: spacing[4] }]}>{myBalance === 0 ? '' : amount}</Text>
    </View>
  );
}

const s = StyleSheet.create({ card: {} });
```

- [ ] **Step 3: Write `src/components/group-detail/ExpenseRow.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { HistoryTransaction } from '../../types';

interface Props { item: HistoryTransaction; onPress: () => void }

export function ExpenseRow({ item, onPress }: Props) {
  const { colors, spacing, radius, typography } = useTheme();
  const isSettlement = item.type === 'settlement';
  return (
    <TouchableOpacity onPress={onPress} style={[s.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, padding: spacing[16], marginBottom: spacing[8] }]}>
      <View style={[s.icon, { backgroundColor: isSettlement ? colors.owed + '20' : colors.primary + '20', borderRadius: radius.chip }]}>
        <Text style={{ fontSize: 18 }}>{isSettlement ? '✅' : '💳'}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: spacing[12] }}>
        <Text style={[typography.h3, { color: colors.textPrimary }]} numberOfLines={1}>{item.description ?? 'Settlement'}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{item.payerName} · {new Date(item.date).toLocaleDateString()}</Text>
      </View>
      <Text style={[typography.currencyInline, { color: isSettlement ? colors.owed : colors.textPrimary }]}>
        ${item.amount.toFixed(2)}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 4: Write `app/group/[id]/_layout.tsx`**

```typescript
import { Stack } from 'expo-router';
export default function GroupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 5: Write `app/group/[id]/index.tsx`**

```typescript
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Plus, MoreHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../src/theme/useTheme';
import { useGroupData } from '../../../src/hooks/useGroupData';
import { useAppSelector } from '../../../src/store/hooks';
import { BalanceHeroCard } from '../../../src/components/group-detail/BalanceHeroCard';
import { ExpenseRow } from '../../../src/components/group-detail/ExpenseRow';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography } = useTheme();
  const { group, balances, transactions, refresh } = useGroupData(id);
  const user = useAppSelector(s => s.auth.user);
  const [refreshing, setRefreshing] = useState(false);

  const myMemberId = group?.members.find(m => m.userId === user?.id)?.id;
  const myBalance = balances.find(b => b.memberId === myMemberId)?.balance ?? 0;

  async function onRefresh() { setRefreshing(true); refresh(); setRefreshing(false); }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12] }]}>
        <TouchableOpacity onPress={() => router.back()}><ArrowLeft size={24} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={[typography.h3, { color: colors.textPrimary, flex: 1, textAlign: 'center', marginHorizontal: spacing[8] }]} numberOfLines={1}>{group?.name ?? '…'}</Text>
        <TouchableOpacity><MoreHorizontal size={24} color={colors.textPrimary} /></TouchableOpacity>
      </View>

      <BalanceHeroCard myBalance={myBalance} />

      <View style={[s.actionRow, { paddingHorizontal: spacing[16], marginBottom: spacing[16] }]}>
        <TouchableOpacity
          onPress={() => router.push(`/group/${id}/settle`)}
          style={[s.actionBtn, { backgroundColor: colors.accent + '20', borderRadius: 10 }]}
        >
          <Text style={[typography.bodyMedium, { color: colors.accent }]}>Settle Up</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push(`/group/${id}/expense/new`)}
          style={[s.actionBtn, { backgroundColor: colors.primary, borderRadius: 10, marginLeft: spacing[8] }]}
        >
          <Plus size={16} color="#fff" style={{ marginRight: 4 }} />
          <Text style={[typography.bodyMedium, { color: '#fff' }]}>Add Expense</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={t => t.id}
        contentContainerStyle={{ paddingHorizontal: spacing[16] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={<Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8], textTransform: 'uppercase', letterSpacing: 0.6 }]}>Recent</Text>}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 36, textAlign: 'center' }}>🧾</Text>
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8] }]}>No expenses yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ExpenseRow item={item} onPress={() => {}} />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  actionRow: { flexDirection: 'row' },
  actionBtn: { flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  empty: { paddingTop: 40 },
});
```

- [ ] **Step 6: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): group detail screen with balance hero card and transaction list"
```

---

### Task 6: Add Expense — 3-step modal flow

**Files:**
- Create: `money-split-mobile/app/group/[id]/expense/new.tsx`
- Create: `money-split-mobile/src/components/expense-form/StepAmount.tsx`
- Create: `money-split-mobile/src/components/expense-form/StepSplit.tsx`
- Create: `money-split-mobile/src/components/expense-form/StepReview.tsx`
- Create: `money-split-mobile/src/components/expense-form/NumericKeypad.tsx`

**Interfaces:**
- Consumes: `createExpense()` thunk, `group` from Redux, `SplitType`
- Produces: 3-step expense creation flow dispatching `createExpense`

- [ ] **Step 1: Write `NumericKeypad.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/useTheme';

interface Props { value: string; onChange: (v: string) => void }

const KEYS = ['1','2','3','4','5','6','7','8','9','.','0','⌫'];

export function NumericKeypad({ value, onChange }: Props) {
  const { colors, typography } = useTheme();

  function press(key: string) {
    if (key === '⌫') { onChange(value.slice(0, -1) || '0'); return; }
    if (key === '.' && value.includes('.')) return;
    if (value === '0' && key !== '.') { onChange(key); return; }
    const next = value + key;
    const parts = next.split('.');
    if (parts[1]?.length > 2) return;
    onChange(next);
  }

  return (
    <View style={s.grid}>
      {KEYS.map(k => (
        <TouchableOpacity key={k} onPress={() => press(k)} style={[s.key, { backgroundColor: colors.surface }]}>
          <Text style={[typography.h2, { color: k === '⌫' ? colors.owes : colors.textPrimary }]}>{k}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  key: { width: '33.33%', height: 60, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Write `StepAmount.tsx`**

```typescript
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/useTheme';
import { NumericKeypad } from './NumericKeypad';
import { Control, Controller } from 'react-hook-form';
import { ExpenseFormData } from './types';

interface Props { control: Control<ExpenseFormData> }

export function StepAmount({ control }: Props) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Controller control={control} name="amount" render={({ field: { value, onChange } }) => (
        <>
          <View style={[s.amountBox, { paddingVertical: spacing[24] }]}>
            <Text style={[typography.display, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>
              <Text style={{ color: colors.textSecondary }}>$</Text>{value || '0'}
            </Text>
          </View>
          <NumericKeypad value={value} onChange={onChange} />
        </>
      )} />
      <Controller control={control} name="description" render={({ field: { value, onChange, onBlur } }) => (
        <TextInput
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          placeholder="What's this for?"
          placeholderTextColor={colors.textDisabled}
          style={[s.descInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface }]}
        />
      )} />
    </View>
  );
}

const s = StyleSheet.create({
  amountBox: { alignItems: 'center' },
  descInput: { marginHorizontal: 16, padding: 14, borderWidth: 1, borderRadius: 10, fontSize: 15 },
});
```

- [ ] **Step 3: Create `src/components/expense-form/types.ts`**

```typescript
import { SplitType } from '../../../types';

export interface SplitMemberInput {
  memberId: string;
  amount?: string;
  percentage?: string;
  share?: string;
}

export interface ExpenseFormData {
  amount: string;
  description: string;
  payerId: string;
  splitType: SplitType;
  splits: SplitMemberInput[];
}
```

- [ ] **Step 4: Write `StepSplit.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Control, Controller, useWatch } from 'react-hook-form';
import { useTheme } from '../../../theme/useTheme';
import { GroupMember, SplitType } from '../../../types';
import { ExpenseFormData } from './types';

const SPLIT_TYPES: { key: SplitType; label: string }[] = [
  { key: 'EQUAL', label: 'Equal' },
  { key: 'EXACT', label: 'Exact $' },
  { key: 'PERCENTAGE', label: '%' },
  { key: 'SHARES', label: 'Shares' },
];

interface Props { control: Control<ExpenseFormData>; members: GroupMember[] }

export function StepSplit({ control, members }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  const splitType = useWatch({ control, name: 'splitType' });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing[16] }}>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8], textTransform: 'uppercase' }]}>Paid by</Text>
      <Controller control={control} name="payerId" render={({ field: { value, onChange } }) => (
        <View style={s.memberRow}>
          {members.filter(m => m.userId).map(m => (
            <TouchableOpacity key={m.id} onPress={() => onChange(m.id)}
              style={[s.memberChip, { backgroundColor: value === m.id ? colors.primary : colors.surface, borderColor: value === m.id ? colors.primary : colors.border, borderRadius: radius.chip }]}>
              <Text style={[typography.caption, { color: value === m.id ? '#fff' : colors.textPrimary }]}>{m.name.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )} />

      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing[20], marginBottom: spacing[8], textTransform: 'uppercase' }]}>Split type</Text>
      <Controller control={control} name="splitType" render={({ field: { value, onChange } }) => (
        <View style={s.splitRow}>
          {SPLIT_TYPES.map(t => (
            <TouchableOpacity key={t.key} onPress={() => onChange(t.key)}
              style={[s.splitChip, { backgroundColor: value === t.key ? colors.primary : colors.surface, borderColor: value === t.key ? colors.primary : colors.border, borderRadius: radius.chip }]}>
              <Text style={[typography.caption, { color: value === t.key ? '#fff' : colors.textPrimary }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberChip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  splitRow: { flexDirection: 'row', gap: 8 },
  splitChip: { flex: 1, paddingVertical: 10, alignItems: 'center', borderWidth: 1 },
});
```

- [ ] **Step 5: Write `StepReview.tsx`**

```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useWatch, Control } from 'react-hook-form';
import { useTheme } from '../../../theme/useTheme';
import { GroupMember } from '../../../types';
import { ExpenseFormData } from './types';

interface Props { control: Control<ExpenseFormData>; members: GroupMember[] }

export function StepReview({ control, members }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { amount, description, payerId, splitType } = useWatch({ control });
  const payer = members.find(m => m.id === payerId);
  const memberCount = members.length;
  const perPerson = memberCount ? (parseFloat(amount || '0') / memberCount).toFixed(2) : '0.00';

  return (
    <View style={{ flex: 1, padding: spacing[16] }}>
      <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: spacing[24], textAlign: 'center' }]}>Review</Text>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Description</Text>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{description || '—'}</Text>
      </View>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Amount</Text>
        <Text style={[typography.currencyInline, { color: colors.textPrimary }]}>${parseFloat(amount || '0').toFixed(2)}</Text>
      </View>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Paid by</Text>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{payer?.name ?? '—'}</Text>
      </View>
      <View style={[s.row, { borderColor: colors.border }]}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>Split</Text>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>
          {splitType === 'EQUAL' ? `${splitType} (${perPerson}/person)` : splitType}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 0.5 } });
```

- [ ] **Step 6: Write `app/group/[id]/expense/new.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../../../../src/theme/useTheme';
import { useAppDispatch, useAppSelector } from '../../../../src/store/hooks';
import { createExpense, fetchGroupBalances, fetchTransactions } from '../../../../src/store/slices/groupSlice';
import { StepAmount } from '../../../../src/components/expense-form/StepAmount';
import { StepSplit } from '../../../../src/components/expense-form/StepSplit';
import { StepReview } from '../../../../src/components/expense-form/StepReview';
import { ExpenseFormData } from '../../../../src/components/expense-form/types';

const schema = z.object({
  amount: z.string().min(1).refine(v => parseFloat(v) > 0, 'Amount must be positive'),
  description: z.string().min(1, 'Description required'),
  payerId: z.string().min(1, 'Select who paid'),
  splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES']),
  splits: z.array(z.object({ memberId: z.string(), amount: z.string().optional(), percentage: z.string().optional(), share: z.string().optional() })),
});

const STEPS = ['Amount', 'Split', 'Review'];

export default function NewExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography, radius } = useTheme();
  const dispatch = useAppDispatch();
  const group = useAppSelector(s => s.group.groups.find(g => g.id === id));
  const user = useAppSelector(s => s.auth.user);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const myMemberId = group?.members.find(m => m.userId === user?.id)?.id ?? '';

  const { control, handleSubmit, formState: { errors } } = useForm<ExpenseFormData>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '0', description: '', payerId: myMemberId, splitType: 'EQUAL', splits: group?.members.map(m => ({ memberId: m.id })) ?? [] },
  });

  async function onSubmit(data: ExpenseFormData) {
    if (saving) return;
    setSaving(true);
    try {
      const members = group!.members;
      const total = parseFloat(data.amount);
      let splits: unknown[];

      if (data.splitType === 'EQUAL') {
        const each = total / members.length;
        splits = members.map(m => ({ memberId: m.id, amount: parseFloat(each.toFixed(2)) }));
      } else {
        splits = data.splits.map(s => {
          if (data.splitType === 'EXACT') return { memberId: s.memberId, amount: parseFloat(s.amount ?? '0') };
          if (data.splitType === 'PERCENTAGE') return { memberId: s.memberId, percentage: parseFloat(s.percentage ?? '0') };
          return { memberId: s.memberId, share: parseInt(s.share ?? '1') };
        });
      }

      await dispatch(createExpense({
        groupId: id,
        data: { description: data.description, amount: total, payerId: data.payerId, splitType: data.splitType, splits, date: new Date().toISOString() },
      })).unwrap();

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dispatch(fetchGroupBalances(id));
      dispatch(fetchTransactions(id));
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}><X size={24} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>New Expense</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Progress bar */}
      <View style={[s.progress, { backgroundColor: colors.border }]}>
        <View style={[s.progressFill, { backgroundColor: colors.primary, width: `${((step + 1) / STEPS.length) * 100}%` }]} />
      </View>

      <View style={{ flex: 1 }}>
        {step === 0 && <StepAmount control={control} />}
        {step === 1 && <StepSplit control={control} members={group?.members ?? []} />}
        {step === 2 && <StepReview control={control} members={group?.members ?? []} />}
      </View>

      <View style={[s.footer, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderTopColor: colors.border }]}>
        {step > 0 && (
          <TouchableOpacity onPress={() => setStep(s => s - 1)} style={[s.backBtn, { borderColor: colors.border, borderRadius: radius.button }]}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={step < STEPS.length - 1 ? () => setStep(s => s + 1) : handleSubmit(onSubmit)}
          style={[s.nextBtn, { backgroundColor: colors.primary, borderRadius: radius.button, marginLeft: step > 0 ? spacing[12] : 0 }]}
        >
          <Text style={[typography.bodyMedium, { color: '#fff' }]}>{step < STEPS.length - 1 ? 'Next' : saving ? 'Saving…' : 'Save Expense'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5 },
  progress: { height: 3 },
  progressFill: { height: 3 },
  footer: { flexDirection: 'row', borderTopWidth: 0.5 },
  backBtn: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  nextBtn: { flex: 2, height: 50, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 7: Install zod resolver**

```bash
cd money-split-mobile && npm install @hookform/resolvers
```

- [ ] **Step 8: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): 3-step add expense modal with custom keypad and all 4 split types"
```

---

### Task 7: Settle Up bottom sheet

**Files:**
- Create: `money-split-mobile/app/group/[id]/settle.tsx`
- Create: `money-split-mobile/src/components/group-detail/SettlementList.tsx`

**Interfaces:**
- Consumes: `settlements` from Redux, `settleUp` thunk, `@gorhom/bottom-sheet`
- Produces: Settle Up screen listing suggestions + settlement confirmation sheet

- [ ] **Step 1: Write `src/components/group-detail/SettlementList.tsx`**

```typescript
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SettlementSuggestion } from '../../types';

interface Props {
  suggestions: SettlementSuggestion[];
  onSettle: (suggestion: SettlementSuggestion) => void;
  myMemberId: string;
}

export function SettlementList({ suggestions, onSettle, myMemberId }: Props) {
  const { colors, spacing, typography, radius } = useTheme();
  if (!suggestions.length) return (
    <View style={{ padding: spacing[32], alignItems: 'center' }}>
      <Text style={{ fontSize: 40 }}>🎉</Text>
      <Text style={[typography.h3, { color: colors.textPrimary, marginTop: spacing[12], textAlign: 'center' }]}>All settled up!</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing[8], textAlign: 'center' }]}>Nothing left to pay.</Text>
    </View>
  );

  return (
    <View>
      {suggestions.map((s, i) => {
        const isMe = s.fromMemberId === myMemberId;
        return (
          <View key={i} style={[style.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, padding: spacing[16], marginBottom: spacing[8] }]}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>
                {isMe ? 'You' : s.fromName} → {s.toName}
              </Text>
              <Text style={[typography.currencyInline, { color: colors.owes, marginTop: 4 }]}>${s.amount.toFixed(2)}</Text>
            </View>
            {isMe && (
              <TouchableOpacity onPress={() => onSettle(s)}
                style={[{ backgroundColor: colors.accent, borderRadius: radius.button, paddingHorizontal: spacing[16], paddingVertical: spacing[8] }]}>
                <Text style={[typography.bodyMedium, { color: '#fff' }]}>Pay</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

const style = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 } });
```

- [ ] **Step 2: Write `app/group/[id]/settle.tsx`**

```typescript
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRef, useCallback, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../src/theme/useTheme';
import { useAppDispatch, useAppSelector } from '../../../src/store/hooks';
import { settleUp, settleAll, fetchGroupBalances, fetchSettlements, fetchTransactions } from '../../../src/store/slices/groupSlice';
import { SettlementList } from '../../../src/components/group-detail/SettlementList';
import { SettlementSuggestion } from '../../../src/types';

export default function SettleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography, radius } = useTheme();
  const dispatch = useAppDispatch();
  const group = useAppSelector(s => s.group.groups.find(g => g.id === id));
  const settlements = useAppSelector(s => s.group.settlements[id] ?? []);
  const user = useAppSelector(s => s.auth.user);
  const myMemberId = group?.members.find(m => m.userId === user?.id)?.id ?? '';

  const [selected, setSelected] = useState<SettlementSuggestion | null>(null);
  const sheetRef = useRef<BottomSheet>(null);

  function openSheet(suggestion: SettlementSuggestion) {
    setSelected(suggestion);
    sheetRef.current?.expand();
  }

  async function confirmSettle() {
    if (!selected) return;
    try {
      await dispatch(settleUp({ groupId: id, data: { payerId: selected.fromMemberId, payeeId: selected.toMemberId, amount: selected.amount, currency: group?.currency ?? 'USD' } })).unwrap();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      sheetRef.current?.close();
      dispatch(fetchGroupBalances(id));
      dispatch(fetchSettlements(id));
      dispatch(fetchTransactions(id));
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  return (
    <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}><ArrowLeft size={24} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>Settle Up</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing[16] }}>
        {settlements.length > 0 && (
          <View style={[{ backgroundColor: colors.owed + '15', borderRadius: radius.card, padding: spacing[12], marginBottom: spacing[16] }]}>
            <Text style={[typography.caption, { color: colors.owed }]}>💡 {settlements.length} payment{settlements.length > 1 ? 's' : ''} clear all debts — minimum possible</Text>
          </View>
        )}
        <SettlementList suggestions={settlements} onSettle={openSheet} myMemberId={myMemberId} />
        {settlements.length > 1 && (
          <TouchableOpacity
            onPress={async () => { await dispatch(settleAll(id)); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); dispatch(fetchGroupBalances(id)); dispatch(fetchSettlements(id)); }}
            style={[{ backgroundColor: colors.accent, borderRadius: radius.button, padding: spacing[16], alignItems: 'center', marginTop: spacing[16] }]}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>Settle All Up</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomSheet ref={sheetRef} index={-1} snapPoints={['40%']} enablePanDownToClose backgroundStyle={{ backgroundColor: colors.surfaceRaised }} handleIndicatorStyle={{ backgroundColor: colors.border }}>
        <BottomSheetView style={{ padding: spacing[24], alignItems: 'center' }}>
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8] }]}>Confirm payment</Text>
          <Text style={[typography.currencyLarge, { color: colors.textPrimary, marginBottom: spacing[8] }]}>${selected?.amount.toFixed(2)}</Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing[24] }]}>to {selected?.toName}</Text>
          <TouchableOpacity onPress={confirmSettle} style={[{ backgroundColor: colors.accent, borderRadius: radius.button, width: '100%', height: 50, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>Confirm Settlement</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => sheetRef.current?.close()} style={{ marginTop: spacing[12] }}>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({ header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5 } });
```

- [ ] **Step 3: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): settle up screen with bottom sheet confirmation"
```

---

### Task 8: Real-time Socket.IO integration

**Files:**
- Create: `money-split-mobile/src/lib/socket.ts`
- Create: `money-split-mobile/src/hooks/useGroupEvents.ts`
- Create: `money-split-mobile/src/components/SocketManager.tsx`

**Interfaces:**
- Consumes: `auth.token` from Redux, `socketExpenseAdded/Updated/Deleted`, `socketSettlementAdded`, `socketMemberJoined`, `socketGroupUpdated` reducers, `fetchGroupBalances`, `fetchTransactions`
- Produces: singleton socket, `useGroupEvents(groupId)` hook that syncs real-time events into Redux

- [ ] **Step 1: Write `src/lib/socket.ts`**

```typescript
import { io, Socket } from 'socket.io-client';

const BASE = process.env.EXPO_PUBLIC_API_URL!;
let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(`${BASE}/events`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
```

- [ ] **Step 2: Write `src/hooks/useGroupEvents.ts`**

```typescript
import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { socketExpenseAdded, socketExpenseUpdated, socketExpenseDeleted, socketSettlementAdded, socketMemberJoined, socketGroupUpdated, fetchGroupBalances, fetchTransactions } from '../store/slices/groupSlice';
import { Expense, Settlement, GroupMember, Group } from '../types';
import { getSocket } from '../lib/socket';

export function useGroupEvents(groupId: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector(s => s.auth.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const room = `group:${groupId}`;

    function joinRoom() { socket.emit('join_group', groupId); }

    socket.on('connect', joinRoom);
    if (socket.connected) joinRoom();

    socket.on('expense_created', (expense: Expense) => {
      dispatch(socketExpenseAdded(expense));
      dispatch(fetchGroupBalances(groupId));
      dispatch(fetchTransactions(groupId));
    });
    socket.on('expense_updated', (expense: Expense) => {
      dispatch(socketExpenseUpdated(expense));
      dispatch(fetchGroupBalances(groupId));
      dispatch(fetchTransactions(groupId));
    });
    socket.on('expense_deleted', ({ expenseId }: { expenseId: string }) => {
      dispatch(socketExpenseDeleted({ groupId, expenseId }));
      dispatch(fetchGroupBalances(groupId));
      dispatch(fetchTransactions(groupId));
    });
    socket.on('settlement_updated', (settlement: Settlement) => {
      dispatch(socketSettlementAdded(settlement));
      dispatch(fetchGroupBalances(groupId));
    });
    socket.on('member_joined', (member: GroupMember) => {
      dispatch(socketMemberJoined({ groupId, member }));
    });
    socket.on('group_updated', (group: Partial<Group> & { id: string }) => {
      dispatch(socketGroupUpdated(group));
    });

    // Reconnect on foreground
    function handleAppState(next: AppStateStatus) {
      if (next === 'active') { if (!socket.connected) socket.connect(); else joinRoom(); }
      if (next === 'background') socket.disconnect();
    }
    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      socket.off('connect', joinRoom);
      socket.off('expense_created');
      socket.off('expense_updated');
      socket.off('expense_deleted');
      socket.off('settlement_updated');
      socket.off('member_joined');
      socket.off('group_updated');
      socket.emit('leave_group', groupId);
      sub.remove();
    };
  }, [groupId, token]);
}
```

- [ ] **Step 3: Write `src/components/SocketManager.tsx`**

```typescript
import { useEffect } from 'react';
import { useAppSelector } from '../store/hooks';
import { getSocket, disconnectSocket } from '../lib/socket';

export function SocketManager() {
  const token = useAppSelector(s => s.auth.token);
  useEffect(() => {
    if (token) getSocket(token);
    return () => { if (!token) disconnectSocket(); };
  }, [token]);
  return null;
}
```

- [ ] **Step 4: Add `SocketManager` to root layout**

Edit `money-split-mobile/app/_layout.tsx` — add `<SocketManager />` inside `<PersistGate>` before `<Stack>`:

```typescript
import { SocketManager } from '../src/components/SocketManager';
// inside PersistGate:
<SocketManager />
<Stack screenOptions={{ headerShown: false }} />
```

- [ ] **Step 5: Wire `useGroupEvents` in Group Detail**

Edit `money-split-mobile/app/group/[id]/index.tsx` — add after the other hooks:

```typescript
import { useGroupEvents } from '../../../src/hooks/useGroupEvents';
// inside component:
useGroupEvents(id);
```

- [ ] **Step 6: Verify real-time: two clients sync**

Start backend + web app. Open mobile app and web on same group. Add expense in web — confirm mobile list updates within ~1 second without manual refresh.

- [ ] **Step 7: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): socket.io real-time integration with AppState foreground/background handling"
```

---

### Task 9: Create group + join group screens

**Files:**
- Create: `money-split-mobile/app/group/new.tsx`
- Create: `money-split-mobile/app/group/join.tsx`

**Interfaces:**
- Consumes: `POST /groups`, `POST /groups/join` via `api.post`
- Produces: Create group form, join-by-code form, both navigating to new group on success

- [ ] **Step 1: Write `app/group/new.tsx`**

```typescript
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/useTheme';
import { useAppDispatch } from '../../src/store/hooks';
import { fetchGroups } from '../../src/store/slices/groupSlice';
import { api } from '../../src/lib/api';
import { Group } from '../../src/types';

const CURRENCIES = ['USD', 'EUR', 'VND', 'GBP', 'SGD'];

export default function NewGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography, radius } = useTheme();
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    setSaving(true);
    try {
      const group = await api.post<Group>('/groups', { name: name.trim(), currency });
      await dispatch(fetchGroups());
      router.replace(`/group/${group.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}><ArrowLeft size={24} color={colors.textPrimary} /></TouchableOpacity>
          <Text style={[typography.h3, { color: colors.textPrimary }]}>New Group</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ padding: spacing[16] }}>
          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing[8], textTransform: 'uppercase' }]}>Group name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Weekend trip, Apartment, …" placeholderTextColor={colors.textDisabled}
            style={[s.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.chip }]} />
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing[20], marginBottom: spacing[8], textTransform: 'uppercase' }]}>Currency</Text>
          <View style={s.chips}>
            {CURRENCIES.map(c => (
              <TouchableOpacity key={c} onPress={() => setCurrency(c)}
                style={[s.chip, { backgroundColor: currency === c ? colors.primary : colors.surface, borderColor: currency === c ? colors.primary : colors.border, borderRadius: radius.chip }]}>
                <Text style={[typography.bodyMedium, { color: currency === c ? '#fff' : colors.textPrimary }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={handleCreate} disabled={saving}
            style={[{ backgroundColor: colors.primary, borderRadius: radius.button, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing[32] }]}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>{saving ? 'Creating…' : 'Create Group'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/group/join')} style={{ marginTop: spacing[16], alignItems: 'center' }}>
            <Text style={[typography.body, { color: colors.primary }]}>Join with invite code instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5 },
  input: { borderWidth: 1, padding: 14, fontSize: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1 },
});
```

- [ ] **Step 2: Write `app/group/join.tsx`**

```typescript
import { View, Text, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/useTheme';
import { useAppDispatch } from '../../src/store/hooks';
import { fetchGroups } from '../../src/store/slices/groupSlice';
import { api } from '../../src/lib/api';
import { Group } from '../../src/types';

export default function JoinGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, spacing, typography, radius } = useTheme();
  const dispatch = useAppDispatch();
  const [code, setCode] = useState(params.code ?? '');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (code.trim().length !== 8) { Alert.alert('Enter the 8-character invite code'); return; }
    setLoading(true);
    try {
      const group = await api.post<Group>('/groups/join', { inviteCode: code.trim().toUpperCase() });
      await dispatch(fetchGroups());
      router.replace(`/group/${group.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()}><ArrowLeft size={24} color={colors.textPrimary} /></TouchableOpacity>
          <Text style={[typography.h3, { color: colors.textPrimary }]}>Join Group</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ padding: spacing[16] }}>
          <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing[20] }]}>
            Enter the 8-character invite code shared by the group owner.
          </Text>
          <TextInput value={code} onChangeText={t => setCode(t.toUpperCase())} placeholder="ABCD1234"
            autoCapitalize="characters" maxLength={8} autoFocus
            placeholderTextColor={colors.textDisabled}
            style={[s.codeInput, { color: colors.textPrimary, borderColor: colors.primary, backgroundColor: colors.surface, borderRadius: radius.chip }]} />
          <TouchableOpacity onPress={handleJoin} disabled={loading}
            style={[{ backgroundColor: colors.primary, borderRadius: radius.button, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: spacing[24] }]}>
            <Text style={[typography.bodyMedium, { color: '#fff' }]}>{loading ? 'Joining…' : 'Join Group'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5 },
  codeInput: { borderWidth: 2, padding: 16, fontSize: 28, textAlign: 'center', letterSpacing: 6, fontWeight: '700' },
});
```

- [ ] **Step 3: Commit**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): create group and join group screens"
```

---

### Task 10: Polish — haptics, dark mode, deep links, README

**Files:**
- Modify: `money-split-mobile/app.json` (add deep link intent filters for Android)
- Create: `money-split-mobile/app/join/[code].tsx`
- Create: `money-split-mobile/README.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: deep link handler for `money-split://join/[code]`, Android intent filter, mobile README

- [ ] **Step 1: Add deep-link intent filter to `app.json`**

Add under `android` key:
```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": true,
    "data": [{ "scheme": "money-split" }],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```

- [ ] **Step 2: Write `app/join/[code].tsx` — deep link join prefill**

```typescript
import { Redirect } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';

export default function JoinCodeRedirect() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={`/group/join?code=${code}`} />;
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd money-split-mobile && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Write `money-split-mobile/README.md`**

```markdown
# Split Money — Mobile

React Native + Expo companion to the Split Money web app. iOS and Android.

## Stack

| Layer | Tech |
|---|---|
| Framework | Expo SDK 52 + Expo Router |
| State | Redux Toolkit + redux-persist |
| Real-time | socket.io-client 4.8.x |
| Auth | Google OAuth via expo-web-browser deep link |
| Storage | expo-secure-store (JWT) + AsyncStorage (Redux persist) |

## Getting Started

```bash
cd money-split-mobile
npm install
cp .env.example .env   # fill EXPO_PUBLIC_API_URL and EXPO_PUBLIC_API_PUBLIC_URL
npx expo start
```

Scan the QR code with Expo Go, or press `i` for iOS simulator / `a` for Android emulator.

## Environment Variables

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | NestJS backend base URL (can be internal/Docker) |
| `EXPO_PUBLIC_API_PUBLIC_URL` | Publicly reachable backend URL (used for OAuth redirect) |

## Deep Links

- `money-split://auth/callback?token=<jwt>` — OAuth callback
- `money-split://join/<code>` — Prefills invite code on Join screen
```

- [ ] **Step 5: Final end-to-end smoke test on physical device**

Run these scenarios without developer narration:
1. Cold launch → login with Google → lands on Groups list
2. Create group → add 3 expenses (equal, exact, percentage) → check balances update
3. Open same group on web app → add expense → confirm mobile updates within ~1 second
4. Settle up → confirm settlement → balance goes to $0
5. Log out → app returns to login

- [ ] **Step 6: Commit and push**

```bash
git add money-split-mobile/
git commit -m "feat(mobile): deep links, dark mode polish, final smoke test passing"
```
