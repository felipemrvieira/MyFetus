/**
 * Revisão médica dos analitos extraídos (E2-04).
 *
 * Regras puras da tela de revisão: rótulos, formatação, montagem do corpo de
 * cada ação e mensagens de erro da API (/lab-results). Decisões do P.O. em
 * 29/10/2026 na #61: corrigir, rejeitar e reabrir exigem justificativa; na
 * glicemia, aceitar exige o tipo do exame (e o tempo no TOTG 75 g).
 */
import { getApiErrorInfo } from './consent';

export type LabResultStatus = 'pending' | 'accepted' | 'corrected' | 'rejected';
export type ReviewAction = 'accept' | 'correct' | 'reject' | 'reopen';
export type ExamType = 'fasting' | 'casual' | 'ogtt75g';
export type Timepoint = '0h' | '1h' | '2h';

export type LabResultValues = {
  value: number | string | null;
  unit: string | null;
  reference_low: number | null;
  reference_high: number | null;
  observed_at: string | null;
  exam_type: ExamType | null;
  timepoint: Timepoint | null;
};

export type LabResult = {
  id: number;
  document_id: number;
  analyte_id: string;
  analyte: string;
  status: LabResultStatus;
  version: number;
  clinically_usable: boolean;
  original: LabResultValues;
  current: LabResultValues;
  raw_text: string | null;
  confidence: number | null;
  low_confidence: boolean;
  ambiguity_reason: string | null;
  missing_for_acceptance: string[];
  review_reason: string | null;
  reviewed_at: string | null;
};

export type CorrectionForm = {
  value: string;
  unit: string;
  reference_low: string;
  reference_high: string;
  observed_at: string;
  exam_type: ExamType | null;
  timepoint: Timepoint | null;
};

export const LAB_REVIEW_GENERIC_ERROR = 'Não foi possível salvar a revisão. Tente novamente.';

export const STATUS_LABELS: Record<LabResultStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceito',
  corrected: 'Corrigido',
  rejected: 'Rejeitado',
};

export const EXAM_TYPE_OPTIONS: { value: ExamType; label: string }[] = [
  { value: 'fasting', label: 'Jejum' },
  { value: 'casual', label: 'Casual' },
  { value: 'ogtt75g', label: 'TOTG 75 g' },
];

export const TIMEPOINT_OPTIONS: { value: Timepoint; label: string }[] = [
  { value: '0h', label: '0 h' },
  { value: '1h', label: '1 h' },
  { value: '2h', label: '2 h' },
];

const FIELD_LABELS: Record<string, string> = {
  value: 'valor',
  unit: 'unidade',
  observed_at: 'data da coleta',
  exam_type: 'tipo do exame',
  timepoint: 'tempo do TOTG',
  reference_low: 'referência mínima',
  reference_high: 'referência máxima',
  reason: 'justificativa',
};

export function isGlucose(result: Pick<LabResult, 'analyte_id'>): boolean {
  return result.analyte_id === 'glucose';
}

export function reasonRequired(action: ReviewAction): boolean {
  return action !== 'accept';
}

export function availableActions(status: LabResultStatus): ReviewAction[] {
  return status === 'pending' ? ['accept', 'correct', 'reject'] : ['reopen'];
}

export function fieldList(fields: string[]): string {
  return fields.map((field) => FIELD_LABELS[field] ?? field).join(', ');
}

function formatNumber(value: number): string {
  return String(value).replace('.', ',');
}

export function formatValue(values: Pick<LabResultValues, 'value' | 'unit'>): string {
  if (values.value === null || values.value === '') return 'Sem valor';
  const value = typeof values.value === 'number' ? formatNumber(values.value) : values.value;
  return values.unit ? `${value} ${values.unit}` : value;
}

export function formatReference(values: Pick<LabResultValues, 'reference_low' | 'reference_high'>): string | null {
  const { reference_low: low, reference_high: high } = values;
  if (low === null && high === null) return null;
  if (low !== null && high !== null) return `${formatNumber(low)} a ${formatNumber(high)}`;
  return low !== null ? `a partir de ${formatNumber(low)}` : `até ${formatNumber(high as number)}`;
}

export function formatDate(iso: string | null): string {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Sem data';
}

export function formatExamContext(values: Pick<LabResultValues, 'exam_type' | 'timepoint'>): string | null {
  const type = EXAM_TYPE_OPTIONS.find((option) => option.value === values.exam_type)?.label;
  if (!type) return null;
  const time = TIMEPOINT_OPTIONS.find((option) => option.value === values.timepoint)?.label;
  return time ? `${type}, ${time}` : type;
}

// "15/10/2026" ou "2026-10-15" viram "2026-10-15"; data impossível vira null.
export function parseDateInput(text: string): string | null {
  const trimmed = text.trim();
  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : trimmed;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === iso ? iso : null;
}

