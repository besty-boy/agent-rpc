import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveEventStore } from '../src/collectors/events.js';
import { matchAgentProcesses } from '../src/collectors/generic-agents.js';
import { normalizeAgentId } from '../src/registry.js';

test('normalizeAgentId maps provider aliases cleanly', () => {
  assert.equal(normalizeAgentId('antigravity'), 'antigravity');
  assert.equal(normalizeAgentId('agy'), 'antigravity');
  assert.equal(normalizeAgentId('acpRegistry_mistral_vibe'), 'vibe');
  assert.equal(normalizeAgentId('openai-codex'), 'codex');
  assert.equal(normalizeAgentId('claude-code'), 'claude');
  assert.equal(normalizeAgentId('opencode'), 'opencode');
  assert.equal(normalizeAgentId('my-custom-agent'), 'my-custom-agent');
});

test('LiveEventStore records, merges, and expires real-time hook events', () => {
  const store = new LiveEventStore();
  const t0 = 1_700_000_000_000;

  store.record(
    {
      agent: 'opencode',
      sessionId: 's1',
      state: 'thinking',
      model: 'deepseek-v4.1-flash',
      cwd: '/tmp/my-awesome-repo',
      tokens: { input: 1000, output: 200 },
      ttlMs: 30_000,
    },
    t0,
  );

  const activeSnaps = store.getSnapshots([], t0 + 5_000);
  assert.equal(activeSnaps.length, 1);
  assert.equal(activeSnaps[0]?.agentId, 'opencode');
  assert.equal(activeSnaps[0]?.active, true);
  assert.equal(activeSnaps[0]?.currentSession?.project, 'my-awesome-repo');
  assert.equal(activeSnaps[0]?.sessionTokens.total, 1200);

  // After TTL expires, session transitions to idle rather than active
  const expiredSnaps = store.getSnapshots([], t0 + 60_000);
  assert.equal(expiredSnaps.length, 1);
  assert.equal(expiredSnaps[0]?.active, false);
  assert.equal(expiredSnaps[0]?.state, 'idle');
});

test('matchAgentProcesses detects AI agents while ignoring macOS CursorUIViewService & agent-rpc', () => {
  const procs = [
    { pid: 10, command: '/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/CursorUIViewService' },
    { pid: 11, command: 'node /Users/dev/agent-rpc/dist/src/cli.js start' },
    { pid: 12, command: '/Users/dev/.t3/tools/antigravity-acp/antigravity acp --gemini-dir /tmp' },
    { pid: 13, command: '/usr/local/bin/opencode' },
    { pid: 14, command: '/usr/local/bin/codex --model gpt-5.4' },
    { pid: 15, command: '/usr/local/bin/my-bot --serve' },
  ];

  const matched = matchAgentProcesses(procs, [
    { id: 'mybot', displayName: 'My Bot', processPatterns: ['my-bot'] },
  ]);

  assert.equal(matched.has('cursor'), false);
  assert.equal(matched.get('antigravity'), 1);
  assert.equal(matched.get('opencode'), 1);
  assert.equal(matched.get('codex'), 1);
  assert.equal(matched.get('mybot'), 1);
});
