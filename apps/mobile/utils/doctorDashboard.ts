import { ACCESSIBLE_COLORS } from '../theme/accessibility';

// Contrato de GET /api/doctors/me/dashboard (E3-10).
export type DashboardSeverity = 'red' | 'yellow';

export type DashboardAlert = {
  gravidade: DashboardSeverity;
  reconhecido: boolean;
  data: string;
};

export type DashboardPatient = {
  pregnant_id: number;
  nome: string;
  ig_semanas: number | null;
  pior_alerta: DashboardAlert | null;
  alertas_nao_reconhecidos: number;
};

export type DashboardCounters = {
  vermelho: number;
  amarelo: number;
  sem_alerta: number;
  nao_reconhecidos: number;
};

export type DashboardResponse = {
  contadores: DashboardCounters;
  total: number;
  pagina: number;
  por_pagina: number;
  total_paginas: number;
  pacientes: DashboardPatient[];
};

export type SeverityFilter = 'red' | 'yellow' | 'none' | null;
export type StatusFilter = 'pendente' | 'reconhecido' | null;

export type DashboardFilters = {
  gravidade: SeverityFilter;
  status: StatusFilter;
  busca: string;
  pagina: number;
};

export type AlertBadge = {
  label: string;
  icon: 'alert-circle' | 'warning' | 'checkmark-done-circle' | 'ellipse-outline';
  color: string;
  accessibilityLabel: string;
};

export function buildDashboardQuery(filters: DashboardFilters): string {
  const params: string[] = [];
  if (filters.gravidade) params.push(`gravidade=${filters.gravidade}`);
  if (filters.status) params.push(`status=${filters.status}`);
  const search = filters.busca.trim();
  if (search) params.push(`busca=${encodeURIComponent(search.slice(0, 100))}`);
  if (filters.pagina > 1) params.push(`pagina=${filters.pagina}`);
  return params.length ? `?${params.join('&')}` : '';
}

export function formatAlertDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

// O estado do alerta sempre tem texto, ícone e cor, para não depender só de cor.
export function getAlertBadge(alert: DashboardAlert | null): AlertBadge {
  if (!alert) {
    return {
      label: 'Sem alerta ativo',
      icon: 'ellipse-outline',
      color: ACCESSIBLE_COLORS.success,
      accessibilityLabel: 'Sem alerta ativo',
    };
  }

  const severity = alert.gravidade === 'red' ? 'Vermelho' : 'Amarelo';
  const recognition = alert.reconhecido ? 'reconhecido' : 'não reconhecido';
  const date = formatAlertDate(alert.data);
  const label = date ? `${severity} · ${recognition} · ${date}` : `${severity} · ${recognition}`;

  let icon: AlertBadge['icon'] = alert.gravidade === 'red' ? 'alert-circle' : 'warning';
  if (alert.reconhecido) icon = 'checkmark-done-circle';

  return {
    label,
    icon,
    color: alert.gravidade === 'red' ? ACCESSIBLE_COLORS.danger : ACCESSIBLE_COLORS.warning,
    accessibilityLabel: `Pior alerta: ${severity}, ${recognition}${date ? `, em ${date}` : ''}`,
  };
}

export function formatGestationalAge(weeks: number | null): string {
  return weeks ? `${weeks} semanas de gestação` : 'Gestação não iniciada';
}

export function mergeDashboardPages(
  current: DashboardPatient[],
  next: DashboardPatient[]
): DashboardPatient[] {
  const seen = new Set(current.map((patient) => patient.pregnant_id));
  return [...current, ...next.filter((patient) => !seen.has(patient.pregnant_id))];
}
