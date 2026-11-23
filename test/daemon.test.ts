import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js';
import { AgentRpcDaemon } from '../src/daemon.js';
import type { DaemonRuntimeStatus } from '../src/types.js';

test('AgentRpcDaemon serves dashboard, mascot PNGs, status, and live event ingestion over HTTP', async () => {
  const port = 47491 + Math.floor(Math.random() * 400);
  const config = mergeConfig({
    ...DEFAULT_CONFIG,
    defaultClientId: '',
    pollIntervalSec: 60,
    cycleIntervalSec: 60,
    server: {
      enabled: true,
      host: '127.0.0.1',
      port,
    },
  });

  const daemon = new AgentRpcDaemon({ config, writePidFile: false, onLog: () => {} });
  await daemon.start();

  try {
    const base = `http://127.0.0.1:${port}`;

    // 1. Dashboard HTML loads
    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('agent-rpc'));
    assert.ok(html.includes('Live Discord Preview'));

    // 2. Mascot PNG loads with valid PNG signature
    const pngRes = await fetch(`${base}/mascots/antigravity.png`);
    assert.equal(pngRes.status, 200);
    const pngBuf = Buffer.from(await pngRes.arrayBuffer());
    assert.deepEqual([...pngBuf.subarray(0, 4)], [137, 80, 78, 71]);

    // 3. Push a live custom agent event and verify it appears in /v1/status & presence
    const evRes = await fetch(`${base}/v1/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'my-future-agent',
        state: 'thinking',
        model: 'gpt-6-turbo',
        project: 'cool-project',
        quota: {
          weekly: { usedPercent: 42, label: 'weekly' },
          session: { usedPercent: 18, label: 'session' },
        },
      }),
    });
    assert.equal(evRes.status, 202);

    // Pin that custom agent and verify presence card renders it
    const pinRes = await fetch(`${base}/v1/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'my-future-agent' }),
    });
    assert.equal(pinRes.status, 200);

    const statusRes = await fetch(`${base}/v1/status`);
    assert.equal(statusRes.status, 200);
    const st = (await statusRes.json()) as DaemonRuntimeStatus;
    assert.equal(st.running, true);
    assert.equal(st.currentPresence?.agentId, 'my-future-agent');
    assert.equal(st.currentPresence?.activity.name, 'My Future Agent');
    assert.equal(st.currentPresence?.activity.details, 'GPT-6-turbo · 42% weekly');

    // 4. Pause clears presence, resume restores it
    await fetch(`${base}/v1/pause`, { method: 'POST' });
    const pausedSt = (await (await fetch(`${base}/v1/status`)).json()) as DaemonRuntimeStatus;
    assert.equal(pausedSt.paused, true);
    assert.equal(pausedSt.currentPresence, null);

    await fetch(`${base}/v1/resume`, { method: 'POST' });
    const resumedSt = (await (await fetch(`${base}/v1/status`)).json()) as DaemonRuntimeStatus;
    assert.equal(resumedSt.paused, false);
    assert.equal(resumedSt.currentPresence?.agentId, 'my-future-agent');
  } finally {
    await daemon.stop();
  }
});
