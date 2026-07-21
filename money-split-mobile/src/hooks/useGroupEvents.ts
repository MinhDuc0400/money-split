import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  socketExpenseAdded,
  socketExpenseUpdated,
  socketExpenseDeleted,
  socketSettlementAdded,
  socketMemberJoined,
  socketGroupUpdated,
  fetchGroupBalances,
  fetchTransactions,
} from '../store/slices/groupSlice';
import { Expense, Settlement, GroupMember, Group } from '../types';
import { getSocket } from '../lib/socket';

export function useGroupEvents(groupId: string) {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.auth.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);

    function joinRoom() {
      socket.emit('join_group', groupId);
    }

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
    socket.on('expense_deleted', (payload: { expenseId: string }) => {
      dispatch(socketExpenseDeleted({ groupId, expenseId: payload.expenseId }));
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

    function handleAppState(next: AppStateStatus) {
      if (next === 'active') {
        if (!socket.connected) socket.connect();
        else joinRoom();
      }
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
  }, [groupId, token, dispatch]);
}
