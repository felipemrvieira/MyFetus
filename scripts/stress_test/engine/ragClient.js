const { performance } = require('perf_hooks');
const { getMockRagAnswer } = require('./mockRagServer');

class RagClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RagClientError';
    Object.assign(this, details);
  }
}

class RagTimeoutError extends RagClientError {
  constructor(timeoutMs, details = {}) {
    super(`RAG request timed out after ${timeoutMs}ms`, {
      code: 'RAG_TIMEOUT',
      timeoutMs,
      ...details,
    });
    this.name = 'RagTimeoutError';
  }
}

class RagHttpError extends RagClientError {
  constructor(status, responseBody, details = {}) {
    super(`RAG endpoint returned HTTP ${status}`, {
      code: 'RAG_HTTP_ERROR',
      status,
      responseBody,
      ...details,
    });
    this.name = 'RagHttpError';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RagClient {
  constructor({
    baseUrl = process.env.RAG_BASE_URL || 'http://localhost:3000',
    token = process.env.RAG_TEST_JWT || process.env.JWT_TEST_TOKEN,
    endpoint = null,
    endpointType = 'chat', // 'chat' | 'search'
    timeoutMs = Number(process.env.RAG_TIMEOUT_MS || 10000),
    maxAttempts = Number(process.env.RAG_MAX_ATTEMPTS || 2),
    retryDelayMs = Number(process.env.RAG_RETRY_DELAY_MS || 100),
    mock = process.env.RAG_MOCK_MODE === '1' || false,
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
  } = {}) {
    this.mock = Boolean(mock);

    if (!this.mock) {
      if (typeof fetchImpl !== 'function') {
        throw new RagClientError('A Fetch API não está disponível neste runtime.');
      }

      if (!token) {
        throw new RagClientError(
          'JWT ausente. Defina RAG_TEST_JWT ou use o modo determinístico com --mock.'
        );
      }
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    if (endpoint) {
      this.endpoint = endpoint;
    } else if (endpointType === 'search') {
      this.endpoint = `${cleanBaseUrl}/api/internal/rag/search`;
    } else {
      this.endpoint = `${cleanBaseUrl}/api/rag/chat`;
    }

    this.endpointType = endpointType;
    this.token = token || 'mock-dev-token';
    this.timeoutMs = timeoutMs;
    this.maxAttempts = Math.max(1, maxAttempts);
    this.retryDelayMs = Math.max(0, retryDelayMs);
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
  }

  async query(query, topK = 5, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxAttempts = Math.max(1, options.maxAttempts ?? this.maxAttempts);
    const requestStartedAt = performance.now();

    // 1. Execução determinística em modo mock (para CI / Marco M2)
    if (this.mock) {
      const simulatedLatency = Math.min(timeoutMs, Math.max(15, Math.floor(Math.random() * 25) + 10));
      await this.sleepImpl(simulatedLatency);

      try {
        const mockData = getMockRagAnswer(query, options);
        const latencyMs = Math.round(performance.now() - requestStartedAt);
        return {
          status: mockData.status || 200,
          attempts: 1,
          latencyMs,
          data: mockData,
        };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - requestStartedAt);
        if (err.name === 'RagTimeoutError') {
          throw new RagTimeoutError(timeoutMs, { attempts: 1, latencyMs });
        }
        throw new RagHttpError(err.status || 500, { message: err.message }, { attempts: 1, latencyMs });
      }
    }

    // 2. Execução real contra servidor HTTP (Marco M3)
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const requestPayload = {
          query,
          mensagem: query,
          topK,
          ...(options.filtros ? { filtros: options.filtros } : {}),
        };

        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        const responseBody = await this.parseResponseBody(response);
        const latencyMs = Math.round(performance.now() - requestStartedAt);

        if (response.ok) {
          return {
            status: response.status,
            attempts: attempt,
            latencyMs,
            data: responseBody,
          };
        }

        const httpError = new RagHttpError(response.status, responseBody, {
          attempts: attempt,
          latencyMs,
        });

        if (response.status >= 500 && attempt < maxAttempts) {
          lastError = httpError;
          await this.sleepImpl(this.retryDelayMs * attempt);
          continue;
        }

        throw httpError;
      } catch (error) {
        const latencyMs = Math.round(performance.now() - requestStartedAt);

        if (error?.name === 'AbortError') {
          throw new RagTimeoutError(timeoutMs, {
            attempts: attempt,
            latencyMs,
          });
        }

        if (error instanceof RagClientError) {
          throw error;
        }

        lastError = new RagClientError(`Falha de rede ao consultar o RAG: ${error.message}`, {
          code: 'RAG_NETWORK_ERROR',
          attempts: attempt,
          latencyMs,
          cause: error,
        });

        throw lastError;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new RagClientError('Falha desconhecida ao consultar o RAG.');
  }

  async parseResponseBody(response) {
    const contentType = response.headers?.get?.('content-type') || '';

    if (contentType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  async queryMany(queries, {
    mode = 'sequential',
    concurrency = queries.length || 1,
    topK = 5,
    ...options
  } = {}) {
    if (mode === 'sequential') {
      const results = [];

      for (const query of queries) {
        results.push(await this.query(query, topK, options));
      }

      return results;
    }

    const output = new Array(queries.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, queries.length));

    async function worker(client) {
      while (nextIndex < queries.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await client.query(queries[index], topK, options);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker(this)));
    return output;
  }
}

module.exports = {
  RagClient,
  RagClientError,
  RagHttpError,
  RagTimeoutError,
};
