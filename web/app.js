/* agent-replay — dashboard + session detail SPA */

const ICONS = {
    spawn: '★', think: '◆', tool_call: '▸', tool_result: '◂',
    file_create: '+', file_update: '~', file_read: '○',
    bash: '$', web_search: '⌕', text: '│', error: '✖',
    complete: '✔', user: '▶',
};

const EVENT_LABELS = {
    spawn: 'Spawn', think: 'Think', tool_call: 'Tool', tool_result: 'Result',
    file_create: 'Create', file_update: 'Edit', file_read: 'Read',
    bash: 'Bash', web_search: 'Web', text: 'Text', error: 'Error',
    complete: 'Done', user: 'User',
};

let state = {
    view: 'dashboard',
    sessions: [],
    session: null,
    ws: null,
    filters: {},
    autoScroll: true,
    inventory: {},
};

// --- Routing ---

function navigate(hash) {
    window.location.hash = hash;
}

function handleRoute() {
    const hash = window.location.hash || '#/';
    if (hash.startsWith('#/session/')) {
        const filePath = decodeURIComponent(hash.slice('#/session/'.length));
        showSessionView(filePath);
    } else {
        showDashboard();
    }
}

window.addEventListener('hashchange', handleRoute);

// --- Dashboard ---

function showDashboard() {
    state.view = 'dashboard';
    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'flex';
    document.getElementById('session-view').style.display = 'none';
    loadSessions();
    connectDashboardWS();
}

async function loadSessions() {
    try {
        const resp = await fetch('/api/sessions');
        state.sessions = await resp.json();
        renderDashboard();
    } catch (e) {
        console.error('Failed to load sessions:', e);
    }
}

function connectDashboardWS() {
    if (state.ws) state.ws.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/dashboard`);
    state.ws = ws;
    const statusEl = document.getElementById('dash-status');

    ws.onopen = () => { statusEl.className = 'conn-status connected'; statusEl.textContent = 'live'; };
    ws.onclose = () => { statusEl.className = 'conn-status'; statusEl.textContent = 'disconnected'; };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'sessions') {
            state.sessions = msg.data;
            renderDashboard();
        }
    };
}

function renderDashboard() {
    const grid = document.getElementById('session-grid');
    const empty = document.getElementById('no-sessions');

    if (!state.sessions.length) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';

    grid.innerHTML = state.sessions.map(s => {
        const activeHtml = s.is_active ? '<span class="active-dot"></span>' : '';
        const branchHtml = s.branch ? `<span class="branch">⎇ ${esc(s.branch)}</span>` : '';
        const timeAgo = formatTimeAgo(s.last_modified);
        return `
        <div class="session-card" data-path="${esc(s.file_path)}">
            <div class="card-header">
                ${activeHtml}
                <span class="project-name">${esc(s.project_name)}</span>
            </div>
            <div class="card-meta">
                ${branchHtml}
                <span class="agents">★ ${s.agent_count} agent${s.agent_count !== 1 ? 's' : ''}</span>
                <span class="events">~${s.event_count} lines</span>
                <span class="time">${timeAgo}</span>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.session-card').forEach(card => {
        card.addEventListener('click', () => {
            const filePath = card.dataset.path;
            navigate('#/session/' + encodeURIComponent(filePath));
        });
    });
}

// --- Session Detail ---

async function showSessionView(filePath) {
    state.view = 'session';
    state.inventory = {};
    if (state.ws) { state.ws.close(); state.ws = null; }
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('session-view').style.display = 'flex';

    document.getElementById('back-btn').onclick = () => navigate('#/');
    document.getElementById('event-log').innerHTML = '<div class="empty-state">Loading…</div>';

    try {
        const resp = await fetch('/api/session/' + encodeURIComponent(filePath));
        const data = await resp.json();
        if (data.error) {
            document.getElementById('event-log').innerHTML = `<div class="empty-state">${esc(data.error)}</div>`;
            return;
        }
        state.session = data;
        initFilters();
        renderSession();
        connectSessionWS(filePath);
    } catch (e) {
        document.getElementById('event-log').innerHTML = `<div class="empty-state">Failed to load session</div>`;
    }
}

