const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'data', 'alert-rules.json');
const SEVERITY_WEIGHT = { green: 0, yellow: 1, red: 2, pending: -1 };
const OPERATORS = new Set(['eq', 'lt', 'lte', 'gt', 'gte', 'between', 'containsAny']);

class RiskEngineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RiskEngineError';
    this.code = code;
    this.details = details;
  }
}

function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    throw new RiskEngineError('CATALOG_UNAVAILABLE', 'Catálogo de risco indisponível.', { cause: error.message });
  }
  validateCatalog(catalog);
  return catalog;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || !/^\d+\.\d+\.\d+$/.test(catalog.catalogVersion)) {
    throw new RiskEngineError('INVALID_CATALOG', 'catalogVersion inválida.');
  }
  if (!Array.isArray(catalog.categories) || catalog.categories.length !== 12) {
    throw new RiskEngineError('INVALID_CATALOG', 'O catálogo deve conter as 12 categorias de risco.');
  }

  const categoryIds = new Set();
  for (const category of catalog.categories) {
    if (!category.id || !category.label || categoryIds.has(category.id)) {
      throw new RiskEngineError('INVALID_CATALOG', 'Categoria ausente ou duplicada.');
    }
    categoryIds.add(category.id);
    if (!Array.isArray(category.requiredFields) || !Array.isArray(category.rules)) {
      throw new RiskEngineError('INVALID_CATALOG', `Estrutura inválida na categoria ${category.id}.`);
    }
    for (const rule of category.rules) {
      if (!rule.id || !rule.when || !['green', 'yellow', 'red'].includes(rule.severity)) {
        throw new RiskEngineError('INVALID_CATALOG', `Regra inválida na categoria ${category.id}.`);
      }
      validateCondition(rule.when);
    }
  }
  return true;
}

function validateCondition(condition) {
  if (!condition || typeof condition !== 'object') {
    throw new RiskEngineError('INVALID_CATALOG', 'Condição de regra inválida.');
  }
  if (condition.any || condition.all) {
    const key = condition.any ? 'any' : 'all';
    if (!Array.isArray(condition[key]) || condition[key].length === 0) {
      throw new RiskEngineError('INVALID_CATALOG', `Condição ${key} precisa ser uma lista não vazia.`);
    }
    condition[key].forEach(validateCondition);
    return;
  }
  if (typeof condition.field !== 'string' || !OPERATORS.has(condition.op)) {
    throw new RiskEngineError('INVALID_CATALOG', 'Condição precisa informar campo e operador válidos.');
  }
}

function hasValue(input, field) {
  return Object.prototype.hasOwnProperty.call(input, field) && input[field] !== null && input[field] !== undefined && input[field] !== '';
}

function validateInput(input, catalog) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RiskEngineError('INVALID_INPUT', 'Os dados de risco devem ser um objeto.');
  }
  for (const category of catalog.categories) {
    for (const [field, definition] of Object.entries(category.fields || {})) {
      if (!hasValue(input, field)) continue;
      const value = input[field];
      if (definition.unit !== 'booleano' && definition.unit !== 'lista de sinais' && definition.unit !== 'estado por idade gestacional' && typeof value !== 'number') {
        throw new RiskEngineError('INVALID_VALUE', `Valor inválido para ${field}.`, { field });
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new RiskEngineError('INVALID_VALUE', `Valor inválido para ${field}.`, { field });
      }
      if (definition.min !== undefined && value < definition.min || definition.max !== undefined && value > definition.max) {
        throw new RiskEngineError('INVALID_VALUE', `Valor fora da faixa plausível para ${field}.`, { field });
      }
      if (definition.unit === 'booleano' && typeof value !== 'boolean') {
        throw new RiskEngineError('INVALID_VALUE', `Valor inválido para ${field}.`, { field });
      }
      if (definition.unit === 'lista de sinais' && !Array.isArray(value)) {
        throw new RiskEngineError('INVALID_VALUE', `Valor inválido para ${field}.`, { field });
      }
    }
  }
}

function compare(value, op, expected) {
  switch (op) {
    case 'eq': return value === expected;
    case 'lt': return value < expected;
    case 'lte': return value <= expected;
    case 'gt': return value > expected;
    case 'gte': return value >= expected;
    case 'between': return Array.isArray(expected) && value >= expected[0] && value <= expected[1];
    case 'containsAny': return Array.isArray(value) && Array.isArray(expected) && value.some(item => expected.includes(item));
    default: return false;
  }
}

function evaluateCondition(condition, input) {
  if (condition.any) return condition.any.some(item => evaluateCondition(item, input));
  if (condition.all) return condition.all.every(item => evaluateCondition(item, input));
  if (!hasValue(input, condition.field)) return false;
  return compare(input[condition.field], condition.op, condition.value);
}

function getMissingFields(category, input) {
  return category.requiredFields.filter(field => !hasValue(input, field));
}

function evaluateRisk(input, options = {}) {
  const catalog = options.catalog || loadCatalog(options.catalogPath);
  validateCatalog(catalog);
  validateInput(input, catalog);

  const categories = catalog.categories.map(category => {
    const missingFields = getMissingFields(category, input);
    if (category.decisionStatus) {
      return {
        category: category.id,
        label: category.label,
        status: 'pending_decision',
        severity: 'pending',
        missingFields,
        reason: category.decisionStatus,
        alerts: [],
      };
    }
    if (missingFields.length > 0) {
      return {
        category: category.id,
        label: category.label,
        status: 'pending_data',
        severity: 'pending',
        missingFields,
        alerts: [],
      };
    }

    const alerts = category.rules
      .filter(rule => evaluateCondition(rule.when, input))
      .map(rule => ({
        ruleId: rule.id,
        severity: rule.severity,
        evidence: rule.evidence,
        suggestedAction: rule.suggestedAction,
      }));
    const severity = alerts.reduce((worst, alert) => (
      SEVERITY_WEIGHT[alert.severity] > SEVERITY_WEIGHT[worst] ? alert.severity : worst
    ), 'green');
    return {
      category: category.id,
      label: category.label,
      status: alerts.length > 0 ? 'alert' : 'no_alert',
      severity,
      missingFields: [],
      alerts,
    };
  });

  const overallSeverity = categories.reduce((worst, category) => (
    SEVERITY_WEIGHT[category.severity] > SEVERITY_WEIGHT[worst] ? category.severity : worst
  ), 'green');

  return {
    catalogVersion: catalog.catalogVersion,
    scope: catalog.scope,
    overallSeverity,
    categories,
  };
}

module.exports = {
  DEFAULT_CATALOG_PATH,
  RiskEngineError,
  evaluateCondition,
  evaluateRisk,
  loadCatalog,
  validateCatalog,
  validateInput,
};
