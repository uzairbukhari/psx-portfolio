import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { today } from '@shared/portfolio.ts';
import { MONTH_NAMES, monthTitle, monthValue, parseMonthValue, shiftYearMonth } from '@/data/calendar';
import { makeStyles, useTheme } from '@/theme/ThemeProvider';
import { layout, radii } from '@/theme/tokens';
import { Button, Sheet } from './kit';
import { Icon } from './Icon';

const current = () => ({ year: Number(today().slice(0, 4)), month: Number(today().slice(5, 7)) });

/** Optional month field (the SIP month): step a month at a time, or pick a month and year. Value is 'YYYY-MM' or ''. */
export function MonthPicker({ label, value, onChange, disabled }: { label: string; value: string; onChange: (month: string) => void; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = parseMonthValue(value);
  const [year, setYear] = useState(() => (selected ?? current()).year);
  const now = current();

  function openPicker() {
    setYear((selected ?? now).year);
    // Opening an empty field selects the current month, so one tap on "Use" (or just closing) keeps it.
    if (!selected) onChange(monthValue(now));
    setOpen(true);
  }
  const step = (delta: number) => onChange(monthValue(shiftYearMonth(selected ?? now, delta)));

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: previous month`} disabled={disabled} onPress={() => step(-1)} style={styles.step}>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icon name="chevronRight" size={18} color={colors.ink} />
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${selected ? monthTitle(selected) : 'not set'}. Opens a month list.`}
          disabled={disabled}
          onPress={openPicker}
          style={styles.value}
        >
          <Text style={styles.valueText}>{selected ? monthTitle(selected) : 'No SIP month'}</Text>
          {!selected ? <Text style={styles.sub}>Tap to choose</Text> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: next month`} disabled={disabled} onPress={() => step(1)} style={styles.step}>
          <Icon name="chevronRight" size={18} color={colors.ink} />
        </Pressable>
      </View>

      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={styles.yearRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous year" onPress={() => setYear((y) => y - 1)} style={styles.step}>
            <View style={{ transform: [{ rotate: '180deg' }] }}>
              <Icon name="chevronRight" size={18} color={colors.ink} />
            </View>
          </Pressable>
          <Text style={styles.yearTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
            {year}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next year" onPress={() => setYear((y) => y + 1)} style={styles.step}>
            <Icon name="chevronRight" size={18} color={colors.ink} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {MONTH_NAMES.map((name, i) => {
            const isSelected = selected?.year === year && selected.month === i + 1;
            const isNow = now.year === year && now.month === i + 1;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={`${name} ${year}${isNow ? ', this month' : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(monthValue({ year, month: i + 1 }));
                  setOpen(false);
                }}
                style={[styles.cell, isSelected && styles.cellSelected, isNow && !isSelected && styles.cellNow]}
              >
                <Text style={[styles.cellText, isSelected && { color: colors.onPrimary, fontWeight: '700' }]}>{name.slice(0, 3)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button
            label="No SIP month"
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
          />
          <Button label="Cancel" variant="text" style={{ flex: 1 }} onPress={() => setOpen(false)} />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { color: c.muted, fontSize: 12, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: c.surface, borderColor: c.outline, borderWidth: 1, borderRadius: radii.control, overflow: 'hidden' },
  step: { width: layout.minTarget, minHeight: layout.minTarget, alignItems: 'center', justifyContent: 'center' },
  value: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minHeight: layout.minTarget },
  valueText: { color: c.ink, fontSize: 16, fontWeight: '600' },
  sub: { color: c.muted, fontSize: 12 },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearTitle: { color: c.ink, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '23%', flexGrow: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, borderWidth: 1, borderColor: c.outline },
  cellSelected: { backgroundColor: c.primary, borderColor: c.primary },
  cellNow: { borderColor: c.primary },
  cellText: { color: c.ink, fontSize: 15 },
}));
