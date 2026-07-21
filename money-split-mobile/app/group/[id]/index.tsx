import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Plus, MoreHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../src/theme/useTheme';
import { useGroupData } from '../../../src/hooks/useGroupData';
import { useGroupEvents } from '../../../src/hooks/useGroupEvents';
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

  useGroupEvents(id);

  const myMemberId = group?.members?.find(m => m.userId === user?.id)?.id;
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
          onPress={() => (router.push as any)(`/group/${id}/settle`)}
          style={[s.actionBtn, { backgroundColor: colors.accent + '20', borderRadius: 10 }]}
        >
          <Text style={[typography.bodyMedium, { color: colors.accent }]}>Settle Up</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => (router.push as any)(`/group/${id}/expense/new`)}
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
