import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../lib/api';
import {
  Group, Expense, MemberBalance, SettlementSuggestion, HistoryTransaction,
  GroupMember, Settlement, GroupState,
} from '../../types';

const initialState: GroupState = {
  groups: [], activeGroupId: null,
  expenses: {}, balances: {}, settlements: {}, transactions: {},
  loading: false, error: null,
};

export const fetchGroups = createAsyncThunk('group/fetchGroups', () => api.get<Group[]>('/groups'));
export const fetchGroupDetail = createAsyncThunk('group/fetchGroupDetail', (id: string) => api.get<Group>(`/groups/${id}`));
export const fetchGroupBalances = createAsyncThunk('group/fetchGroupBalances', async (id: string) => {
  const byCurrency = await api.get<Record<string, MemberBalance[]>>(`/groups/${id}/balances`);
  return Object.values(byCurrency ?? {}).flat();
});
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
  api.post<Settlement>(`/groups/${groupId}/settlements`, data));

export const settleAll = createAsyncThunk('group/settleAll', ({ groupId, fromId, toId, items, idempotencyKey }: { groupId: string; fromId: string; toId: string; items: { currency: string; amount: number }[]; idempotencyKey: string }) =>
  api.post<void>(`/groups/${groupId}/settlements/settle-all`, { fromId, toId, items }, { 'Idempotency-Key': idempotencyKey }));

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
        const { groupId, expenseId } = a.meta.arg;
        if (state.expenses[groupId]) {
          state.expenses[groupId] = state.expenses[groupId].filter(e => e.id !== expenseId);
        }
      });
  },
});

export const {
  setActiveGroup, socketExpenseAdded, socketExpenseUpdated, socketExpenseDeleted,
  socketSettlementAdded, socketMemberJoined, socketGroupUpdated,
} = groupSlice.actions;
export default groupSlice.reducer;
