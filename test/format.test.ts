import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js';
import { buildPresence, formatResetLabel, formatTokens, shortenModelName } from '../src/format.js';
import type { AgentSnapshot, FleetSnapshot } from '../src/types.js';

function makeFleet(agents: AgentSnapshot[]): FleetSnapshot {
  const activeAgents = agents.filter((a) => a.active);
  return {
    collectedAtMs: Date.UTC(2026, 10, 23, 18, 30, 0),
    agents,
    activeAgents,
    primaryAgent: activeAgents[0] ?? agents[0],
    totalActiveSessions: activeAgents.reduce((s, a) => s + Math.max(1, a.activeSessionCount), 0),
    totalInstalledAgents: agents.length,
    totalWeeklyTokens: agents.reduce((s, a) => s + a.weeklyTokens.total, 0),
    totalWeeklyCostUsd: agents.reduce((s, a) => s + (a.weeklyCostUsd ?? 0), 0),
  };
}

test('formatTokens and shortenModelName format cleanly', () => {
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(42_500), '42.5K');
  assert.equal(formatTokens(184_000), '184K');
  assert.equal(formatTokens(4_860_000), '4.9M');
  assert.equal(shortenModelName('gemini-4-neon-xhigh'), 'Gemini 4 Neon');
  assert.equal(shortenModelName('anthropic/claude-opus-4-6-20260101'), 'Claude Opus 4.6');
  assert.equal(shortenModelName('<synthetic>'), '');
});

test('buildPresence reproduces claude-rpc usage card with native quota + dedicated Client ID', () => {
  const nowMs = Date.UTC(2026, 10, 23, 18, 30, 0); // Monday Nov 23, 2026
  const wedResetMs = Date.UTC(2026, 10, 25, 18, 30, 0); // Wednesday Nov 25, 2026

  const codex: AgentSnapshot = {
    agentId: 'codex',
    displayName: 'Codex',
    installed: true,
    active: true,
    state: 'coding',
    currentSession: {
      id: 'sess-1',
      agentId: 'codex',
      state: 'coding',
      model: 'gpt-5.4-codex',
      project: 'agent-rpc',
      startedAtMs: nowMs - 38 * 60_000 - 43_000,
      lastActivityMs: nowMs,
    },
    activeSessionCount: 3,
    weeklySessionCount: 12,
    sessionTokens: { input: 80_000, output: 10_000, total: 90_000 },
    weeklyTokens: { input: 2_000_000, output: 200_000, total: 2_200_000 },
    quota: {
      weekly: { usedPercent: 38, label: 'weekly', resetsAtMs: wedResetMs },
      session: { usedPercent: 45, label: 'session' },
      planType: 'plus',
    },
    processCount: 1,
    lastActivityMs: nowMs,
    sources: ['rollout-jsonl'],
  };

  const config = mergeConfig({
    ...DEFAULT_CONFIG,
    defaultClientId: '111111111111111111',
    clientIds: { codex: '222222222222222222' },
    displayMode: 'usage',
    partyMode: 'sessions',
    imageBaseUrl: 'https://example.com/mascots',
  });

  const presence = buildPresence(makeFleet([codex]), config, { nowMs });
  assert.ok(presence);
  assert.equal(presence.clientId, '222222222222222222');
  assert.equal(presence.dedicatedApp, true);
  assert.equal(presence.appTitle, 'Codex');
  assert.equal(presence.activity.name, 'Codex');
  assert.equal(presence.activity.details, 'GPT-5.4-codex · 38% weekly');
  assert.equal(presence.activity.state, 'session 45% · resets Wed');
  assert.deepEqual(presence.activity.party, { id: 'agent-rpc-sessions', size: [3, 3] });
  assert.equal(presence.activity.assets?.large_image, 'https://example.com/mascots/codex.png');
  assert.equal(presence.activity.buttons?.[0]?.label, 'Get agent-rpc →');
});

test('buildPresence in unified single-app mode includes agent name and computes budget quota %', () => {
  const nowMs = Date.UTC(2026, 10, 23, 18, 30, 0);
  const antigravity: AgentSnapshot = {
    agentId: 'antigravity',
    displayName: 'Antigravity',
    installed: true,
    active: true,
    state: 'thinking',
    currentSession: {
      id: 'ag-1',
      agentId: 'antigravity',
      state: 'thinking',
      model: 'gemini-4-neon-xhigh',
      project: 'secret-repo',
      startedAtMs: nowMs - 600_000,
      lastActivityMs: nowMs,
    },
    activeSessionCount: 1,
    weeklySessionCount: 4,
    sessionTokens: { input: 200_000, output: 50_000, total: 250_000 },
    weeklyTokens: { input: 4_000_000, output: 1_000_000, total: 5_000_000 },
    processCount: 1,
    lastActivityMs: nowMs,
    sources: ['transcript'],
  };

  const config = mergeConfig({
    ...DEFAULT_CONFIG,
    defaultClientId: '999999999999999999',
    displayMode: 'usage',
    privacyMode: true,
    quotas: {
      antigravity: { weeklyTokens: 10_000_000, sessionTokens: 1_000_000, resetWeekday: 1 },
    },
  });

  const presence = buildPresence(makeFleet([antigravity]), config, { nowMs });
  assert.ok(presence);
  assert.equal(presence.dedicatedApp, false);
  assert.equal(presence.appTitle, 'Antigravity');
  assert.equal(presence.activity.name, 'Antigravity');
  assert.equal(presence.activity.details, 'Gemini 4 Neon · 50% weekly');
  assert.equal(presence.activity.state, 'session 25% · resets Mon');
  assert.ok(presence.activity.assets?.large_image?.includes('antigravity-color.png'));

  // Verify privacyMode hides project in activity view
  const activityPresence = buildPresence(
    makeFleet([antigravity]),
    { ...config, displayMode: 'activity' },
    { nowMs },
  );
  assert.ok(activityPresence);
  assert.ok(!activityPresence.activity.details?.includes('secret-repo'));
  assert.ok(!activityPresence.activity.state?.includes('secret-repo'));
});

test('formatResetLabel formats hours, weekdays, and month dates', () => {
  const base = Date.UTC(2026, 10, 23, 12, 0, 0);
  assert.equal(formatResetLabel(base + 3 * 3_600_000, undefined, base), 'resets 3h');
  assert.equal(formatResetLabel(base + 2 * 86_400_000, undefined, base), 'resets Wed');
  assert.equal(formatResetLabel(base + 14 * 86_400_000, undefined, base), 'resets Dec 7');
});
