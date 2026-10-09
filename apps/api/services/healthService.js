function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout excedido após ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function runProbe(probeFn, timeoutMs = 3000) {
  const start = Date.now();

  try {
    await withTimeout(probeFn(), timeoutMs);
    const latency_ms = Date.now() - start;

    return {
      status: 'up',
      latency_ms,
    };
  } catch (_err) {
    const latency_ms = Date.now() - start;

    return {
      status: 'down',
      latency_ms,
    };
  }
}

async function checkDatabase(db, timeoutMs = 3000) {
  if (!db || typeof db.query !== 'function') {
    return { status: 'down', latency_ms: 0 };
  }

  return runProbe(() => db.query('SELECT 1'), timeoutMs);
}

async function checkVectorStore(vectorStore, timeoutMs = 3000) {
  if (!vectorStore || typeof vectorStore.describeIndexStats !== 'function') {
    return { status: 'down', latency_ms: 0 };
  }

  return runProbe(() => vectorStore.describeIndexStats(), timeoutMs);
}

async function getHealthStatus(options = {}) {
  const db = options.db !== undefined ? options.db : require('../backend');
  const vectorStore = options.vectorStore !== undefined ? options.vectorStore : require('./vectorStoreService');
  const timeoutMs = options.timeoutMs || 3000;
  const version = options.version || process.env.npm_package_version || '1.0.0';

  const [dbResult, vectorResult] = await Promise.allSettled([
    checkDatabase(db, timeoutMs),
    checkVectorStore(vectorStore, timeoutMs),
  ]);

  const dbCheck = dbResult.status === 'fulfilled' ? dbResult.value : { status: 'down', latency_ms: timeoutMs };
  const vectorCheck = vectorResult.status === 'fulfilled' ? vectorResult.value : { status: 'down', latency_ms: timeoutMs };

  const isDbUp = dbCheck.status === 'up';
  const isVectorUp = vectorCheck.status === 'up';

  let status = 'ok';
  let httpStatus = 200;

  if (!isDbUp) {
    status = 'unhealthy';
    httpStatus = 503;
  } else if (!isVectorUp) {
    status = 'degraded';
    httpStatus = 200;
  }

  const payload = {
    status,
    timestamp: new Date().toISOString(),
    version,
    checks: {
      database: dbCheck,
      vector_store: vectorCheck,
    },
  };

  return {
    httpStatus,
    payload,
  };
}

async function handleHealthRequest(req, res, options = {}) {
  try {
    const { httpStatus, payload } = await getHealthStatus(options);
    return res.status(httpStatus).json(payload);
  } catch (_err) {
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: options.version || '1.0.0',
      checks: {
        database: { status: 'down', latency_ms: 0 },
        vector_store: { status: 'down', latency_ms: 0 },
      },
    });
  }
}

module.exports = {
  checkDatabase,
  checkVectorStore,
  getHealthStatus,
  handleHealthRequest,
};
