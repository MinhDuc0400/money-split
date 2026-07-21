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

export type SplitType = 'EVEN' | 'EXACT' | 'PERCENTAGE' | 'SHARES';

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
  from: { memberId: string; name?: string; avatarUrl: string | null };
  to: { memberId: string; name?: string; avatarUrl: string | null };
  amount: number;
  currency: string;
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
