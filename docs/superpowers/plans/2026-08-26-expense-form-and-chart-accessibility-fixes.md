# Expense Form & Chart Accessibility Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three concrete UX gaps found during a ui-ux-pro-max review of the live app: no guidance on why the expense form's first step blocks progress, no percentage/slice-cap accessibility parity on the two pie/donut charts, and several keyboard-unreachable or focus-invisible controls in the expense form.

**Architecture:** All three issues are narrow, additive fixes to existing components — no new components, no schema/API changes, no routing changes. Each task touches a disjoint set of files from the other two, and none of the three overlaps the separate in-flight GroupDetail-tabs placement work (`GroupDetail.tsx`, `Layout.tsx`, `App.tsx`, `MemberManager.tsx`, `GroupAnalytics.tsx` are all explicitly out of scope for this plan — do not touch them even if related).

**Tech Stack:** React 19, TypeScript, Tailwind CSS, recharts (`PieChart`/`Pie`/`Cell`, existing usage only — no new chart types).

## Global Constraints

- Do NOT modify `money-split-app/src/components/GroupDetail.tsx`, `Layout.tsx`, `App.tsx`, `MemberManager.tsx`, or `GroupAnalytics.tsx` — these are being actively restructured by a separate, concurrently-running workstream (the dashboard-analytics-expansion plan). Touching them risks merge conflicts with that work.
- Frontend verification for every task: `npx tsc --noEmit` and `npx eslint <changed files>` (no test runner exists in `money-split-app` — confirmed in the prior analytics plan; this repo's established frontend verification baseline is typecheck + lint + manual preview, not new test files).
- Focus-ring style convention already used elsewhere in this codebase (`AmountInput.tsx`, the currency `<select>` in `ExpenseForm.tsx`): `focus:outline-none focus:ring-2 focus:ring-primary/50` (or `/20` for less prominent fields). New focus rings added by this plan should use `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50` — `focus-visible` (not `focus`) so the ring only appears for keyboard focus, not every mouse click, matching modern a11y best practice without changing the existing codebase's visual language.
- Content voice: sentence case, no exclamation marks (matches `money-split-app/design-system/MASTER.md`, already followed by every other plan in this repo).
- Commit after each task, using the exact commit message given in that task's final step.

---

## File Structure

**Modify (Task 1):**
- `money-split-app/src/components/expense-form/stepValidation.ts` — add `getWhatStepHint`
- `money-split-app/src/components/ExpenseForm.tsx` — render the hint on step 0

**Modify (Task 2):**
- `money-split-app/src/components/dashboard/SpendingByCategoryCard.tsx` — add percentage, cap chart slices at top 5 + "Other"
- `money-split-app/src/components/dashboard/SpendingByPersonCard.tsx` — cap chart slices at top 5 + "Other" (already shows percentage)

**Modify (Task 3):**
- `money-split-app/src/components/expense-form/StepNav.tsx` — focus rings on Back/Next buttons
- `money-split-app/src/components/expense-form/PayerSelector.tsx` — focus ring on member buttons
- `money-split-app/src/components/expense-form/SplitTypeSelector.tsx` — focus ring on split-type buttons
- `money-split-app/src/components/expense-form/SplitEven.tsx` — fix keyboard-unreachable checkbox, add focus ring
- `money-split-app/src/components/ExpenseForm.tsx` — focus ring on category-selector buttons

---

### Task 1: Inline guidance on the expense form's first step

**Files:**
- Modify: `money-split-app/src/components/expense-form/stepValidation.ts`
- Modify: `money-split-app/src/components/ExpenseForm.tsx`

**Interfaces:**
- Consumes: `parseAmount` (existing, `stepValidation.ts`).
- Produces: `getWhatStepHint(description: string, amount: string): string | null` — returns `null` when the step is valid (nothing to show), otherwise a short guidance string. `ExpenseForm.tsx` renders this directly under the amount/description inputs on step 0.

**Expected result:** Today, on step 0 ("What was it?"), the "Next" button is simply disabled (`canProceed` from `isWhatStepValid`) with zero explanation when the description is empty or the amount is zero/invalid — a user has to guess. After this task, a small muted-tone hint appears under the inputs whenever the step isn't yet valid, naming exactly what's missing ("Add a description to continue", "Enter an amount greater than zero to continue", or both combined), and disappears the moment both are satisfied.

- [ ] **Step 1: Add `getWhatStepHint` next to the existing `isWhatStepValid`**

In `money-split-app/src/components/expense-form/stepValidation.ts`, add this function directly after `isWhatStepValid` (currently lines 11-13):

```typescript
export function getWhatStepHint(description: string, amount: string): string | null {
    const hasDescription = description.trim().length > 0;
    const hasAmount = parseAmount(amount) > 0;
    if (hasDescription && hasAmount) return null;
    if (!hasDescription && !hasAmount) return 'Add a description and an amount to continue';
    if (!hasDescription) return 'Add a description to continue';
    return 'Enter an amount greater than zero to continue';
}
```

- [ ] **Step 2: Render the hint on step 0**

In `money-split-app/src/components/ExpenseForm.tsx`, add `getWhatStepHint` to the existing import from `./expense-form/stepValidation` (currently line 17):

```typescript
import { parseAmount, isWhatStepValid, isPayerStepValid, isSplitStepValid, getWhatStepHint } from './expense-form/stepValidation';
```

Inside the `step === 0` block (currently lines 300-350), add the hint directly after the closing `</div>` of the `AmountInput` component (i.e. right after line 309's `<AmountInput ... />`, before the `<div className="space-y-2">` that holds the Currency selector):

```typescript
                    {getWhatStepHint(description, amount) && (
                        <p className="text-xs text-muted-foreground text-center -mt-2">
                            {getWhatStepHint(description, amount)}
                        </p>
                    )}
```

- [ ] **Step 3: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Lint**

```bash
cd money-split-app && npx eslint src/components/expense-form/stepValidation.ts src/components/ExpenseForm.tsx
```

Expected: no new errors.

- [ ] **Step 5: Manual verification via live preview**

Start the app, open "Add expense", and on step 0: confirm the hint reads "Add a description and an amount to continue" on a blank form, updates to just the missing half once one field is filled, and disappears once both are valid. Confirm it doesn't shift layout jarringly (reserve space or accept the small shift — either is fine, just confirm it doesn't look broken).

- [ ] **Step 6: Commit**

```bash
cd money-split-app
git add src/components/expense-form/stepValidation.ts src/components/ExpenseForm.tsx
git commit -m "feat: add inline guidance hint to expense form's first step"
```

---

### Task 2: Chart accessibility — percentage parity and slice cap

**Files:**
- Modify: `money-split-app/src/components/dashboard/SpendingByCategoryCard.tsx`
- Modify: `money-split-app/src/components/dashboard/SpendingByPersonCard.tsx`

**Interfaces:** None — both changes are self-contained inside each card's existing render logic. No prop changes.

**Expected result:** Per the ui-ux-pro-max chart guidance ("pie/donut charts fail WCAG for colorblind users unless paired with a data table; cap slices at 6, beyond that switch representations"), two gaps get fixed:
1. `SpendingByCategoryCard` currently shows only the amount in its legend (`SpendingByPersonCard` already shows both amount and percentage) — add percentage there too, for parity and because the chart-type guidance calls for always labeling slices with a percentage.
2. Neither card currently caps how many slices the pie chart itself renders. A group with 7+ members (for the person chart) or a currency period touching most of the 9 expense categories (for the category chart) produces thin, visually indistinguishable slices. Cap the **chart visual** at the top 5 entries by amount plus one aggregated "Other" slice for everything beyond that — but keep every individual entry in the **legend list below**, so no data is lost, only the pie's slice count is bounded. Below the 6-entry threshold, behavior is unchanged (no "Other" slice appears).

- [ ] **Step 1: Add a shared slice-capping helper**

Both cards need the same "top 5 + Other" logic. Rather than duplicate it, add a small helper to `money-split-app/src/lib/expenseCategories.ts` — wait, that file is category-specific; instead create a new tiny, generic helper file since both a category-keyed and a member-keyed card need it:

Create `money-split-app/src/lib/chartSlices.ts`:

```typescript
export interface SliceCapInput {
    key: string;
    amount: number;
}

export interface CappedSlice extends SliceCapInput {
    isOther: boolean;
}

const MAX_VISIBLE_SLICES = 5;

/**
 * Caps a list of pie-chart slices at MAX_VISIBLE_SLICES by amount, folding
 * everything beyond that into a single "Other" slice. Input order is not
 * assumed sorted; output is sorted descending by amount, with "Other" last.
 * Returns the input unchanged (just sorted) when it already fits.
 */
export function capChartSlices(input: SliceCapInput[]): CappedSlice[] {
    const sorted = [...input].sort((a, b) => b.amount - a.amount);
    if (sorted.length <= MAX_VISIBLE_SLICES + 1) {
        return sorted.map((s) => ({ ...s, isOther: false }));
    }
    const visible = sorted.slice(0, MAX_VISIBLE_SLICES).map((s) => ({ ...s, isOther: false }));
    const rest = sorted.slice(MAX_VISIBLE_SLICES);
    const otherTotal = rest.reduce((sum, s) => sum + s.amount, 0);
    return [...visible, { key: 'other', amount: otherTotal, isOther: true }];
}
```

- [ ] **Step 2: Use it in `SpendingByCategoryCard.tsx`, and add percentage to the legend**

In `money-split-app/src/components/dashboard/SpendingByCategoryCard.tsx`, add the import:

```typescript
import { capChartSlices } from '../../lib/chartSlices';
```

Add a `cappedData` const directly after the existing `chartData` computation (currently lines 20-23), before the `return`:

```typescript
    const cappedData = capChartSlices(chartData.map((d) => ({ key: d.category, amount: d.amount })));
```

Replace the chart-rendering block (currently lines 34-73) with:

```typescript
                <div className="space-y-4">
                    <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                            <Pie
                                data={cappedData}
                                dataKey="amount"
                                nameKey="key"
                                innerRadius={50}
                                outerRadius={80}
                                paddingAngle={2}
                            >
                                {cappedData.map((d) => (
                                    <Cell
                                        key={d.key}
                                        fill={d.isOther ? '#94a3b8' : CATEGORY_COLORS[d.key as ExpenseCategory]}
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(value, name) => [
                                    formatAmount(value as number, currency),
                                    name === 'other' ? 'Other' : CATEGORY_LABELS[name as ExpenseCategory],
                                ]}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-2">
                        {chartData.map((d) => {
                            const Icon = CATEGORY_ICONS[d.category];
                            const total = chartData.reduce((sum, c) => sum + c.amount, 0);
                            const pct = total > 0 ? Math.round((d.amount / total) * 100) : 0;
                            return (
                                <div key={d.category} className="flex items-center gap-2 text-xs">
                                    <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: CATEGORY_COLORS[d.category] }}
                                    />
                                    <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="flex-1 truncate">{CATEGORY_LABELS[d.category]}</span>
                                    <span className="font-bold tabular-nums">{formatAmount(d.amount, currency)}</span>
                                    <span className="text-muted-foreground tabular-nums">{pct}%</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
```

Note the legend (`grid grid-cols-2` block) deliberately keeps iterating the original, uncapped `chartData` — only the `<Pie>`/`<Cell>` chart itself uses `capChartSlices`. This is what preserves "no data lost, only the visual slice count is bounded."

- [ ] **Step 3: Use it in `SpendingByPersonCard.tsx`**

In `money-split-app/src/components/dashboard/SpendingByPersonCard.tsx`, add the import:

```typescript
import { capChartSlices } from '../../lib/chartSlices';
```

Add a `cappedData` const directly after the existing `chartData`/`total` computation, before the `return`:

```typescript
    const cappedData = capChartSlices(chartData.map((d) => ({ key: d.memberId, amount: d.totalCents })));
```

Replace the `<PieChart>` block (currently inside the `chartData.length === 0 ? ... : (...)` branch) so the `<Pie>`/`<Cell>` use `cappedData` while the legend below continues to map over the original `chartData`:

```typescript
                    <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                            <Pie
                                data={cappedData}
                                dataKey="amount"
                                nameKey="key"
                                innerRadius={50}
                                outerRadius={80}
                                paddingAngle={2}
                            >
                                {cappedData.map((d) => (
                                    <Cell
                                        key={d.key}
                                        fill={d.isOther ? '#94a3b8' : getMemberColor(d.key)}
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                formatter={(value, name) => [
                                    formatAmount((value as number) / 100, currency),
                                    name === 'other' ? 'Other' : chartData.find((d) => d.memberId === name)?.name ?? name,
                                ]}
                            />
                        </PieChart>
                    </ResponsiveContainer>
```

(The rest of the file — the legend `.map((d) => ...)` block below the chart — is unchanged; it already iterates the uncapped `chartData` and already shows percentages.)

- [ ] **Step 4: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Lint**

```bash
cd money-split-app && npx eslint src/lib/chartSlices.ts src/components/dashboard/SpendingByCategoryCard.tsx src/components/dashboard/SpendingByPersonCard.tsx
```

Expected: no new errors.

- [ ] **Step 6: Manual verification via live preview**

With a group that has ≤5 categories/members, confirm both charts render exactly as before (no "Other" slice, since it's below the threshold). If you can create a test group with 7+ members, confirm the Spending by Person donut caps at 5 named slices + one "Other" slice, while the legend below still lists every member individually with their own amount and percentage. Confirm the category donut's legend now shows a percentage next to every amount.

- [ ] **Step 7: Commit**

```bash
cd money-split-app
git add src/lib/chartSlices.ts src/components/dashboard/SpendingByCategoryCard.tsx src/components/dashboard/SpendingByPersonCard.tsx
git commit -m "fix: cap pie chart slices at 5 + Other, add percentage parity to category chart legend"
```

---

### Task 3: Keyboard accessibility in the expense form

**Files:**
- Modify: `money-split-app/src/components/expense-form/StepNav.tsx`
- Modify: `money-split-app/src/components/expense-form/PayerSelector.tsx`
- Modify: `money-split-app/src/components/expense-form/SplitTypeSelector.tsx`
- Modify: `money-split-app/src/components/expense-form/SplitEven.tsx`
- Modify: `money-split-app/src/components/ExpenseForm.tsx`

**Interfaces:** None — purely visual/markup changes to existing components, no prop or behavior changes (except the SplitEven checkbox fix, which changes only how the existing `included`/`setIncluded` state is reached, not its shape).

**Expected result:** Two distinct problems, both found by reading the actual components:
1. **A genuine keyboard-trap bug**: `SplitEven.tsx`'s per-member checkbox is a real `<input type="checkbox">` styled with Tailwind's `hidden` class (`display: none`), which removes it from the tab order entirely — keyboard-only users cannot toggle who's included in an even split at all, only mouse/touch users can (via the wrapping `<label>`'s click behavior). After this task, the input is reachable by Tab and toggleable by Space/Enter, with a visible focus ring on the custom checkbox visual.
2. **Missing focus-visible rings**: `StepNav.tsx`'s Back/Next buttons (used on every single step of the form), `PayerSelector.tsx`'s member-select buttons, `SplitTypeSelector.tsx`'s split-type buttons, and `ExpenseForm.tsx`'s category-selector buttons (step 0) have no `focus:`/`focus-visible:` classes at all — keyboard users tabbing through get no visible indication of which control is focused. After this task, all of them show a visible ring on keyboard focus, matching the `focus-visible:ring-2 focus-visible:ring-primary/50` convention already used elsewhere in this form (e.g. `AmountInput.tsx`).

- [ ] **Step 1: Fix the keyboard-unreachable checkbox in `SplitEven.tsx`**

In `money-split-app/src/components/expense-form/SplitEven.tsx`, replace the `<label>` block (currently lines 22-39) with:

```typescript
                    <label key={member.id} className="flex items-center gap-3 cursor-pointer group hover:bg-secondary/30 p-2 rounded-lg transition-colors -mx-2">
                        <input
                            type="checkbox"
                            checked={!!included[member.id]}
                            onChange={(e) => { setIncluded(prev => ({ ...prev, [member.id]: e.target.checked })); }}
                            className="sr-only peer"
                        />
                        <div className={cn(
                            "flex items-center justify-center w-5 h-5 rounded border transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2",
                            included[member.id]
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/30 bg-background group-hover:border-primary/50"
                        )}>
                            {included[member.id] && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                        </div>
                        <Avatar name={member.name} src={member.avatar} className="w-6 h-6" />
                        <span className="flex-1 text-sm flex items-center gap-2">{member.name}{member.isGuest && <GuestTag />}</span>
                    </label>
```

This swaps `hidden` (`display: none`, removes from tab order) for `sr-only` (visually hidden but still focusable and screen-reader-visible — Tailwind's standard accessible-hiding utility, already used elsewhere in this codebase's design system per `MASTER.md`'s accessibility conventions) and adds the `peer`/`peer-focus-visible:` pair so the adjacent custom checkbox visual picks up a ring when the real (now-focusable) input has keyboard focus. Also moved the checkbox above the visual div in markup order — `peer` styling requires the peer element to come first in the DOM.

- [ ] **Step 2: Add focus rings to `StepNav.tsx`**

In `money-split-app/src/components/expense-form/StepNav.tsx`, update the Back button's className (currently lines 13-16) to:

```typescript
                className={cn(
                    'px-5 py-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                    !canGoBack && 'invisible'
                )}
```

And the Next/submit button's className (currently lines 20-23) to:

```typescript
                className={cn(
                    'flex-1 max-w-[240px] bg-primary text-primary-foreground py-3 px-6 rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary',
                    nextDisabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-primary/90 active:scale-[0.98]'
                )}
```

(The Next button uses `ring-primary-foreground`/`ring-offset-primary` instead of the usual `ring-primary` because its own background is already `bg-primary` — a same-color ring would be invisible against it.)

- [ ] **Step 3: Add focus rings to `PayerSelector.tsx`**

In `money-split-app/src/components/expense-form/PayerSelector.tsx`, update the button's className (currently lines 18-22) to:

```typescript
                        className={cn(
                            "flex flex-col items-center gap-1 min-w-[60px] p-2 rounded-lg transition-all border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            payerId === member.id
                                ? "bg-primary/10 border-primary"
                                : "bg-transparent border-transparent hover:bg-secondary/50"
                        )}
```

- [ ] **Step 4: Add focus rings to `SplitTypeSelector.tsx`**

In `money-split-app/src/components/expense-form/SplitTypeSelector.tsx`, update the button's className (currently lines 17-20) to:

```typescript
                    className={cn(
                        "py-2 px-3 rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                        splitType === type ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
```

- [ ] **Step 5: Add focus rings to the category buttons in `ExpenseForm.tsx`**

In `money-split-app/src/components/ExpenseForm.tsx`, update the category button's className (currently lines 337-341) to:

```typescript
                                        className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                                            isSelected
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-border text-muted-foreground hover:bg-secondary/50'
                                        }`}
```

- [ ] **Step 6: Typecheck**

```bash
cd money-split-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 7: Lint**

```bash
cd money-split-app && npx eslint src/components/expense-form/StepNav.tsx src/components/expense-form/PayerSelector.tsx src/components/expense-form/SplitTypeSelector.tsx src/components/expense-form/SplitEven.tsx src/components/ExpenseForm.tsx
```

Expected: no new errors.

- [ ] **Step 8: Manual verification via live preview**

Open "Add expense" and Tab through the entire form using only the keyboard (no mouse): confirm you can reach and toggle every member checkbox on the "Split equally" step, and confirm every button (Back, Next, payer selector, split-type selector, category selector) shows a visible ring when focused via Tab and does NOT show a ring on mouse click (that's the point of `focus-visible` over `focus`). Check both light and dark mode.

- [ ] **Step 9: Commit**

```bash
cd money-split-app
git add src/components/expense-form/StepNav.tsx src/components/expense-form/PayerSelector.tsx src/components/expense-form/SplitTypeSelector.tsx src/components/expense-form/SplitEven.tsx src/components/ExpenseForm.tsx
git commit -m "fix: restore keyboard access to split-evenly checkboxes, add missing focus rings across expense form"
```

---