function renderSession() {
    const s = state.session;
    if (!s) return;

    // Header
    document.getElementById('session-slug').textContent = s.slug || 'agent-replay';
    const meta = [];
    if (s.version) meta.push(`v${s.version}`);
    if (s.branch) meta.push(`⎇ ${s.branch}`);
    document.getElementById('session-meta').textContent = meta.join('  ');

    renderTokenInfo(s);
    renderEvents(s);
    renderAgents(s);
    renderInventory(s);
}

function renderTokenInfo(s) {
    const agents = Object.values(s.agents);
    const totalIn = agents.reduce((sum, a) => sum + a.input_tokens, 0);
    const totalOut = agents.reduce((sum, a) => sum + a.output_tokens, 0);
    const totalCache = agents.reduce((sum, a) => sum + a.cache_read_tokens, 0);
    const cost = (totalIn * 3.0 + totalOut * 15.0 + totalCache * 0.30) / 1_000_000;

    const el = document.getElementById('session-tokens');
    if (totalIn + totalOut === 0) { el.innerHTML = ''; return; }

    el.innerHTML = `tokens: <span class="tok-in">${fmtTokens(totalIn)}</span> in `
        + `<span class="tok-out">${fmtTokens(totalOut)}</span> out`
        + (totalCache > 0 ? ` <span class="tok-cache">${fmtTokens(totalCache)}</span> cached` : '')
        + ` ~$<span class="tok-cost">${cost < 1 ? cost.toFixed(3) : cost.toFixed(2)}</span>`;
}

function renderEvents(s) {
    const log = document.getElementById('event-log');
    const wasAtBottom = state.autoScroll;
    log.innerHTML = '';

    state.inventory = {};

    s.events.forEach((evt, idx) => {
        // Track inventory
        if (evt.file_path) {
            const sp = evt.short_path || evt.file_path;
            if (evt.type === 'file_create') state.inventory[sp] = 'C';
            else if (evt.type === 'file_update') state.inventory[sp] = 'W';
            else if (evt.type === 'file_read' && !state.inventory[sp]) state.inventory[sp] = 'R';
        }

        if (!isEventVisible(evt.type)) return;

        const agent = s.agents[evt.agent_id];
        const row = document.createElement('div');
        row.className = `event-row type-${evt.type}`;
        row.dataset.idx = idx;

        const icon = ICONS[evt.type] || '·';
        const agentName = agent ? agent.name : evt.agent_id;
        const agentColor = agent ? agent.color : 'white';
        const isSubagent = agent ? agent.is_subagent : false;
        const tagClass = isSubagent ? `agent-bg-${agentColor}` : `agent-color-${agentColor}`;

        let summaryText = buildSummaryText(evt);
        let tokensHtml = '';
        const totalTok = evt.input_tokens + evt.output_tokens;
        if (totalTok > 0) tokensHtml = `<span class="tokens">+${fmtTokens(totalTok)}</span>`;

        row.innerHTML = `<span class="icon">${icon}</span>`
            + `<span class="agent-tag ${tagClass}">${esc(agentName)}</span>`
            + `<span class="summary">${esc(summaryText)}</span>`
            + tokensHtml;

        // Expand/collapse
        const expanded = document.createElement('div');
        expanded.className = 'event-expanded';
        expanded.textContent = evt.content || '(no content)';

        row.addEventListener('click', () => {
            const showing = expanded.style.display === 'block';
            expanded.style.display = showing ? 'none' : 'block';
        });

        log.appendChild(row);
        log.appendChild(expanded);
    });

    if (wasAtBottom) {
        log.scrollTop = log.scrollHeight;
    }

    document.getElementById('event-count').textContent = `${s.events.length} events`;
    renderInventory(s);
}

function buildSummaryText(evt) {
    switch (evt.type) {
        case 'spawn': return `spawns → ${evt.summary}`;
        case 'think': return `thinks: ${evt.summary}`;
        case 'bash': return `$ ${evt.summary}`;
        case 'file_create': return `creates ${evt.short_path || evt.file_path}`;
        case 'file_update': return `edits ${evt.short_path || evt.file_path}`;
        case 'file_read': return `reads ${evt.short_path || evt.file_path}`;
        case 'web_search': return `searches: ${evt.summary}`;
        case 'user': return `» ${evt.summary}`;
        case 'error': return `ERROR ${evt.summary}`;
        case 'tool_call': return `${evt.tool_name} ${evt.summary}`;
        case 'tool_result': return `← ${evt.summary}`;
        default: return evt.summary;
    }
}

