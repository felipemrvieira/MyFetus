/**
 * doctorDashboardService.js
 *
 * Regras do dashboard do médico ordenado por gravidade (E3-10).
 * Decisões do P.O. registradas na issue #102 (29/10/2026):
 * - ordem: vermelho não reconhecido, amarelo não reconhecido, vermelho
 *   reconhecido, amarelo reconhecido e, por último, sem alerta;
 * - reconhecidos continuam na lista, com indicador;
 * - empate: alerta mais recente primeiro; 20 pacientes por página;
 * - filtros: gravidade, status de reconhecimento e busca por nome;
 * - só resumo: nome, IG, pior alerta e data.
 *
 * Só alertas "open" e "acknowledged" contam; "closed" fica fora.
 * Não existe alerta verde: "sem alerta" é a ausência de alerta ativo.
 */

const PAGE_SIZE = 20;
const MAX_PAGE = 10000;
const MAX_SEARCH_LENGTH = 100;
const NO_ALERT_RANK = 4;

const SEVERITY_FILTERS = ['red', 'yellow', 'none'];
const STATUS_FILTERS = ['pendente', 'reconhecido'];

class DashboardQueryError extends Error {
  constructor(validationMessage) {
    super(validationMessage);
    this.name = 'DashboardQueryError';
    this.validationMessage = validationMessage;
  }
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// 0 = vermelho não reconhecido ... 3 = amarelo reconhecido; 4 = sem alerta.
function alertRank(alert) {
  if (!alert) return NO_ALERT_RANK;
  const severityRank = alert.severity === 'red' ? 0 : 1;
  return alert.status === 'open' ? severityRank : severityRank + 2;
}

function timestamp(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function pickWorstAlert(alerts) {
  let worst = null;
  for (const alert of alerts) {
    if (!worst) {
      worst = alert;
      continue;
    }
    const rankDiff = alertRank(alert) - alertRank(worst);
    if (rankDiff < 0 || (rankDiff === 0 && timestamp(alert.last_seen_at) > timestamp(worst.last_seen_at))) {
      worst = alert;
    }
  }
  return worst;
}

function parseDashboardQuery(query = {}) {
  const filters = { gravidade: null, status: null, busca: '', pagina: 1 };

  if (query.gravidade !== undefined && query.gravidade !== '') {
    if (!SEVERITY_FILTERS.includes(query.gravidade)) {
      throw new DashboardQueryError(`gravidade deve ser uma de: ${SEVERITY_FILTERS.join(', ')}`);
    }
    filters.gravidade = query.gravidade;
  }

  if (query.status !== undefined && query.status !== '') {
    if (!STATUS_FILTERS.includes(query.status)) {
      throw new DashboardQueryError(`status deve ser um de: ${STATUS_FILTERS.join(', ')}`);
    }
    filters.status = query.status;
  }

  if (query.busca !== undefined) {
    if (typeof query.busca !== 'string' || query.busca.length > MAX_SEARCH_LENGTH) {
      throw new DashboardQueryError(`busca deve ter no máximo ${MAX_SEARCH_LENGTH} caracteres`);
    }
    filters.busca = normalizeText(query.busca);
  }

  if (query.pagina !== undefined && query.pagina !== '') {
    const page = Number(query.pagina);
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      throw new DashboardQueryError('pagina deve ser um inteiro a partir de 1');
    }
    filters.pagina = page;
  }

  return filters;
}

function toSummary(patient, alerts) {
  const worst = pickWorstAlert(alerts);
  const weeks = Number(patient.ig_semanas);

  return {
    pregnant_id: patient.pregnant_id,
    nome: patient.nome,
    ig_semanas: Number.isFinite(weeks) && weeks > 0 ? weeks : null,
    pior_alerta: worst
      ? {
          gravidade: worst.severity,
          reconhecido: worst.status !== 'open',
          data: new Date(worst.last_seen_at).toISOString(),
        }
      : null,
    alertas_nao_reconhecidos: alerts.filter((alert) => alert.status === 'open').length,
    rank: alertRank(worst),
  };
}

function compareSummaries(left, right) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.pior_alerta && right.pior_alerta) {
    const dateDiff = timestamp(right.pior_alerta.data) - timestamp(left.pior_alerta.data);
    if (dateDiff !== 0) return dateDiff;
  }
  const nameDiff = String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR');
  if (nameDiff !== 0) return nameDiff;
  return Number(left.pregnant_id) - Number(right.pregnant_id);
}

function matchesFilters(summary, filters) {
  if (filters.gravidade) {
    const severity = summary.pior_alerta ? summary.pior_alerta.gravidade : 'none';
    if (severity !== filters.gravidade) return false;
  }
  if (filters.status === 'pendente' && !(summary.rank === 0 || summary.rank === 1)) return false;
  if (filters.status === 'reconhecido' && !(summary.rank === 2 || summary.rank === 3)) return false;
  if (filters.busca && !normalizeText(summary.nome).includes(filters.busca)) return false;
  return true;
}

function countByColor(summaries) {
  const counters = { vermelho: 0, amarelo: 0, sem_alerta: 0, nao_reconhecidos: 0 };
  for (const summary of summaries) {
    if (!summary.pior_alerta) counters.sem_alerta += 1;
    else if (summary.pior_alerta.gravidade === 'red') counters.vermelho += 1;
    else counters.amarelo += 1;
    if (summary.rank === 0 || summary.rank === 1) counters.nao_reconhecidos += 1;
  }
  return counters;
}

/**
 * Monta o dashboard a partir das pacientes autorizadas e dos alertas ativos.
 *
 * Os contadores cobrem todas as pacientes autorizadas (antes dos filtros),
 * para servirem de visão geral; `total` é a quantidade após os filtros.
 */
function buildDashboard(patients, alerts, filters = parseDashboardQuery()) {
  const alertsByPatient = new Map();
  for (const alert of alerts) {
    if (alert.status !== 'open' && alert.status !== 'acknowledged') continue;
    const key = String(alert.pregnant_id);
    if (!alertsByPatient.has(key)) alertsByPatient.set(key, []);
    alertsByPatient.get(key).push(alert);
  }

  const summaries = patients
    .map((patient) => toSummary(patient, alertsByPatient.get(String(patient.pregnant_id)) || []))
    .sort(compareSummaries);

  const filtered = summaries.filter((summary) => matchesFilters(summary, filters));
  const start = (filters.pagina - 1) * PAGE_SIZE;

  return {
    contadores: countByColor(summaries),
    total: filtered.length,
    pagina: filters.pagina,
    por_pagina: PAGE_SIZE,
    total_paginas: Math.ceil(filtered.length / PAGE_SIZE),
    pacientes: filtered
      .slice(start, start + PAGE_SIZE)
      .map(({ rank, ...summary }) => summary),
  };
}

module.exports = {
  DashboardQueryError,
  PAGE_SIZE,
  alertRank,
  buildDashboard,
  parseDashboardQuery,
  pickWorstAlert,
};
