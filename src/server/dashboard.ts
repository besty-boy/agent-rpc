export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>agent-rpc · Universal AI Agent Discord RPC</title>
  <style>
    :root {
      --bg: #0b0d12;
      --surface: #131620;
      --surface-2: #1b1f2e;
      --border: #262c3f;
      --text: #eef1f8;
      --muted: #8b95b0;
      --accent: #6366f1;
      --accent-soft: rgba(99, 102, 241, 0.16);
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap {
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px 20px 64px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 42px;
      height: 42px;
      border-radius: 11px;
      background: #0b0b0f;
      border: 1px solid var(--border);
      image-rendering: pixelated;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .subtitle {
      color: var(--muted);
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--surface);
      border: 1px solid var(--border);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
    }
    .dot.ok { background: var(--green); box-shadow: 0 0 8px var(--green); }
    .dot.warn { background: var(--amber); }
    .dot.err { background: var(--red); }

    button, select, input {
      font: inherit;
      color: inherit;
    }
    .btn {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 13px;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn:hover { background: #242a3d; border-color: #3a4361; }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.primary:hover { background: #4f46e5; }
    .btn.small { padding: 4px 10px; font-size: 12px; border-radius: 7px; }

    .grid-top {
      display: grid;
      grid-template-columns: minmax(340px, 470px) 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    @media (max-width: 860px) {
      .grid-top { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .panel-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      font-weight: 700;
    }

    /* Pixel-accurate Discord Rich Presence Preview Card */
    .discord-stage {
      padding: 16px;
      border-radius: 14px;
      background: linear-gradient(135deg, #2b2d31, #1e1f22);
      transition: background 0.2s;
    }
    .discord-stage.light {
      background: linear-gradient(135deg, #e9d9ec, #f2e4f0);
    }
    .discord-card {
      background: #111214;
      color: #f2f3f5;
      border-radius: 12px;
      padding: 14px 16px 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .discord-stage.light .discord-card {
      background: rgba(255, 255, 255, 0.72);
      color: #111214;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08);
    }
    .dc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
      color: #b5bac1;
      margin-bottom: 10px;
    }
    .discord-stage.light .dc-header { color: #313338; }
    .dc-body {
      display: flex;
      gap: 14px;
      align-items: center;
    }
    .dc-art {
      position: relative;
      width: 92px;
      height: 92px;
      flex-shrink: 0;
    }
    .dc-art img {
      width: 92px;
      height: 92px;
      border-radius: 10px;
      background: #0b0b0f;
      padding: 8px;
      object-fit: contain;
      display: block;
    }
    .dc-info {
      flex: 1;
      min-width: 0;
    }
    .dc-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dc-details, .dc-state {
      font-size: 13.5px;
      color: #dbdee1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .discord-stage.light .dc-details,
    .discord-stage.light .dc-state {
      color: #2b2d31;
    }
    .dc-state-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 13px;
      color: #dbdee1;
    }
    .discord-stage.light .dc-state-row { color: #2b2d31; }
    .dc-timer {
      color: #23a55a;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .discord-stage.light .dc-timer { color: #2d7d46; }
    .dc-btn {
      margin-top: 12px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 8px;
      background: #2b2d31;
      color: #f2f3f5;
      font-size: 13.5px;
      font-weight: 600;
      text-align: center;
      text-decoration: none;
      display: block;
    }
    .discord-stage.light .dc-btn {
      background: rgba(255, 255, 255, 0.9);
      color: #111214;
      border: 1px solid rgba(0, 0, 0, 0.08);
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 14px;
    }
    .stat-box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .stat-val {
      font-size: 18px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .stat-lbl {
      font-size: 11px;
      color: var(--muted);
    }

    .agents-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
      gap: 12px;
    }
    .agent-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-card.active { border-color: rgba(34, 197, 94, 0.55); }
    .agent-card.pinned { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .agent-top {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .agent-top img {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      background: #0b0b0f;
      padding: 4px;
      object-fit: contain;
    }
    .agent-name { font-weight: 700; font-size: 14px; }
    .agent-meta { font-size: 12px; color: var(--muted); }
    .badge {
      margin-left: auto;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(139, 149, 176, 0.16);
      color: var(--muted);
    }
    .badge.active { background: rgba(34, 197, 94, 0.18); color: #4ade80; }
    .agent-stats {
      font-size: 12px;
      color: #cbd5e1;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .agent-actions {
      display: flex;
      gap: 6px;
      margin-top: auto;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 640px) {
      .form-grid { grid-template-columns: 1fr; }
    }
    label.field {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 12px;
      color: var(--muted);
    }
    label.field.full { grid-column: 1 / -1; }
    .input {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      color: var(--text);
    }
    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text);
      margin-top: 6px;
    }
    .alert {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.35);
      color: #fcd34d;
      font-size: 12.5px;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1e293b;
      border: 1px solid #334155;
      color: #fff;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      opacity: 0;
      transform: translateY(8px);
      transition: all 0.2s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    code {
      background: rgba(255,255,255,0.08);
      padding: 2px 5px;
      border-radius: 5px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <img class="brand-logo" src="/mascots/generic.png" alt="agent-rpc" />
        <div>
          <h1>agent-rpc</h1>
          <div class="subtitle">Universal Discord Rich Presence for ALL AI Coding Agents</div>
        </div>
      </div>
      <div class="toolbar">
        <div class="pill" id="discord-pill">
          <span class="dot" id="discord-dot"></span>
          <span id="discord-label">Connecting…</span>
        </div>
        <button class="btn" id="theme-btn">Discord Light</button>
        <button class="btn" id="pause-btn">Pause</button>
      </div>
    </header>

    <div class="grid-top">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Live Discord Preview</div>
          <span class="subtitle" id="view-badge">—</span>
        </div>
        <div class="discord-stage light" id="discord-stage">
          <div class="discord-card">
            <div class="dc-header">
              <span id="dc-header-label">Joue à</span>
              <span>•••</span>
            </div>
            <div class="dc-body">
              <div class="dc-art">
                <img id="dc-img" src="/mascots/antigravity.png" alt="Mascot" />
              </div>
              <div class="dc-info">
                <div class="dc-title" id="dc-title">Agent RPC</div>
                <div class="dc-details" id="dc-details">Waiting for active agent…</div>
                <div class="dc-state-row">
                  <span id="dc-state">Idle</span>
                  <span id="dc-party"></span>
                  <span class="dc-timer" id="dc-timer" style="display:none">🎮 00:00</span>
                </div>
              </div>
            </div>
            <a class="dc-btn" id="dc-btn" href="#" target="_blank" rel="noreferrer" style="display:none">Get agent-rpc →</a>
          </div>
        </div>
        <div id="discord-alert" class="alert" style="display:none"></div>
        <div class="stats-row">
          <div class="stat-box">
            <div class="stat-val" id="stat-active">0</div>
            <div class="stat-lbl">Active Agents</div>
          </div>
          <div class="stat-box">
            <div class="stat-val" id="stat-detected">0</div>
            <div class="stat-lbl">Detected</div>
          </div>
          <div class="stat-box">
            <div class="stat-val" id="stat-tokens">0</div>
            <div class="stat-lbl">7d Tokens</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">Configuration</div>
          <button class="btn primary small" id="save-btn">Save & Apply</button>
        </div>
        <div class="form-grid">
          <label class="field full">
            Default Discord Client ID (from discord.com/developers/applications)
            <input class="input" id="cfg-clientId" placeholder="e.g. 1234567890123456789" />
          </label>
          <label class="field">
            Display Mode
            <select class="input" id="cfg-displayMode">
              <option value="cycle">Cycle (Usage → Activity → Fleet)</option>
              <option value="usage">Usage / Quotas (claude-rpc style)</option>
              <option value="activity">Activity / Model / Project</option>
              <option value="fleet">All Agents Fleet</option>
            </select>
          </label>
          <label class="field">
            Party Counter "(N sur N)"
            <select class="input" id="cfg-partyMode">
              <option value="sessions">Active Sessions (N sur N)</option>
              <option value="fleet">Active / Installed Agents</option>
              <option value="multi-only">Only when 2+ active</option>
              <option value="off">Hidden</option>
            </select>
          </label>
          <label class="field">
            Discord Activity Type
            <select class="input" id="cfg-activityType">
              <option value="0">Playing / Joue à (default)</option>
              <option value="3">Watching / Regarde (stacks with Playing)</option>
              <option value="2">Listening / Écoute (stacks with Playing)</option>
              <option value="5">Competing / Participe à (stacks with Playing)</option>
            </select>
          </label>
          <label class="field">
            Button Label (empty to hide)
            <input class="input" id="cfg-btnLabel" placeholder="Get agent-rpc →" />
          </label>
          <label class="field">
            Button URL
            <input class="input" id="cfg-btnUrl" placeholder="https://github.com/..." />
          </label>
          <label class="field full">
            Mascot Image Base URL (optional HTTPS folder containing antigravity.png, codex.png, etc.)
            <input class="input" id="cfg-imageBaseUrl" placeholder="Leave empty to use Discord Developer Art Assets (antigravity, codex...)" />
          </label>
          <label class="field full">
            Per-Agent Client IDs (optional JSON map so Discord's bold title switches per agent!)
            <input class="input" id="cfg-clientIds" placeholder='{"antigravity":"...","codex":"...","opencode":"...","claude":"..."}' />
          </label>
          <label class="check-row">
            <input type="checkbox" id="cfg-privacy" /> Privacy mode (hide project names)
          </label>
          <label class="check-row">
            <input type="checkbox" id="cfg-timer" /> Show live session timer
          </label>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Detected AI Agents</div>
        <button class="btn small" id="clear-override-btn" style="display:none">Clear Pinned Agent</button>
      </div>
      <div class="agents-grid" id="agents-grid"></div>
    </div>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    let latestStatus = null;
    let configLoaded = false;

    function escHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function timerIconFor(type) {
      return type === 3 ? '🖥 ' : type === 2 ? '🎵 ' : '🎮 ';
    }

    function fmtTok(n) {
      if (!n || n <= 0) return '0';
      if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\\.0$/, '') + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\\.0$/, '') + 'K';
      return String(Math.round(n));
    }

    function fmtTimer(startSec) {
      const diff = Math.max(0, Math.floor(Date.now() / 1000) - startSec);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      const p = (v) => String(v).padStart(2, '0');
      return h > 0 ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
    }

    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 2400);
    }

    function renderStatus(st) {
      latestStatus = st;
      const dot = document.getElementById('discord-dot');
      const lbl = document.getElementById('discord-label');
      const alertBox = document.getElementById('discord-alert');

      if (st.paused) {
        dot.className = 'dot warn';
        lbl.textContent = 'Paused';
      } else if (st.discord.connected) {
        dot.className = 'dot ok';
        lbl.textContent = 'Connected' + (st.discord.user?.username ? ' · @' + st.discord.user.username : '');
      } else {
        dot.className = 'dot err';
        lbl.textContent = 'Discord Offline / Setup Needed';
      }

      if (st.discord.lastError && !st.discord.connected) {
        alertBox.style.display = 'block';
        alertBox.textContent = st.discord.lastError;
      } else {
        alertBox.style.display = 'none';
      }

      document.getElementById('pause-btn').textContent = st.paused ? 'Resume' : 'Pause';
      document.getElementById('stat-active').textContent = String(st.fleet.activeAgents.length);
      document.getElementById('stat-detected').textContent = String(st.fleet.totalInstalledAgents);
      document.getElementById('stat-tokens').textContent = fmtTok(st.fleet.totalWeeklyTokens);

      const pres = st.currentPresence;
      const img = document.getElementById('dc-img');
      const title = document.getElementById('dc-title');
      const details = document.getElementById('dc-details');
      const state = document.getElementById('dc-state');
      const party = document.getElementById('dc-party');
      const timer = document.getElementById('dc-timer');
      const btn = document.getElementById('dc-btn');
      const viewBadge = document.getElementById('view-badge');

      if (pres) {
        const actType = pres.activity.type ?? 0;
        const appName = pres.activity.name || pres.appTitle;
        const headerEl = document.getElementById('dc-header-label');
        headerEl.textContent = actType === 3 ? 'Regarde ' + appName : actType === 2 ? 'Écoute ' + appName : actType === 5 ? 'Participe à ' + appName : 'Joue à';
        viewBadge.textContent = pres.view.toUpperCase() + ' · ' + appName;
        img.src = '/mascots/' + encodeURIComponent(pres.agentId) + '.png';
        img.onerror = () => { img.src = '/mascots/generic.png'; };
        title.textContent = actType === 0 ? appName : (pres.activity.details || appName);
        details.textContent = actType === 0 ? (pres.activity.details || '') : (pres.activity.state || '');
        state.textContent = actType === 0 ? ((pres.activity.party ? '👥 ' : '') + (pres.activity.state || '')) : '';
        party.textContent = actType === 0 && pres.activity.party ? '(' + pres.activity.party.size[0] + ' sur ' + pres.activity.party.size[1] + ')' : '';
        if (pres.activity.timestamps?.start) {
          timer.style.display = 'inline-flex';
          const icon = actType === 3 ? '🖥 ' : actType === 2 ? '🎵 ' : '🎮 ';
          timer.textContent = icon + fmtTimer(pres.activity.timestamps.start);
        } else {
          timer.style.display = 'none';
        }
        if (pres.activity.buttons?.[0]) {
          btn.style.display = 'block';
          btn.textContent = pres.activity.buttons[0].label;
          btn.href = pres.activity.buttons[0].url;
        } else {
          btn.style.display = 'none';
        }
      } else {
        viewBadge.textContent = 'IDLE';
        title.textContent = 'Agent RPC';
        details.textContent = 'No active AI agent detected';
        state.textContent = 'Start Antigravity, Codex, OpenCode, Claude Code…';
        party.textContent = '';
        timer.style.display = 'none';
        btn.style.display = 'none';
      }

      document.getElementById('clear-override-btn').style.display = st.overrideAgentId ? 'inline-block' : 'none';

      const grid = document.getElementById('agents-grid');
      grid.innerHTML = '';
      for (const a of st.fleet.agents) {
        const card = document.createElement('div');
        card.className = 'agent-card' + (a.active ? ' active' : '') + (st.overrideAgentId === a.agentId ? ' pinned' : '');
        const model = a.currentSession?.model || '—';
        const proj = a.currentSession?.project || '—';
        const quotaTxt = a.quota?.weekly ? Math.round(a.quota.weekly.usedPercent) + '% ' + a.quota.weekly.label : fmtTok(a.weeklyTokens.total) + ' tok/wk';
        card.innerHTML =
          '<div class="agent-top">' +
            '<img src="/mascots/' + encodeURIComponent(a.agentId) + '.png" onerror="this.src=\\'/mascots/generic.png\\'" />' +
            '<div>' +
              '<div class="agent-name">' + escHtml(a.displayName) + '</div>' +
              '<div class="agent-meta">' + escHtml(model) + '</div>' +
            '</div>' +
            '<span class="badge ' + (a.active ? 'active' : '') + '">' + escHtml(a.active ? a.state : 'idle') + '</span>' +
          '</div>' +
          '<div class="agent-stats">' +
            '<span>📁 ' + escHtml(proj) + '</span>' +
            '<span>' + escHtml(quotaTxt) + '</span>' +
          '</div>' +
          '<div class="agent-actions">' +
            '<button class="btn small" data-pin="' + escHtml(a.agentId) + '">' +
              (st.overrideAgentId === a.agentId ? 'Pinned ✓' : 'Pin to Discord') +
            '</button>' +
          '</div>';
        grid.appendChild(card);
      }

      grid.querySelectorAll('[data-pin]').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = b.getAttribute('data-pin');
          const next = st.overrideAgentId === id ? null : id;
          await fetch('/v1/override', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: next }),
          });
          toast(next ? 'Pinned ' + next : 'Cleared pin');
          refresh();
        });
      });
    }

    async function loadConfig() {
      const res = await fetch('/v1/config');
      const cfg = await res.json();
      document.getElementById('cfg-clientId').value = cfg.defaultClientId || '';
      document.getElementById('cfg-displayMode').value = cfg.displayMode || 'cycle';
      document.getElementById('cfg-partyMode').value = cfg.partyMode || 'sessions';
      document.getElementById('cfg-activityType').value = String(cfg.activityType ?? 0);
      document.getElementById('cfg-btnLabel').value = cfg.buttons?.[0]?.label || '';
      document.getElementById('cfg-btnUrl').value = cfg.buttons?.[0]?.url || '';
      document.getElementById('cfg-imageBaseUrl').value = cfg.imageBaseUrl || '';
      document.getElementById('cfg-clientIds').value = Object.keys(cfg.clientIds || {}).length ? JSON.stringify(cfg.clientIds) : '';
      document.getElementById('cfg-privacy').checked = Boolean(cfg.privacyMode);
      document.getElementById('cfg-timer').checked = cfg.showTimer !== false;
      configLoaded = true;
    }

    async function refresh() {
      try {
        const res = await fetch('/v1/status');
        const st = await res.json();
        renderStatus(st);
        if (!configLoaded) await loadConfig();
      } catch {}
    }

    document.getElementById('theme-btn').addEventListener('click', (e) => {
      const stage = document.getElementById('discord-stage');
      const isLight = stage.classList.toggle('light');
      e.target.textContent = isLight ? 'Discord Dark' : 'Discord Light';
    });

    document.getElementById('pause-btn').addEventListener('click', async () => {
      if (!latestStatus) return;
      await fetch(latestStatus.paused ? '/v1/resume' : '/v1/pause', { method: 'POST' });
      toast(latestStatus.paused ? 'Resumed' : 'Paused');
      refresh();
    });

    document.getElementById('clear-override-btn').addEventListener('click', async () => {
      await fetch('/v1/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: null }),
      });
      toast('Back to auto-detect');
      refresh();
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      const btnLabel = document.getElementById('cfg-btnLabel').value.trim();
      const btnUrl = document.getElementById('cfg-btnUrl').value.trim();
      let clientIds = {};
      const rawMap = document.getElementById('cfg-clientIds').value.trim();
      if (rawMap) {
        try {
          clientIds = JSON.parse(rawMap);
        } catch {
          toast('Invalid JSON in Per-Agent Client IDs');
          return;
        }
      }
      const patch = {
        defaultClientId: document.getElementById('cfg-clientId').value.trim(),
        clientIds,
        displayMode: document.getElementById('cfg-displayMode').value,
        partyMode: document.getElementById('cfg-partyMode').value,
        activityType: Number(document.getElementById('cfg-activityType').value),
        privacyMode: document.getElementById('cfg-privacy').checked,
        showTimer: document.getElementById('cfg-timer').checked,
        imageBaseUrl: document.getElementById('cfg-imageBaseUrl').value.trim(),
        buttons: btnLabel && btnUrl ? [{ label: btnLabel, url: btnUrl }] : [],
      };
      const res = await fetch('/v1/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        toast('Configuration saved & applied!');
        refresh();
      } else {
        toast('Failed to save configuration');
      }
    });

    refresh();
    setInterval(refresh, 3000);
    setInterval(() => {
      const act = latestStatus?.currentPresence?.activity;
      const start = act?.timestamps?.start;
      if (start) {
        document.getElementById('dc-timer').textContent = timerIconFor(act.type ?? 0) + fmtTimer(start);
      }
    }, 1000);
  </script>
</body>
</html>`;
}
