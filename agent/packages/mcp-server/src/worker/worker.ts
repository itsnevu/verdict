import { guardedFetch } from '../net.js';
import type { VerdictService } from '../service.js';
import { dedupeKey, evaluateAlerts } from './alerts.js';

export interface WorkerOpts {
  intervalSeconds?: number;
  idleMinutes?: number;
  batch?: number;
  random?: () => number;
  deliver?: (url: string, body: unknown) => Promise<boolean>;
}

/**
 * One worker pass. Due watches are grouped per token: one scan per token, alerts evaluated once
 * and deduped by {addr}:{kind}:{hour}, then delivered to every active watcher of that token.
 * Polls every 60s ± jitter (staggered), 10 min when the token shows no 6h activity.
 */
export async function tick(svc: VerdictService, o: WorkerOpts = {}) {
  const now = svc.now();
  const nowIso = now.toISOString();
  const interval = (o.intervalSeconds ?? 60) * 1000;
  const rnd = o.random ?? Math.random;
  const deliver = o.deliver ?? (async (url: string, body: unknown) => {
    try {
      await svc.checkUrl(url); // re-checked at delivery: DNS may have changed since registration
      const r = await guardedFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), maxBytes: 4096 });
      return r.ok;
    } catch { return false; }
  });
  const due = await svc.store.dueWatches(nowIso, o.batch ?? 50);
  const addresses = [...new Set(due.map((w) => w.address))];
  const fired: { address: string; kind: string; key: string; delivered: number }[] = [];

  for (const address of addresses) {
    try {
      const hourAgoIso = new Date(now.getTime() - 3_600_000).toISOString();
      const before = await svc.store.history(address, hourAgoIso);
      const r = await svc.scan(address);
      const current = (await svc.store.history(address, r.inputs.now)).at(-1);
      if (current) {
        const previous = before.at(-1) ?? null;
        const hourAgo = before[0] ?? null;
        const alerts = evaluateAlerts(current, hourAgo, previous, current.liqUsd, hourAgo?.liqUsd ?? null);
        for (const a of alerts) {
          const key = dedupeKey(address, a.kind, nowIso);
          const fresh = await svc.store.insertAlert({ dedupeKey: key, address, kind: a.kind, ts: nowIso, payload: { ...a.payload, detail: a.detail, score: current.score, label: current.label }, delivered: false });
          if (!fresh) continue;
          const body = { kind: a.kind, address, detail: a.detail, verdict: { score: current.score, label: current.label, flags: current.flags }, brief: current.brief, ts: nowIso };
          const targets = [...new Set((await svc.store.watchersOf(address, nowIso)).map((w) => w.webhookUrl).filter((u): u is string => !!u))];
          let delivered = 0;
          for (const url of targets) if (await deliver(url, body)) delivered++;
          fired.push({ address, kind: a.kind, key, delivered });
          svc.log.info('alert', { addr: address, kind: a.kind, webhooks: targets.length, delivered });
        }
      }
      const idle = (r.inputs.market?.vol6hUsd ?? 0) === 0;
      const wait = idle ? (o.idleMinutes ?? 10) * 60_000 : interval;
      const jitter = Math.round((rnd() - 0.5) * 0.2 * wait);
      await svc.store.setNextPoll(address, new Date(now.getTime() + wait + jitter).toISOString());
    } catch (e) {
      svc.log.warn('watch_poll_failed', { addr: address, err: (e as Error).message });
      await svc.store.setNextPoll(address, new Date(now.getTime() + interval * 2).toISOString());
    }
  }
  return { polled: addresses.length, fired };
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
