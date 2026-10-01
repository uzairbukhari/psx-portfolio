import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { today } from '@shared/portfolio.ts';
import { WEEKDAYS, addDays, monthGrid, monthTitle, shiftYearMonth, spokenDate } from '@/data/calendar';
import { isIsoDate } from '@/data/mutations';
import { makeStyles, useTheme } from '@/theme/ThemeProvider';
import { layout, radii } from '@/theme/tokens';
import { Button, Sheet } from './kit';
import { Icon } from './Icon';

const parts = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

/** Date field built from JS only: step a day at a time, or open a month grid. Value is 'YYYY-MM-DD'. */
export function DatePicker({ label, value, onChange, disabled }: { label: string; value: string; onChange: (date: string) => void; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const valid = isIsoDate(value);
  const [view, setView] = useState(() => parts(valid ? value : today()));
  const [draft, setDraft] = useState(valid ? value : today());
  const todayIso = today();

  function openPicker() {
    const start = valid ? value : todayIso;
    setDraft(start);
    setView(parts(start));
    setOpen(true);
  }
  const step = (days: number) => onChange(addDays(valid ? value : todayIso, days));

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: previous day`} disabled={disabled} onPress={() => step(-1)} style={styles.step}>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icon name="chevronRight" size={18} color={colors.ink} />
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${valid ? spokenDate(value) : 'not set'}. Opens a calendar.`}
          disabled={disabled}
          onPress={openPicker}
          style={styles.value}
        >
          <Text style={styles.valueText}>{valid ? value : 'Choose a date'}</Text>
          {valid ? <Text style={styles.sub}>{spokenDate(value)}{value === todayIso ? ' · today' : ''}</Text> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: next day`} disabled={disabled} onPress={() => step(1)} style={styles.step}>
          <Icon name="chevronRight" size={18} color={colors.ink} />
        </Pressable>
      </View>

      <Sheet visible={open} onClose={() => setOpen(false)}>
            <View style={styles.monthRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setView((v) => shiftYearMonth(v, -1))} style={styles.step}>
                <View style={{ transform: [{ rotate: '180deg' }] }}>
                  <Icon name="chevronRight" size={18} color={colors.ink} />
                </View>
              </Pressable>
              <Text style={styles.monthTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
                {monthTitle(view)}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setView((v) => shiftYearMonth(v, 1))} style={styles.step}>
                <Icon name="chevronRight" size={18} color={colors.ink} />
              </Pressable>
            </View>
            <View style={styles.week} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {WEEKDAYS.map((d) => (
                <Text key={d} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>
            {monthGrid(view.year, view.month).map((week, i) => (
              <View key={i} style={styles.week}>
                {week.map((day, j) =>
                  day ? (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityLabel={`${spokenDate(day)}${day === todayIso ? ', today' : ''}`}
                      accessibilityState={{ selected: day === draft }}
                      onPress={() => setDraft(day)}
                      style={[styles.day, day === draft && styles.daySelected, day === todayIso && day !== draft && styles.dayToday]}
                    >
                      <Text style={[styles.dayText, day === draft && { color: colors.onPrimary, fontWeight: '700' }]}>{Number(day.slice(8))}</Text>
                    </Pressable>
                  ) : (
                    <View key={`pad-${j}`} style={styles.day} />
                  ),
                )}
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button
                label="Today"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => {
                  setDraft(todayIso);
                  setView(parts(todayIso));
                }}
              />
              <Button
                label="Use this date"
                icon="check"
                style={{ flex: 1.4 }}
                onPress={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              />
            </View>
            <Button label="Cancel" variant="text" onPress={() => setOpen(false)} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { color: c.muted, fontSize: 12, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: c.surface, borderColor: c.outline, borderWidth: 1, borderRadius: radii.control, overflow: 'hidden' },
  step: { width: layout.minTarget, minHeight: layout.minTarget, alignItems: 'center', justifyContent: 'center' },
  value: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minHeight: layout.minTarget },
  valueText: { color: c.ink, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sub: { color: c.muted, fontSize: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { color: c.ink, fontSize: 17, fontWeight: '600' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: c.muted, fontSize: 12, paddingVertical: 6 },
  day: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control },
  daySelected: { backgroundColor: c.primary },
  dayToday: { borderWidth: 1, borderColor: c.primary },
  dayText: { color: c.ink, fontSize: 15, fontVariant: ['tabular-nums'] },
}));
