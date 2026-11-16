import { bootstrap } from './runtime.js';
import { serveStdio } from './mcp/stdio.js';

// stdout carries protocol messages only; the JSON logger writes to stderr.
const { svc, shutdown } = await bootstrap();
const s = serveStdio(svc, { input: process.stdin, output: process.stdout, agentId: process.env.VERDICT_AGENT_ID ?? 'stdio', apiKey: process.env.VERDICT_API_KEY ?? null });
await s.closed;
await shutdown();
