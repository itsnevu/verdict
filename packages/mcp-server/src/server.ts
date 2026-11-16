import { buildApp } from './http/app.js';
import { bootstrap, onShutdown } from './runtime.js';

const { cfg, svc, log, shutdown } = await bootstrap();
const app = buildApp(svc, { trustProxyHops: cfg.TRUST_PROXY_HOPS });
await app.listen({ port: cfg.PORT, host: cfg.HOST });
log.info('api_listening', { port: cfg.PORT });
onShutdown(log, async () => { await app.close(); await shutdown(); });