function renderAgents(s) {
    const panel = document.getElementById('agents-panel');
    panel.innerHTML = Object.values(s.agents).map(a => {
        const total = a.input_tokens + a.output_tokens;
        const tokStr = total > 0 ? fmtTokens(total) : '—';
        const prefix = a.is_subagent ? '┗ ' : '■ ';
        return `<div class="agent-entry">
            <span class="status-dot" style="background:var(--${a.color})"></span>
            <span class="agent-name agent-color-${a.color}">${prefix}${esc(a.name)}</span>
            <span class="agent-tokens">${tokStr}</span>
        </div>`;
    }).join('');
}

function renderInventory(s) {
    const panel = document.getElementById('inventory-panel');
    const entries = Object.entries(state.inventory);
    if (!entries.length) {
        panel.innerHTML = '<div class="dim" style="padding:4px 0">No files yet</div>';
        return;
    }
    panel.innerHTML = entries.map(([path, tag]) =>
        `<div class="inv-entry">
            <span class="inv-path">${esc(path)}</span>
            <span class="inv-tag inv-tag-${tag}">${tag}</span>
        </div>`
    ).join('');
}

// --- Filters ---

function initFilters() {
    const panel = document.getElementById('filters-panel');
    state.filters = {};
    const types = Object.keys(EVENT_LABELS);
    panel.innerHTML = types.map(t => {
        state.filters[t] = true;
        return `<div class="filter-entry">
            <input type="checkbox" id="filter-${t}" checked>
            <label for="filter-${t}">${ICONS[t] || '·'} ${EVENT_LABELS[t]}</label>
        </div>`;
    }).join('');

    types.forEach(t => {
        document.getElementById(`filter-${t}`).addEventListener('change', (e) => {
            state.filters[t] = e.target.checked;
            if (state.session) renderEvents(state.session);
        });
    });
}

function isEventVisible(type) {
    return state.filters[type] !== false;
}

// --- WebSocket for session live updates ---

function connectSessionWS(filePath) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/session/${encodeURIComponent(filePath)}`);
    state.ws = ws;

    const statusEl = document.getElementById('session-status');
    const liveEl = document.getElementById('live-indicator');
    const statusText = document.getElementById('status-text');

    ws.onopen = () => {
        statusEl.className = 'conn-status connected';
        statusEl.textContent = 'live';
        liveEl.className = 'live';
        liveEl.textContent = 'LIVE';
        statusText.textContent = 'Watching for changes…';
    };

    ws.onclose = () => {
        statusEl.className = 'conn-status';
        statusEl.textContent = 'disconnected';
        liveEl.className = '';
        liveEl.textContent = '';
        statusText.textContent = 'Connection closed';
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'full') {
            state.session = msg.data;
            initFilters();
            renderSession();
        } else if (msg.type === 'delta' && state.session) {
            // Append new events
            state.session.events.push(...msg.events);
            // Update agents
            state.session.agents = msg.agents;

            const log = document.getElementById('event-log');
            const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            state.autoScroll = atBottom;

            renderEvents(state.session);
            renderAgents(state.session);
            renderTokenInfo(state.session);

            if (!atBottom) {
                const count = msg.events.length;
                const badge = document.getElementById('new-events-badge');
                badge.textContent = `${count} new event${count > 1 ? 's' : ''}`;
                badge.style.display = 'inline';
                badge.onclick = () => {
                    log.scrollTop = log.scrollHeight;
                    badge.style.display = 'none';
                    state.autoScroll = true;
                };
            }
        }
    };
}

// --- Event log scroll tracking ---

document.addEventListener('DOMContentLoaded', () => {
    handleRoute();

    // Track auto-scroll state
    const observer = new MutationObserver(() => {
        const log = document.getElementById('event-log');
        if (log) {
            log.addEventListener('scroll', () => {
                state.autoScroll = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
                if (state.autoScroll) {
                    document.getElementById('new-events-badge').style.display = 'none';
                }
            }, { passive: true });
        }
    });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true });
});

// --- Helpers ---

function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

function formatTimeAgo(ts) {
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