function parseNumberInput(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function correctionFormFrom(result: LabResult): CorrectionForm {
  const values = result.current;
  const number = (value: number | null) => (value === null ? '' : formatNumber(value));
  return {
    value: values.value === null ? '' : typeof values.value === 'number' ? formatNumber(values.value) : values.value,
    unit: values.unit ?? '',
    reference_low: number(values.reference_low),
    reference_high: number(values.reference_high),
    observed_at: values.observed_at ? formatDate(values.observed_at) : '',
    exam_type: values.exam_type,
    timepoint: values.timepoint,
  };
}

type BuildResult = { body: Record<string, unknown> } | { error: string };

/** Monta o corpo do POST de cada ação, ou devolve o que falta para enviar. */
export function buildReviewBody(
  action: ReviewAction,
  result: LabResult,
  options: { reason?: string; form?: CorrectionForm; examType?: ExamType | null; timepoint?: Timepoint | null } = {}
): BuildResult {
  const body: Record<string, unknown> = { version: result.version };
  const reason = options.reason?.trim() ?? '';
  if (reasonRequired(action)) {
    if (!reason) return { error: 'Escreva a justificativa.' };
    body.reason = reason;
  }

  if (action === 'accept' && isGlucose(result)) {
    const examType = options.examType ?? result.current.exam_type;
    const timepoint = options.timepoint ?? result.current.timepoint;
    if (!examType) return { error: 'Escolha o tipo do exame de glicemia.' };
    if (examType === 'ogtt75g' && !timepoint) return { error: 'Escolha o tempo do TOTG.' };
    body.exam_type = examType;
    if (examType === 'ogtt75g') body.timepoint = timepoint;
  }

  if (action === 'correct') {
    const form = options.form;
    if (!form) return { error: 'Preencha a correção.' };
    const invalid: string[] = [];
    const numeric = parseNumberInput(form.value);
    if (!form.value.trim()) invalid.push('value');
    const low = parseNumberInput(form.reference_low);
    const high = parseNumberInput(form.reference_high);
    if (low === undefined) invalid.push('reference_low');
    if (high === undefined) invalid.push('reference_high');
    const observedAt = parseDateInput(form.observed_at);
    if (!observedAt) invalid.push('observed_at');
    if (typeof numeric === 'number' && !form.unit.trim()) invalid.push('unit');
    if (isGlucose(result)) {
      if (!form.exam_type) invalid.push('exam_type');
      else if (form.exam_type === 'ogtt75g' && !form.timepoint) invalid.push('timepoint');
    }
    if (invalid.length > 0) return { error: `Confira: ${fieldList(invalid)}.` };

    Object.assign(body, {
      value: typeof numeric === 'number' ? numeric : form.value.trim(),
      unit: form.unit.trim() || null,
      reference_low: low,
      reference_high: high,
      observed_at: observedAt,
      exam_type: isGlucose(result) ? form.exam_type : null,
      timepoint: isGlucose(result) && form.exam_type === 'ogtt75g' ? form.timepoint : null,
    });
  }

  return { body };
}

export function getLabReviewErrorMessage(error: unknown): string {
  const info = getApiErrorInfo(error);
  const data = (error as { response?: { data?: { missing?: unknown } } })?.response?.data;
  if (info.code === 'LAB_RESULT_INCOMPLETE') {
    const missing = Array.isArray(data?.missing) ? (data?.missing as string[]) : [];
    return missing.length > 0
      ? `Faltam dados: ${fieldList(missing)}. Use Corrigir para completar.`
      : 'Faltam dados para aceitar. Use Corrigir para completar.';
  }
  if (info.code === 'LAB_RESULT_VERSION_CONFLICT') return 'Este resultado mudou desde que a tela abriu. A lista foi atualizada.';
  if (info.code === 'LAB_RESULT_INVALID_TRANSITION') return 'Esta ação não vale mais para este resultado. A lista foi atualizada.';
  if (info.code === 'LAB_RESULT_REASON_REQUIRED') return 'Escreva a justificativa.';
  if (info.code === 'LAB_RESULT_INVALID_FIELDS') return 'Há campos com formato inválido. Confira a correção.';
  if (info.status === 403) return 'Só o médico vinculado a esta gestante pode revisar os resultados.';
  if (info.status === 404) return 'Resultado não encontrado.';
  if (info.status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (info.status === 429) return 'Muitas ações seguidas. Aguarde alguns minutos.';
  if (info.status === null) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  return LAB_REVIEW_GENERIC_ERROR;
}

// Conflitos pedem recarregar a lista, para o médico ver a versão atual.
export function shouldReloadAfterError(error: unknown): boolean {
  const { code } = getApiErrorInfo(error);
  return code === 'LAB_RESULT_VERSION_CONFLICT' || code === 'LAB_RESULT_INVALID_TRANSITION';
}
