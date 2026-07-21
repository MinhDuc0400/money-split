import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRef, useState } from 'react';
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
  const group = useAppSelector(st => st.group.groups.find(g => g.id === id));
  const settlements = useAppSelector(st => st.group.settlements[id] ?? []);
  const user = useAppSelector(st => st.auth.user);
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

  async function handleSettleAll() {
    await dispatch(settleAll(id));
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dispatch(fetchGroupBalances(id));
    dispatch(fetchSettlements(id));
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
            onPress={handleSettleAll}
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
