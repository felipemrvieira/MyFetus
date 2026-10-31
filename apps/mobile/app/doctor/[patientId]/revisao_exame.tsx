import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../../utils/apiClient';
import {
  CorrectionForm,
  EXAM_TYPE_OPTIONS,
  ExamType,
  LabResult,
  LabResultStatus,
  ReviewAction,
  STATUS_LABELS,
  TIMEPOINT_OPTIONS,
  Timepoint,
  availableActions,
  buildReviewBody,
  correctionFormFrom,
  fieldList,
  formatDate,
  formatExamContext,
  formatReference,
  formatValue,
  getLabReviewErrorMessage,
  isGlucose,
  reasonRequired,
  shouldReloadAfterError,
} from '../../../utils/labReview';

type ReviewResponse = {
  document: { id: number; document_name: string | null; extraction_status: string | null };
  results: LabResult[];
};

const ACTION_LABELS: Record<ReviewAction, string> = {
  accept: 'Aceitar',
  correct: 'Corrigir',
  reject: 'Rejeitar',
  reopen: 'Reabrir',
};

const STATUS_COLORS: Record<LabResultStatus, string> = {
  pending: '#B54708',
  accepted: '#027A48',
  corrected: '#175CD3',
  rejected: '#B42318',
};

type Editing = {
  id: number;
  action: ReviewAction;
  reason: string;
  form: CorrectionForm;
  examType: ExamType | null;
  timepoint: Timepoint | null;
};

function Chips<T extends string>({
  options,
  selected,
  onSelect,
  testPrefix,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
  testPrefix: string;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <TouchableOpacity
          key={option.value}
          testID={`${testPrefix}-${option.value}`}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: selected === option.value }}
          onPress={() => onSelect(option.value)}
          style={[styles.chip, selected === option.value && styles.chipSelected]}
        >
          <Text style={[styles.chipText, selected === option.value && styles.chipTextSelected]}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Revisão médica dos valores lidos do exame (E2-04): aceitar, corrigir, rejeitar ou reabrir, linha a linha.
