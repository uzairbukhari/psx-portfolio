import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { filterCompanies } from '@/data/entry-form';
import { makeStyles, useTheme } from '@/theme/ThemeProvider';
import { layout, radii } from '@/theme/tokens';
import { Input, Muted } from './kit';

const VISIBLE = 6;
export const NEW_COMPANY = '__new';

type Company = { ticker: string; name: string };

/** Search box plus a short result list; choosing a row selects the ticker. `allowNew` adds "+ New company". */
export function CompanyPicker({
  companies,
  value,
  onChange,
  allowNew,
  newSelected,
  disabled,
}: {
  companies: Company[];
  value: string;
  onChange: (ticker: string) => void;
  allowNew?: boolean;
  newSelected?: boolean;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => filterCompanies(companies, query), [companies, query]);
  // Keep the chosen company visible even when the search would hide it.
  const chosen = companies.find((c) => c.ticker === value);
  const shown = useMemo(() => {
    const head = matches.slice(0, VISIBLE);
    return chosen && !head.some((c) => c.ticker === chosen.ticker) && !query.trim() ? [chosen, ...head.slice(0, VISIBLE - 1)] : head;
  }, [matches, chosen, query]);
  const row = (key: string, title: string, subtitle: string, selected: boolean) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => onChange(key)}
      style={({ pressed }) => [styles.row, selected && styles.rowOn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.ticker, selected && { color: colors.primary }]}>{title}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {subtitle}
      </Text>
      {selected ? <Text style={{ color: colors.primary, fontWeight: '700' }}>Selected</Text> : null}
    </Pressable>
  );
  return (
    <View style={{ gap: 8, opacity: disabled ? 0.6 : 1 }}>
      {disabled ? null : (
        <Input label="Search companies" value={query} onChangeText={setQuery} placeholder="Ticker or name" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search companies by ticker or name" />
      )}
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
        {(disabled ? (chosen ? [chosen] : []) : shown).map((c) => row(c.ticker, c.ticker, c.name, !newSelected && value === c.ticker))}
        {allowNew && !disabled ? row(NEW_COMPANY, '+ New company', 'Add a symbol that is not in your list', Boolean(newSelected)) : null}
      </View>
      {!disabled && matches.length === 0 ? <Muted>No company matches “{query.trim()}”. Use + New company to add it.</Muted> : null}
      {!disabled && matches.length > shown.length ? <Muted>Showing {shown.length} of {matches.length}. Type to narrow the list.</Muted> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.minTarget, paddingHorizontal: 14, borderRadius: radii.control, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
  rowOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  ticker: { color: c.ink, fontSize: 15, fontWeight: '700', minWidth: 64 },
  name: { flex: 1, color: c.muted, fontSize: 13 },
}));
