const { performance } = require('perf_hooks');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, percent) {
  if (!Array.isArray(values) || values.length === 0) return 0;

  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return 0;

  const rank = Math.max(1, Math.ceil((percent / 100) * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function repeatQueries(queries, count) {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  return Array.from({ length: count }, (_, index) => queries[index % queries.length]);
}

function createConcurrencyLimiter(maxConcurrency) {
  const limit = Math.max(1, maxConcurrency);
  let active = 0;
  const queue = [];

  function runNext() {
    if (active >= limit || queue.length === 0) return;

    const job = queue.shift();
    active += 1;

    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  }

  return function limitConcurrency(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
  };
}

class LoadRunner {
  constructor({ ragClient, sleepImpl = sleep } = {}) {
    if (!ragClient || typeof ragClient.query !== 'function') {
      throw new TypeError('ragClient com método query é obrigatório.');
    }

    this.ragClient = ragClient;
    this.sleepImpl = sleepImpl;
  }

  async executeQuery(query, topK) {
    const startedAt = performance.now();

    try {
      const response = await this.ragClient.query(query, topK);
      const scores = (response.data?.resultados || [])
        .map((result) => Number(result.relevancia))
        .filter(Number.isFinite);

      return {
        query,
        success: true,
        status: response.status,
        latency_ms: response.latencyMs ?? Math.round(performance.now() - startedAt),
        average_relevance: average(scores),
        response: response.data,
      };
    } catch (error) {
      return {
        query,
        success: false,
        status: error.status || null,
        latency_ms: error.latencyMs ?? Math.round(performance.now() - startedAt),
        average_relevance: 0,
        error: {
          name: error.name,
          code: error.code || null,
          message: error.message,
        },
      };
    }
  }

  async runSequential(queries, topK) {
    const results = [];

    for (const query of queries) {
      results.push(await this.executeQuery(query, topK));
    }

    return results;
  }

  async runBurst(queries, { concurrency, topK }) {
    const batch = repeatQueries(queries, concurrency || queries.length);
    return Promise.all(batch.map((query) => this.executeQuery(query, topK)));
  }

  async runRamp(queries, { rampLevels, topK }) {
    const results = [];

    for (const concurrency of rampLevels) {
      const levelResults = await this.runBurst(queries, { concurrency, topK });
      results.push(...levelResults.map((result) => ({ ...result, ramp_concurrency: concurrency })));
    }

    return results;
  }

  async runSustained(queries, {
    requestsPerSecond,
    durationSeconds,
    maxConcurrency,
    topK,
  }) {
    const totalRequests = Math.max(0, Math.floor(requestsPerSecond * durationSeconds));
    const intervalMs = 1000 / requestsPerSecond;
    const limit = createConcurrencyLimiter(maxConcurrency || requestsPerSecond);
    const startedAt = performance.now();
    const scheduled = [];

    for (let index = 0; index < totalRequests; index += 1) {
      const targetOffset = index * intervalMs;
      const query = queries[index % queries.length];

      scheduled.push((async () => {
        const waitMs = Math.max(0, targetOffset - (performance.now() - startedAt));
        if (waitMs > 0) await this.sleepImpl(waitMs);
        return limit(() => this.executeQuery(query, topK));
      })());
    }

    return Promise.all(scheduled);
  }

  /**
   * Executa a bateria de carga oficial do P.O. Rui Pontes:
   * 100 requisições, concorrência 3, com pacing Free Tier (15 RPM) em modo live.
   */
  async runOfficialLoad(queries, {
    requests = 100,
    concurrency = 3,
    rpmLimit = 15,
    topK = 5,
  } = {}) {
    const total = Math.max(1, requests);
    const limiter = createConcurrencyLimiter(concurrency);
    const batch = repeatQueries(queries, total);
    const results = [];

    // Se estiver em modo mock, não precisa esperar entre requests
    const isMock = Boolean(this.ragClient.mock);
    // Intervalo mínimo global entre requisições para respeitar a cota Free Tier (<= 14 RPM)
    const minIntervalMs = isMock ? 2 : Math.ceil(60000 / Math.max(1, rpmLimit - 1));
    let lastRequestTime = 0;

    const waitForSlot = async () => {
      if (isMock) return;
      const now = Date.now();
      const nextAllowed = Math.max(now, lastRequestTime + minIntervalMs);
      const waitMs = nextAllowed - now;
      lastRequestTime = nextAllowed;
      if (waitMs > 0) {
        await this.sleepImpl(waitMs);
      }
    };

    let currentIndex = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (currentIndex < batch.length) {
        const index = currentIndex;
        currentIndex += 1;

        await waitForSlot();
        const res = await limiter(() => this.executeQuery(batch[index], topK));
        results[index] = res;
      }
    });

    await Promise.all(workers);
    return results;
  }

  buildReport(mode, results, durationMs, baselineScore = null) {
    const latencies = results.map((result) => result.latency_ms).filter(Number.isFinite);
    const successful = results.filter((result) => result.success);
    const averageRelevance = average(successful.map((result) => result.average_relevance));
    const durationSeconds = Math.max(durationMs / 1000, 0.001);
    const relevanceDegradation = (
      Number.isFinite(baselineScore) && baselineScore > 0
        ? (baselineScore - averageRelevance) / baselineScore
        : null
    );

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const errorRate = results.length ? (results.length - successful.length) / results.length : 0;

    const meetsSla = p95 <= 10000 && errorRate <= 0.02;

    return {
      mode,
      total_requests: results.length,
      successful_requests: successful.length,
      failed_requests: results.length - successful.length,
      error_rate: errorRate,
      throughput_qps: results.length / durationSeconds,
      duration_ms: Math.round(durationMs),
      latency_ms: {
        p50,
        p95,
        p99,
        average: Math.round(average(latencies)),
        max: latencies.length ? Math.max(...latencies) : 0,
      },
      average_relevance: averageRelevance,
      relevance_degradation: relevanceDegradation,
      meets_sla: meetsSla,
      sla_limits: {
        max_p95_ms: 10000,
        max_error_rate: 0.02,
      },
      results,
    };
  }

  async run(queries, {
    mode = 'sequential',
    topK = 5,
    concurrency = queries.length || 1,
    rampLevels = [1, 5, 10, 20],
    requestsPerSecond = 5,
    durationSeconds = 10,
    maxConcurrency = requestsPerSecond,
    requests = 100,
    rpmLimit = 15,
    baselineScore = null,
  } = {}) {
    if (!Array.isArray(queries) || queries.length === 0) {
      throw new TypeError('queries deve ser um array não vazio.');
    }

    const startedAt = performance.now();
    let results;

    if (mode === 'sequential') {
      results = await this.runSequential(queries, topK);
    } else if (mode === 'burst') {
      results = await this.runBurst(queries, { concurrency, topK });
    } else if (mode === 'ramp') {
      results = await this.runRamp(queries, { rampLevels, topK });
    } else if (mode === 'sustained') {
      results = await this.runSustained(queries, {
        requestsPerSecond,
        durationSeconds,
        maxConcurrency,
        topK,
      });
    } else if (mode === 'official' || mode === 'load') {
      results = await this.runOfficialLoad(queries, {
        requests,
        concurrency,
        rpmLimit,
        topK,
      });
    } else {
      throw new TypeError(`Modo de carga não suportado: ${mode}`);
    }

    return this.buildReport(mode, results, performance.now() - startedAt, baselineScore);
  }
}

module.exports = {
  LoadRunner,
  createConcurrencyLimiter,
  percentile,
  repeatQueries,
};