export default function RevisaoExameScreen() {
  const { documentId } = useLocalSearchParams<{ patientId: string; documentId: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [results, setResults] = useState<LabResult[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ id: number; text: string; error: boolean } | null>(null);

  // Os setState ficam nos callbacks da promise, fora do corpo do efeito.
  const load = useCallback(() => {
    if (!documentId) return Promise.resolve();
    return api.get<ReviewResponse>(`/lab-results/documents/${documentId}`)
      .then(({ data }) => {
        setDocumentName(data.document?.document_name ?? null);
        setExtractionStatus(data.document?.extraction_status ?? null);
        setResults(Array.isArray(data.results) ? data.results : []);
        setLoadError(null);
      })
      .catch((error) => setLoadError(getLabReviewErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [documentId]);

  useEffect(() => {
    load();
  }, [load]);

  const startEditing = (result: LabResult, action: ReviewAction) => {
    setMessage(null);
    setEditing({
      id: result.id,
      action,
      reason: '',
      form: correctionFormFrom(result),
      examType: result.current.exam_type,
      timepoint: result.current.timepoint,
    });
  };

  const updateForm = (patch: Partial<CorrectionForm>) => {
    setEditing((current) => (current ? { ...current, form: { ...current.form, ...patch } } : current));
  };

  const submit = async (result: LabResult) => {
    if (!editing || saving) return;
    const built = buildReviewBody(editing.action, result, {
      reason: editing.reason,
      form: editing.form,
      examType: editing.examType,
      timepoint: editing.timepoint,
    });
    if ('error' in built) {
      setMessage({ id: result.id, text: built.error, error: true });
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post<{ result: LabResult }>(`/lab-results/${result.id}/${editing.action}`, built.body);
      setResults((current) => current.map((item) => (item.id === data.result.id ? data.result : item)));
      setEditing(null);
      setMessage({ id: result.id, text: `${STATUS_LABELS[data.result.status]} (versão ${data.result.version}).`, error: false });
    } catch (error) {
      setMessage({ id: result.id, text: getLabReviewErrorMessage(error), error: true });
      if (shouldReloadAfterError(error)) {
        setEditing(null);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" color="#886aea" style={{ marginTop: 50 }} />;
  }

  const pendingCount = results.filter((result) => result.status === 'pending').length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">Revisar valores do exame</Text>
        {!!documentName && <Text style={styles.subtitle}>{documentName}</Text>}
        <Text style={styles.helperText}>
          Só os valores aceitos ou corrigidos entram no prontuário, nos gráficos e nas regras de risco.
        </Text>

        {loadError ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">{loadError}</Text>
        ) : results.length === 0 ? (
          <Text style={styles.emptyText}>
            {extractionStatus === 'done'
              ? 'Nenhum valor reconhecido neste exame. Revise o arquivo e registre o laudo normalmente.'
              : 'O texto do exame ainda está sendo lido. Volte em alguns minutos.'}
          </Text>
        ) : (
          <Text style={styles.summary}>
            {pendingCount === 0 ? 'Todos os valores foram revisados.' : `${pendingCount} de ${results.length} valores pendentes.`}
          </Text>
        )}

        {results.map((result) => {
          const active = editing?.id === result.id ? editing : null;
          const changed = formatValue(result.current) !== formatValue(result.original);
          const reference = formatReference(result.current);
          const context = formatExamContext(result.current);
          const resultMessage = message?.id === result.id ? message : null;

          return (
            <View key={result.id} style={styles.card} testID={`lab-result-${result.id}`}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{result.analyte}</Text>
                <Text style={[styles.status, { color: STATUS_COLORS[result.status] }]}>{STATUS_LABELS[result.status]}</Text>
              </View>

              <Text style={styles.value}>{formatValue(result.current)}</Text>
              {changed && <Text style={styles.meta}>Lido no exame: {formatValue(result.original)}</Text>}
              {!!reference && <Text style={styles.meta}>Referência: {reference}</Text>}
              <Text style={styles.meta}>Coleta: {formatDate(result.current.observed_at)}</Text>
              {isGlucose(result) && <Text style={styles.meta}>Tipo: {context ?? 'não informado'}</Text>}

              {result.low_confidence && (
                <View style={styles.warning}>
                  <Text style={styles.warningTitle}>Leitura com baixa confiança: confira com o documento.</Text>
                  {!!result.raw_text && <Text style={styles.rawText}>Trecho original: “{result.raw_text}”</Text>}
                </View>
              )}
              {!result.low_confidence && !!result.raw_text && (
                <Text style={styles.rawTextMuted}>Trecho original: “{result.raw_text}”</Text>
              )}
              {result.status === 'pending' && result.missing_for_acceptance.length > 0 && (
                <Text style={styles.meta}>Falta para aceitar: {fieldList(result.missing_for_acceptance)}.</Text>
              )}
              {result.status !== 'pending' && !!result.review_reason && (
                <Text style={styles.meta}>Justificativa: {result.review_reason}</Text>
              )}

              {!active && (
                <View style={styles.actions}>
                  {availableActions(result.status).map((action) => (
                    <TouchableOpacity
                      key={action}
                      testID={`lab-result-${result.id}-${action}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${ACTION_LABELS[action]} ${result.analyte}`}
                      onPress={() => startEditing(result, action)}
                      style={[styles.actionButton, action === 'accept' && styles.actionPrimary, action === 'reject' && styles.actionDanger]}
                    >
                      <Text style={[styles.actionText, action === 'accept' && styles.actionPrimaryText]}>{ACTION_LABELS[action]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {active && (
                <View style={styles.editor}>
                  <Text style={styles.editorTitle}>{ACTION_LABELS[active.action]}</Text>

                  {active.action === 'accept' && isGlucose(result) && (
                    <>
                      <Text style={styles.label}>Tipo do exame</Text>
                      <Chips
                        options={EXAM_TYPE_OPTIONS}
                        selected={active.examType}
                        onSelect={(value) => setEditing({ ...active, examType: value })}
                        testPrefix={`lab-result-${result.id}-type`}
                      />
                      {active.examType === 'ogtt75g' && (
                        <Chips
                          options={TIMEPOINT_OPTIONS}
                          selected={active.timepoint}
                          onSelect={(value) => setEditing({ ...active, timepoint: value })}
                          testPrefix={`lab-result-${result.id}-time`}
                        />
                      )}
                    </>
                  )}

                  {active.action === 'correct' && (
                    <>
                      <Text style={styles.label}>Valor</Text>
                      <TextInput style={styles.input} value={active.form.value} onChangeText={(value) => updateForm({ value })} accessibilityLabel="Valor corrigido" testID={`lab-result-${result.id}-value`} />
                      <Text style={styles.label}>Unidade</Text>
                      <TextInput style={styles.input} value={active.form.unit} onChangeText={(unit) => updateForm({ unit })} autoCapitalize="none" accessibilityLabel="Unidade" />
                      <View style={styles.row}>
                        <View style={styles.half}>
                          <Text style={styles.label}>Referência mín.</Text>
                          <TextInput style={styles.input} value={active.form.reference_low} onChangeText={(reference_low) => updateForm({ reference_low })} keyboardType="decimal-pad" accessibilityLabel="Referência mínima" />
                        </View>
                        <View style={styles.half}>
                          <Text style={styles.label}>Referência máx.</Text>
                          <TextInput style={styles.input} value={active.form.reference_high} onChangeText={(reference_high) => updateForm({ reference_high })} keyboardType="decimal-pad" accessibilityLabel="Referência máxima" />
                        </View>
                      </View>
                      <Text style={styles.label}>Data da coleta (DD/MM/AAAA)</Text>
                      <TextInput style={styles.input} value={active.form.observed_at} onChangeText={(observed_at) => updateForm({ observed_at })} accessibilityLabel="Data da coleta" />
                      {isGlucose(result) && (
                        <>
                          <Text style={styles.label}>Tipo do exame</Text>
                          <Chips
                            options={EXAM_TYPE_OPTIONS}
                            selected={active.form.exam_type}
                            onSelect={(exam_type) => updateForm({ exam_type })}
                            testPrefix={`lab-result-${result.id}-form-type`}
                          />
                          {active.form.exam_type === 'ogtt75g' && (
                            <Chips
                              options={TIMEPOINT_OPTIONS}
                              selected={active.form.timepoint}
                              onSelect={(timepoint) => updateForm({ timepoint })}
                              testPrefix={`lab-result-${result.id}-form-time`}
                            />
                          )}
                        </>
                      )}
                    </>
                  )}

                  {reasonRequired(active.action) && (
                    <>
                      <Text style={styles.label}>Justificativa</Text>
                      <TextInput
                        style={[styles.input, styles.multiline]}
                        value={active.reason}
                        onChangeText={(reason) => setEditing({ ...active, reason })}
                        multiline
                        maxLength={1000}
                        accessibilityLabel="Justificativa"
                        testID={`lab-result-${result.id}-reason`}
                      />
                    </>
                  )}

                  <View style={styles.actions}>
                    <TouchableOpacity
                      testID={`lab-result-${result.id}-confirm`}
                      accessibilityRole="button"
                      accessibilityLabel={`Confirmar: ${ACTION_LABELS[active.action].toLowerCase()} ${result.analyte}`}
                      accessibilityState={{ disabled: saving, busy: saving }}
                      disabled={saving}
                      onPress={() => submit(result)}
                      style={[styles.actionButton, styles.actionPrimary, saving && styles.disabled]}
                    >
                      <Text style={[styles.actionText, styles.actionPrimaryText]}>{saving ? 'Salvando...' : `Confirmar: ${ACTION_LABELS[active.action].toLowerCase()}`}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar" disabled={saving} onPress={() => { setEditing(null); setMessage(null); }} style={styles.actionButton}>
                      <Text style={styles.actionText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {resultMessage && (
                <Text style={resultMessage.error ? styles.errorText : styles.successText} accessibilityLiveRegion="polite">
                  {resultMessage.text}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#E6E0F8' },
  container: { padding: 20, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#555', marginBottom: 8 },
  helperText: { fontSize: 14, color: '#555', marginBottom: 12, lineHeight: 20 },
  summary: { fontSize: 15, fontWeight: '600', color: '#5B3FB8', marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#555', marginTop: 8, lineHeight: 22 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: 'bold', color: '#333' },
  status: { fontSize: 13, fontWeight: 'bold' },
  value: { fontSize: 20, fontWeight: '600', color: '#222', marginTop: 6, marginBottom: 4 },
  meta: { fontSize: 14, color: '#555', marginTop: 2 },
  warning: { backgroundColor: '#FFFAEB', borderColor: '#FEC84B', borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8 },
  warningTitle: { fontSize: 14, fontWeight: '600', color: '#93370D' },
  rawText: { fontSize: 13, color: '#4A4A4A', marginTop: 4 },
  rawTextMuted: { fontSize: 13, color: '#666', marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionButton: { borderWidth: 1, borderColor: '#886aea', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center' },
  actionPrimary: { backgroundColor: '#27ae60', borderColor: '#27ae60' },
  actionDanger: { borderColor: '#B42318' },
  actionText: { fontSize: 14, fontWeight: '600', color: '#5B3FB8' },
  actionPrimaryText: { color: '#FFF' },
  disabled: { opacity: 0.6 },
  editor: { backgroundColor: '#F0EFFF', borderRadius: 12, padding: 12, marginTop: 12 },
  editorTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  label: { fontSize: 13, color: '#444', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: '#D0D5DD', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: '#886aea', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#886aea' },
  chipText: { fontSize: 14, color: '#5B3FB8' },
  chipTextSelected: { color: '#FFF', fontWeight: '600' },
  errorText: { fontSize: 14, color: '#B42318', marginTop: 8 },
  successText: { fontSize: 14, color: '#027A48', marginTop: 8 },
});
