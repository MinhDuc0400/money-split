import { SplitType } from '../../types';

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
