import type { VerdictService } from '../service.js';
import { dedupeKey, evaluateAlerts } from './alerts.js';

export interface WorkerOpts {
  intervalSeconds?: number;
  idleMinutes?: number;
  batch?: number;
  random?: () => number;
  deliver?: (url: string, body: unknown) => Promise<boolean>;
}

const defaultDeliver = async (url: string, body: unknown) => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
};

/**
 * One worker pass: polls due watches (60s ± jitter, staggered), backs off to 10 min
 * when a token shows no 6h activity, and writes deduped alerts.
 */
export async function tick(svc: VerdictService, o: WorkerOpts = {}) {
  const now = svc.now();
  const nowIso = now.toISOString();
  const interval = (o.intervalSeconds ?? 60) * 1000;
  const rnd = o.random ?? Math.random;
  const deliver = o.deliver ?? defaultDeliver;
  const due = await svc.store.dueWatches(nowIso, o.batch ?? 50);
  const fired: { address: string; kind: string; key: string; delivered: boolean }[] = [];

  for (const w of due) {
    try {
      const hourAgoIso = new Date(now.getTime() - 3_600_000).toISOString();
      const before = await svc.store.history(w.address, hourAgoIso);
      const r = await svc.scan(w.address);
      const current = (await svc.store.history(w.address, r.inputs.now)).at(-1);
      if (current) {
        const previous = before.at(-1) ?? null;
        const hourAgo = before[0] ?? null;
        const alerts = evaluateAlerts(current, hourAgo, previous, current.liqUsd, hourAgo?.liqUsd ?? null);
        for (const a of alerts) {
          const key = dedupeKey(w.address, a.kind, nowIso);
          const fresh = await svc.store.insertAlert({ dedupeKey: key, address: w.address, kind: a.kind, ts: nowIso, payload: { ...a.payload, detail: a.detail, score: current.score, label: current.label }, delivered: false });
          if (!fresh) continue;
          let delivered = false;
          if (w.webhookUrl) delivered = await deliver(w.webhookUrl, { kind: a.kind, address: w.address, detail: a.detail, verdict: { score: current.score, label: current.label, flags: current.flags }, brief: current.brief, ts: nowIso });
          fired.push({ address: w.address, kind: a.kind, key, delivered });
          svc.log.info('alert', { addr: w.address, kind: a.kind, delivered });
        }
      }
      const idle = (r.inputs.market?.vol6hUsd ?? 0) === 0;
      const wait = idle ? (o.idleMinutes ?? 10) * 60_000 : interval;
      const jitter = Math.round((rnd() - 0.5) * 0.2 * wait);
      await svc.store.setNextPoll(w.address, new Date(now.getTime() + wait + jitter).toISOString());
    } catch (e) {
      svc.log.warn('watch_poll_failed', { addr: w.address, err: (e as Error).message });
      await svc.store.setNextPoll(w.address, new Date(now.getTime() + interval * 2).toISOString());
    }
  }
  return { polled: due.length, fired };
}

/** Long-running loop with graceful stop. */
export function startWorker(svc: VerdictService, o: WorkerOpts = {}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<unknown> = Promise.resolve();
  const loop = () => {
    if (stopped) return;
    running = tick(svc, o).catch((e) => svc.log.error('worker_tick_failed', { err: (e as Error).message })).finally(() => {
      if (!stopped) timer = setTimeout(loop, 5_000);
    });
  };
  loop();
  return {
    async stop() { stopped = true; if (timer) clearTimeout(timer); await running; },
  };
}
