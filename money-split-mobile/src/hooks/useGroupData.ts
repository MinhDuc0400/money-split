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

  async function refresh() {
    await Promise.all([
      dispatch(fetchGroupDetail(groupId)),
      dispatch(fetchGroupBalances(groupId)),
      dispatch(fetchSettlements(groupId)),
      dispatch(fetchTransactions(groupId)),
    ]);
  }

  return { group, balances, settlements, transactions, refresh };
}
