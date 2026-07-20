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
  const groups = useAppSelector((st) => st.group.groups);
  const balances = useAppSelector((st) => st.group.balances);
  const user = useAppSelector((st) => st.auth.user);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    dispatch(fetchGroups());
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await dispatch(fetchGroups());
    setRefreshing(false);
  }

  function getMyBalance(groupId: string): number {
    const memberBalances = balances[groupId] ?? [];
    const group = groups.find((g) => g.id === groupId);
    const myMemberId = group?.members.find((m) => m.userId === user?.id)?.id;
    const me = memberBalances.find((b) => b.memberId === myMemberId);
    return me?.balance ?? 0;
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[s.header, { padding: spacing[16], paddingBottom: spacing[8] }]}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Groups</Text>
        <TouchableOpacity onPress={() => router.push('/group/new' as any)} style={[s.fab, { backgroundColor: colors.primary }]}>
          <Plus size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: spacing[16] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>🤝</Text>
            <Text style={[typography.h3, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing[12] }]}>No groups yet</Text>
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing[8] }]}>
              Create or join a group to get started
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <GroupRow
            group={item}
            balance={getMyBalance(item.id)}
            onPress={() => {
              dispatch(fetchGroupBalances(item.id));
              router.push(`/group/${item.id}` as any);
            }}
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
