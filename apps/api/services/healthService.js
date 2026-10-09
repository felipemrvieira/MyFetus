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
  let status = 'up';

  try {
    await withTimeout(probeFn(), timeoutMs);
  } catch (_err) {
    status = 'down';
  }

  return {
    status,
    latency_ms: Date.now() - start,
  };
}

async function checkDependency(client, methodName, callFn, timeoutMs = 3000) {
  if (!client || typeof client[methodName] !== 'function') {
    return { status: 'down', latency_ms: 0 };
  }

  return runProbe(callFn, timeoutMs);
}

async function checkDatabase(db, timeoutMs = 3000) {
  return checkDependency(db, 'query', () => db.query('SELECT 1'), timeoutMs);
}

async function checkVectorStore(vectorStore, timeoutMs = 3000) {
  return checkDependency(vectorStore, 'describeIndexStats', () => vectorStore.describeIndexStats(), timeoutMs);
}

async function getHealthStatus(options = {}) {
  const resolvedOptions = typeof options === 'object' && options !== null ? options : {};

  let db = resolvedOptions.db;
  if (db === undefined) {
    try {
      db = require('../backend');
    } catch (_err) {
      db = null;
    }
  }

  let vectorStore = resolvedOptions.vectorStore;
  if (vectorStore === undefined) {
    try {
      vectorStore = require('./vectorStoreService');
    } catch (_err) {
      vectorStore = null;
    }
  }

  const timeoutMs = resolvedOptions.timeoutMs || 3000;
  const version = resolvedOptions.version || process.env.npm_package_version || '1.0.0';

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
  const resolvedOptions = typeof options === 'object' && options !== null ? options : {};

  try {
    const { httpStatus, payload } = await getHealthStatus(resolvedOptions);
    return res.status(httpStatus).json(payload);
  } catch (_err) {
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: resolvedOptions.version || '1.0.0',
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
