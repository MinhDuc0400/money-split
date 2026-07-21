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
  const group = useAppSelector(state => state.group.groups.find(g => g.id === id));
  const user = useAppSelector(state => state.auth.user);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const myMemberId = group?.members.find(m => m.userId === user?.id)?.id ?? '';

  const { control, handleSubmit } = useForm<ExpenseFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: '0',
      description: '',
      payerId: myMemberId,
      splitType: 'EQUAL',
      splits: group?.members.map(m => ({ memberId: m.id })) ?? [],
    },
  });

  async function onSubmit(data: ExpenseFormData) {
    if (saving || !group) return;
    setSaving(true);
    try {
      const members = group.members;
      const total = parseFloat(data.amount);
      let splits: unknown[];

      if (data.splitType === 'EQUAL') {
        const each = total / members.length;
        splits = members.map(m => ({ memberId: m.id, amount: parseFloat(each.toFixed(2)) }));
      } else {
        splits = data.splits.map(sp => {
          if (data.splitType === 'EXACT') return { memberId: sp.memberId, amount: parseFloat(sp.amount ?? '0') };
          if (data.splitType === 'PERCENTAGE') return { memberId: sp.memberId, percentage: parseFloat(sp.percentage ?? '0') };
          return { memberId: sp.memberId, share: parseInt(sp.share ?? '1', 10) };
        });
      }

      await dispatch(createExpense({
        groupId: id,
        data: {
          description: data.description,
          amount: total,
          payerId: data.payerId,
          splitType: data.splitType,
          splits,
          date: new Date().toISOString(),
        },
      })).unwrap();

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dispatch(fetchGroupBalances(id));
      dispatch(fetchTransactions(id));
      router.back();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save expense';
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[s.header, { paddingHorizontal: spacing[16], paddingVertical: spacing[12], borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <X size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[typography.h3, { color: colors.textPrimary }]}>New Expense</Text>
        <View style={{ width: 24 }} />
      </View>

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
          <TouchableOpacity onPress={() => setStep(v => v - 1)} style={[s.backBtn, { borderColor: colors.border, borderRadius: radius.button }]}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={step < STEPS.length - 1 ? () => setStep(v => v + 1) : handleSubmit(onSubmit)}
          disabled={saving}
          style={[s.nextBtn, { backgroundColor: colors.primary, borderRadius: radius.button, marginLeft: step > 0 ? spacing[12] : 0, opacity: saving ? 0.6 : 1 }]}
        >
          <Text style={[typography.bodyMedium, { color: '#fff' }]}>
            {step < STEPS.length - 1 ? 'Next' : saving ? 'Saving…' : 'Save Expense'}
          </Text>
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
