import { bootstrap, onShutdown } from './runtime.js';
import { PgStore } from './store/pg.js';
import { startWorker } from './worker/worker.js';

const { cfg, svc, log, shutdown } = await bootstrap();
const w = startWorker(svc, { intervalSeconds: cfg.WORKER_INTERVAL_SECONDS });
const prune = setInterval(() => {
  if (svc.store instanceof PgStore) svc.store.prune(cfg.SNAPSHOT_RETENTION_DAYS).catch((e) => log.warn('prune_failed', { err: (e as Error).message }));
}, 6 * 3_600_000);
log.info('worker_started', { intervalSeconds: cfg.WORKER_INTERVAL_SECONDS });
onShutdown(log, async () => { clearInterval(prune); await w.stop(); await shutdown(); });
