import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { AccessibleText as Text } from '../../components/AccessibleText';
import { useSession } from '@/contexts/SessionContext';
import { api } from '../../utils/apiClient';
import { ACCESSIBLE_COLORS } from '../../theme/accessibility';
import type {
  DailyAlarmSymptom,
  DailyEntry,
  DailyEntryInput,
  DailyOtherSymptom,
} from '../../types/api.types';

const ALARM_SYMPTOMS = [
  ['sangramento', 'Sangramento'],
  ['perda_liquido', 'Perda de líquido'],
  ['cefaleia_intensa', 'Dor de cabeça intensa'],
  ['febre', 'Febre'],
  ['contracoes', 'Contrações'],
] as const;

const OTHER_SYMPTOMS = [
  ['enjoo', 'Enjoo'],
  ['azia', 'Azia'],
  ['dor_costas', 'Dor nas costas'],
  ['inchaco_leve', 'Inchaço leve'],
  ['cansaco', 'Cansaço'],
] as const;

function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatEntryDate(value: string): string {
  const [year, month, day] = value.split('-');
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export default function DiarioScreen() {
  const { user } = useSession();
  const pregnantId = user?.pregnant_id;
  const [pregnancyId, setPregnancyId] = useState<number | null>(null);
  const [gestationalWeeks, setGestationalWeeks] = useState<number | null>(null);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [entryDate, setEntryDate] = useState(todayLocal());
  const [alarmSymptoms, setAlarmSymptoms] = useState<DailyAlarmSymptom[]>([]);
  const [otherSymptoms, setOtherSymptoms] = useState<DailyOtherSymptom[]>([]);
  const [freeText, setFreeText] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [weight, setWeight] = useState('');
  const [glucose, setGlucose] = useState('');
  const [reducedMovements, setReducedMovements] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiary = useCallback(async () => {
    if (!pregnantId) {
      setError('Não encontramos a gestação vinculada a esta conta.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const patient = await api.get(`/pregnants/${pregnantId}`);
      const pregnancy = patient.data?.latest_pregnancy;
      if (!pregnancy?.id) {
        setError('Cadastre uma gestação antes de registrar o diário.');
        return;
      }
      setPregnancyId(Number(pregnancy.id));
      setGestationalWeeks(Number.isFinite(Number(pregnancy.weeks)) ? Number(pregnancy.weeks) : null);
      const response = await api.get(`/daily-entries/pregnancies/${pregnancy.id}`);
      setEntries(response.data as DailyEntry[]);
      setError(null);
    } catch {
      setError('Não foi possível carregar o diário. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [pregnantId]);

  useFocusEffect(useCallback(() => {
    void loadDiary();
  }, [loadDiary]));

  const hasData = useMemo(() => (
    alarmSymptoms.length > 0 ||
    otherSymptoms.length > 0 ||
    freeText.trim().length > 0 ||
    systolic.trim().length > 0 ||
    diastolic.trim().length > 0 ||
    weight.trim().length > 0 ||
    glucose.trim().length > 0 ||
    reducedMovements !== null
  ), [alarmSymptoms, otherSymptoms, freeText, systolic, diastolic, weight, glucose, reducedMovements]);

  function toggleValue<T extends string>(value: T, current: T[], setValue: (next: T[]) => void) {
    setValue(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function resetForm() {
    setEntryDate(todayLocal());
    setAlarmSymptoms([]);
    setOtherSymptoms([]);
    setFreeText('');
    setSystolic('');
    setDiastolic('');
    setWeight('');
    setGlucose('');
    setReducedMovements(null);
    setEditingKey(null);
  }

  function startEditing(entry: DailyEntry) {
    setEditingKey(entry.entry_key);
    setEntryDate(entry.entry_date);
    setAlarmSymptoms(entry.alarm_symptoms);
    setOtherSymptoms(entry.other_symptoms);
    setFreeText(entry.free_text || '');
    setSystolic(entry.systolic === null ? '' : String(entry.systolic));
    setDiastolic(entry.diastolic === null ? '' : String(entry.diastolic));
    setWeight(entry.weight_kg === null ? '' : String(entry.weight_kg));
    setGlucose(entry.glucose_mg_dl === null ? '' : String(entry.glucose_mg_dl));
    setReducedMovements(entry.reduced_fetal_movements);
  }

  async function saveEntry() {
    if (!pregnancyId || saving) return;
    if (!hasData) {
      Alert.alert('Preencha um dado', 'Informe pelo menos um sintoma ou medida antes de salvar.');
      return;
    }
    const payload: DailyEntryInput = {
      pregnancy_id: pregnancyId,
      entry_date: entryDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Recife',
      alarm_symptoms: alarmSymptoms,
      other_symptoms: otherSymptoms,
      free_text: freeText.trim() || undefined,
      systolic: parseNumber(systolic),
      diastolic: parseNumber(diastolic),
      weight_kg: parseNumber(weight),
      glucose_mg_dl: parseNumber(glucose),
      reduced_fetal_movements: reducedMovements === null ? undefined : reducedMovements,
    };
    try {
      setSaving(true);
      if (editingKey) {
        await api.put(`/daily-entries/${editingKey}`, payload);
      } else {
        await api.post('/daily-entries', payload);
      }
      resetForm();
      await loadDiary();
      Alert.alert('Diário atualizado', editingKey ? 'A correção foi salva mantendo o histórico.' : 'O registro foi salvo.');
    } catch {
      Alert.alert('Não foi salvo', 'Verifique sua conexão e tente novamente. Nenhum registro parcial foi criado.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <SafeAreaView style={styles.safe}><ActivityIndicator size="large" color={ACCESSIBLE_COLORS.primary} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Diário da gestação</Text>
        <Text style={styles.subtitle}>Registre como você está hoje. Os dados ficam ligados à sua gestação.</Text>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tentar carregar o diário novamente" onPress={() => void loadDiary()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : null}

        {pregnancyId ? (
          <>
            <Text style={styles.sectionTitle}>{editingKey ? 'Corrigir registro' : 'Registrar hoje'}</Text>
            <Text style={styles.label}>Data</Text>
            <TextInput accessibilityLabel="Data do registro" style={styles.input} value={entryDate} onChangeText={setEntryDate} placeholder="AAAA-MM-DD" keyboardType="numbers-and-punctuation" editable={!saving} />

            <Text style={styles.sectionTitle}>Sintomas de alarme</Text>
            <Text style={styles.helper}>Se marcar algum sinal de alarme, procure atendimento. O diário não substitui avaliação médica.</Text>
            <View style={styles.chipRow}>
              {ALARM_SYMPTOMS.map(([value, label]) => {
                const selected = alarmSymptoms.includes(value);
                return <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={() => toggleValue(value, alarmSymptoms, setAlarmSymptoms)} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
              })}
            </View>

            <Text style={styles.sectionTitle}>Outros sintomas</Text>
            <View style={styles.chipRow}>
              {OTHER_SYMPTOMS.map(([value, label]) => {
                const selected = otherSymptoms.includes(value);
                return <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={() => toggleValue(value, otherSymptoms, setOtherSymptoms)} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
              })}
            </View>

            <Text style={styles.sectionTitle}>Medidas</Text>
            <View style={styles.row}>
              <Field label="Sistólica (mmHg)" value={systolic} onChange={setSystolic} testID="daily-systolic" />
              <Field label="Diastólica (mmHg)" value={diastolic} onChange={setDiastolic} testID="daily-diastolic" />
            </View>
            <Field label="Peso (kg)" value={weight} onChange={setWeight} testID="daily-weight" />
            <Field label="Glicemia (mg/dL)" value={glucose} onChange={setGlucose} testID="daily-glucose" />

            {gestationalWeeks !== null && gestationalWeeks >= 28 ? (
              <View style={styles.movementCard}>
                <Text style={styles.label}>Sentiu o bebê mexer menos hoje?</Text>
                <View style={styles.row}>
                  {[['sim', true], ['não', false]].map(([label, value]) => {
                    const selected = reducedMovements === value;
                    return <Pressable key={String(label)} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={String(label)} onPress={() => setReducedMovements(value as boolean)} style={[styles.choice, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{String(label)}</Text></Pressable>;
                  })}
                </View>
              </View>
            ) : null}

            <Text style={styles.label}>Observação curta (opcional)</Text>
            <TextInput accessibilityLabel="Observação curta" style={[styles.input, styles.multiline]} value={freeText} onChangeText={setFreeText} placeholder="Até 500 caracteres" maxLength={500} multiline editable={!saving} />

            <Pressable testID="daily-save" accessibilityRole="button" accessibilityLabel={editingKey ? 'Salvar correção do diário' : 'Salvar registro do diário'} onPress={() => void saveEntry()} style={styles.primaryButton} disabled={saving}>
              <Text style={styles.primaryButtonText}>{saving ? 'Salvando...' : editingKey ? 'Salvar correção' : 'Salvar registro'}</Text>
            </Pressable>
            {editingKey ? <Pressable accessibilityRole="button" onPress={resetForm} style={styles.cancelButton}><Text style={styles.cancelText}>Cancelar correção</Text></Pressable> : null}

            <Text style={styles.sectionTitle}>Histórico</Text>
            {entries.length === 0 ? <Text style={styles.empty}>Nenhum registro salvo ainda.</Text> : entries.map((entry) => (
              <View key={entry.entry_key} style={styles.entryCard}>
                <View style={styles.entryHeader}><Text style={styles.entryDate}>{formatEntryDate(entry.entry_date)}</Text><Text style={styles.version}>v{entry.version}</Text></View>
                <Text style={styles.entryText}>{summarize(entry)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Corrigir registro de ${formatEntryDate(entry.entry_date)}`} onPress={() => startEditing(entry)} style={styles.editButton}><FontAwesome name="pencil" size={14} color={ACCESSIBLE_COLORS.primary} /><Text style={styles.editText}>Corrigir registro</Text></Pressable>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, testID }: { label: string; value: string; onChange: (value: string) => void; testID: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput testID={testID} accessibilityLabel={label} style={styles.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" editable /></View>;
}

function summarize(entry: DailyEntry): string {
  const values: string[] = [];
  if (entry.alarm_symptoms.length) values.push(`Alarme: ${entry.alarm_symptoms.join(', ')}`);
  if (entry.other_symptoms.length) values.push(`Sintomas: ${entry.other_symptoms.join(', ')}`);
  if (entry.systolic !== null || entry.diastolic !== null) values.push(`PA: ${entry.systolic ?? '-'} / ${entry.diastolic ?? '-'}`);
  if (entry.weight_kg !== null) values.push(`Peso: ${entry.weight_kg} kg`);
  if (entry.glucose_mg_dl !== null) values.push(`Glicemia: ${entry.glucose_mg_dl} mg/dL`);
  if (entry.reduced_fetal_movements !== null) values.push(`Mexeu menos: ${entry.reduced_fetal_movements ? 'sim' : 'não'}`);
  if (entry.free_text) values.push(entry.free_text);
  return values.join(' · ') || 'Sem detalhes informados';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8f5fb' },
  container: { padding: 20, paddingBottom: 50 },
  title: { color: ACCESSIBLE_COLORS.primary, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: ACCESSIBLE_COLORS.body, fontSize: 15, lineHeight: 21, marginBottom: 20 },
  sectionTitle: { color: ACCESSIBLE_COLORS.body, fontSize: 20, fontWeight: '700', marginTop: 22, marginBottom: 10 },
  helper: { color: ACCESSIBLE_COLORS.muted, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  label: { color: ACCESSIBLE_COLORS.body, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderColor: '#d7d0e1', borderRadius: 10, borderWidth: 1, color: ACCESSIBLE_COLORS.body, fontSize: 16, minHeight: 46, paddingHorizontal: 12, marginBottom: 12 },
  multiline: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  field: { flex: 1, minWidth: 140 },
  row: { flexDirection: 'row', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#fff', borderColor: '#d7d0e1', borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10 },
  chipSelected: { backgroundColor: ACCESSIBLE_COLORS.primary, borderColor: ACCESSIBLE_COLORS.primary },
  chipText: { color: ACCESSIBLE_COLORS.body, fontSize: 14 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  movementCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 8 },
  choice: { alignItems: 'center', borderColor: '#d7d0e1', borderRadius: 20, borderWidth: 1, flex: 1, paddingVertical: 10 },
  primaryButton: { alignItems: 'center', backgroundColor: ACCESSIBLE_COLORS.primary, borderRadius: 24, minHeight: 50, justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cancelButton: { alignItems: 'center', marginTop: 12, padding: 10 },
  cancelText: { color: ACCESSIBLE_COLORS.primary, fontSize: 15, fontWeight: '600' },
  entryCard: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 12, padding: 14 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  entryDate: { color: ACCESSIBLE_COLORS.body, fontSize: 16, fontWeight: '700' },
  version: { color: ACCESSIBLE_COLORS.muted, fontSize: 13 },
  entryText: { color: ACCESSIBLE_COLORS.body, fontSize: 14, lineHeight: 20 },
  editButton: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 12 },
  editText: { color: ACCESSIBLE_COLORS.primary, fontSize: 14, fontWeight: '600' },
  empty: { color: ACCESSIBLE_COLORS.muted, fontSize: 15, marginBottom: 20 },
  errorCard: { backgroundColor: '#fff4f3', borderColor: '#e7b7b3', borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  errorText: { color: '#8e2d25', fontSize: 14, marginBottom: 10 },
  secondaryButton: { alignItems: 'center', borderColor: ACCESSIBLE_COLORS.primary, borderRadius: 20, borderWidth: 1, padding: 10 },
  secondaryButtonText: { color: ACCESSIBLE_COLORS.primary, fontWeight: '600' },
});
