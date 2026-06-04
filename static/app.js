let allAnnotators = [];
let groups = [];
let currentGroup = null;

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }

async function fetchJSON(url) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    showAuth();
    throw new Error('Требуется авторизация');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function showError(msg) {
  const el = document.getElementById('errorAlert');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 6000);
}

function badgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('completed')) return 'badge-completed';
  if (s.includes('annotation')) return 'badge-annotation';
  if (s.includes('review') || s.includes('validation')) return 'badge-review';
  if (s.includes('rejected')) return 'badge-rejected';
  return 'badge-default';
}

function displayName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username;
}

function initials(u) {
  const name = displayName(u);
  const parts = name.split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/* ── Auth ── */
function showAuth() {
  document.getElementById('authOverlay').classList.add('open');
  document.getElementById('app').classList.add('hidden');
}

function hideAuth() {
  document.getElementById('authOverlay').classList.remove('open');
  document.getElementById('app').classList.remove('hidden');
}

async function login() {
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  const token = document.getElementById('tokenInput').value.trim();
  if (!token) { errEl.textContent = 'Введите токен'; errEl.style.display = 'block'; return; }
  btn.disabled = true;
  btn.textContent = 'Проверка...';
  errEl.style.display = 'none';
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error('Неверный токен');
    setToken(token);
    hideAuth();
    init();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
}

document.getElementById('tokenInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') login();
});

/* ── Theme ── */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  const isDark = document.documentElement.classList.contains('dark');
  icon.innerHTML = isDark
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/>';
  if (label) label.textContent = isDark ? 'Тёмная тема' : 'Светлая тема';
}

function applyTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.documentElement.classList.remove('dark');
  else document.documentElement.classList.add('dark');
  updateThemeIcon();
}

/* ── Tabs ── */
function renderTabs() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';

  const allTab = document.createElement('button');
  allTab.className = `tab ${currentGroup === null ? 'active' : ''}`;
  allTab.textContent = `Все (${allAnnotators.length})`;
  allTab.onclick = () => { currentGroup = null; renderTabs(); renderCards(); updateGroupStatsBar(); };
  container.appendChild(allTab);

  groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className = `tab ${currentGroup === g.name ? 'active' : ''}`;
    btn.textContent = `${g.name} (${g.count})`;
    btn.onclick = () => { currentGroup = g.name; renderTabs(); renderCards(); updateGroupStatsBar(); };
    container.appendChild(btn);
  });
}

function updateGroupStatsBar() {
  const bar = document.getElementById('groupStatsBar');
  bar.style.display = currentGroup ? 'block' : 'none';
}

/* ── Cards ── */
function renderCards() {
  const container = document.getElementById('annotatorsContainer');
  const filtered = currentGroup
    ? allAnnotators.filter(u => u.group === currentGroup)
    : allAnnotators;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет разметчиков</div>';
    return;
  }

  container.innerHTML = filtered.map(u => {
    const name = displayName(u);
    return `<div class="user-card">
      <div class="user-card-left">
        <div class="user-avatar">${initials(u)}</div>
        <div>
          <div class="user-name">${name}</div>
          <div class="user-username">@${u.username}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <span class="group-badge">${u.group || '—'}</span>
        <button class="btn btn-sm" onclick="openModal('${u.username}')">Статистика</button>
      </div>
    </div>`;
  }).join('');
}

/* ── Loaders ── */
async function loadAnnotatorList() {
  try {
    allAnnotators = await fetchJSON('/api/annotators');
    document.getElementById('annotatorCount').textContent = allAnnotators.length;
    renderTabs();
    renderCards();
    updateGroupStatsBar();
  } catch (e) {
    document.getElementById('annotatorsContainer').innerHTML =
      `<div class="empty-state" style="color:var(--red);">Ошибка: ${e.message}</div>`;
    showError(e.message);
  }
}

async function loadGroups() {
  try {
    groups = await fetchJSON('/api/groups');
  } catch (e) {
    console.error('Groups load error:', e);
  }
}

async function loadOverview() {
  try {
    const data = await fetchJSON('/api/overview');
    document.getElementById('totalProjects').textContent = data.total_projects;
    document.getElementById('totalTasks').textContent = data.total_tasks;
    document.getElementById('totalAnnotators').textContent = data.total_annotators;
  } catch (e) {
    console.error('Overview load error:', e);
  }
}

/* ── Modal helpers ── */
function renderStatsContent(data) {
  const statusHtml = data.jobs_by_status
    ? Object.entries(data.jobs_by_status).map(([s, c]) =>
        `<span class="badge ${badgeClass(s)}">${s}: ${c}</span>`
      ).join(' ')
    : '';

  const stageHtml = data.jobs_by_stage
    ? Object.entries(data.jobs_by_stage).map(([s, c]) =>
        `<span class="badge badge-default">${s}: ${c}</span>`
      ).join(' ')
    : '';

  const taskStatusHtml = data.tasks_by_status
    ? Object.entries(data.tasks_by_status).map(([s, c]) =>
        `<span class="badge ${badgeClass(s)}">${s}: ${c}</span>`
      ).join(' ')
    : '';

  return `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${data.total_projects ?? 0}</div>
        <div class="stat-label">Проекты</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${data.total_tasks ?? 0}</div>
        <div class="stat-label">Задачи</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${data.total_jobs}</div>
        <div class="stat-label">Задания</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${(data.total_frames ?? 0).toLocaleString()}</div>
        <div class="stat-label">Кадры</div>
      </div>
    </div>
    <div style="margin-top:16px;">
      <div style="font-size:12px;font-weight:500;color:var(--text-dim);margin-bottom:6px;">Задания по статусу:</div>
      <div class="status-list">${statusHtml || '<span class="badge badge-default">нет данных</span>'}</div>
    </div>
    <div style="margin-top:12px;">
      <div style="font-size:12px;font-weight:500;color:var(--text-dim);margin-bottom:6px;">Задания по этапу:</div>
      <div class="status-list">${stageHtml || '<span class="badge badge-default">нет данных</span>'}</div>
    </div>
    <div style="margin-top:12px;">
      <div style="font-size:12px;font-weight:500;color:var(--text-dim);margin-bottom:6px;">Задачи по статусу:</div>
      <div class="status-list">${taskStatusHtml || '<span class="badge badge-default">нет данных</span>'}</div>
    </div>
  `;
}

function showModalSkeleton() {
  return `
    <div class="stats-grid">
      ${Array(4).fill('<div class="stat-item"><div class="skeleton skeleton-lg" style="margin:0 auto 4px;"></div><div class="skeleton skeleton-sm" style="margin:0 auto;"></div></div>').join('')}
    </div>
    <div style="margin-top:16px;">
      <div class="skeleton skeleton-sm" style="margin-bottom:8px;"></div>
      <div style="display:flex;gap:6px;">
        ${Array(3).fill('<div class="skeleton skeleton-badge"></div>').join('')}
      </div>
    </div>
    <div style="margin-top:12px;">
      <div class="skeleton skeleton-sm" style="margin-bottom:8px;"></div>
      <div style="display:flex;gap:6px;">
        ${Array(3).fill('<div class="skeleton skeleton-badge"></div>').join('')}
      </div>
    </div>
    <div style="margin-top:12px;">
      <div class="skeleton skeleton-sm" style="margin-bottom:8px;"></div>
      <div style="display:flex;gap:6px;">
        ${Array(3).fill('<div class="skeleton skeleton-badge"></div>').join('')}
      </div>
    </div>
  `;
}

/* ── User modal ── */
function openModal(username) {
  const modal = document.getElementById('statsModal');
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const user = allAnnotators.find(u => u.username === username);
  title.textContent = `Статистика — @${username}`;
  content.innerHTML = showModalSkeleton();

  fetchJSON(`/api/annotators/${encodeURIComponent(username)}/stats`)
    .then(data => { content.innerHTML = renderStatsContent(data); })
    .catch(e => {
      content.innerHTML = `<div style="padding:12px 16px;border-radius:var(--radius);border:1px solid var(--red);background:var(--red-bg);color:var(--red);font-size:13px;">Ошибка: ${e.message}</div>`;
    });
}

/* ── Group modal ── */
function openGroupStats() {
  if (!currentGroup) return;
  const modal = document.getElementById('statsModal');
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  title.textContent = `Статистика — ${currentGroup}`;
  content.innerHTML = showModalSkeleton();

  fetchJSON(`/api/groups/${encodeURIComponent(currentGroup)}/stats`)
    .then(data => { content.innerHTML = renderStatsContent(data); })
    .catch(e => {
      content.innerHTML = `<div style="padding:12px 16px;border-radius:var(--radius);border:1px solid var(--red);background:var(--red-bg);color:var(--red);font-size:13px;">Ошибка: ${e.message}</div>`;
    });
}

function closeModal() {
  document.getElementById('statsModal').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── View switching ── */
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${name}`);
  });
  if (name === 'events') loadEvents();
}

/* ── Events feed ── */
async function loadEvents() {
  const list = document.getElementById('events-list');
  const empty = document.getElementById('events-empty');
  list.innerHTML = Array(5).fill('<div class="skeleton skeleton-event"></div>').join('');
  empty.style.display = 'none';
  try {
    const events = await fetchJSON('/api/events');
    if (!events.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    list.innerHTML = events.map(e => {
      const isProject = e.type === 'project';
      const date = e.created_date
        ? new Date(e.created_date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
      const projectIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      const taskIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
      return `<div class="event-item">
        <div class="event-icon ${isProject ? 'project' : 'task'}">${isProject ? projectIcon : taskIcon}</div>
        <div class="event-body">
          <div class="event-name">${esc(e.name)}</div>
          <div class="event-meta">
            <span class="badge ${isProject ? 'badge-project' : 'badge-task'}">${isProject ? 'Проект' : 'Задача'}</span>
            <span style="display:inline-flex;align-items:center;gap:3px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/></svg> ${esc(e.owner || '—')}</span>
            ${e.assignee ? `<span style="display:inline-flex;align-items:center;gap:3px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/></svg> ${esc(e.assignee)}</span>` : ''}
            <span class="badge ${badgeClass(e.status)}">${esc(e.status)}</span>
            <span>${date}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="color:var(--red);padding:24px;">Ошибка: ${esc(e.message)}</div>`;
  }
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.getElementById('statsModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

function showSkeletons() {
  const container = document.getElementById('annotatorsContainer');
  container.innerHTML = Array(9).fill(`
    <div class="user-card" style="pointer-events:none;">
      <div class="user-card-left">
        <div class="skeleton skeleton-avatar"></div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:60px;height:10px;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <div class="skeleton skeleton-badge"></div>
        <div class="skeleton skeleton-badge" style="width:70px;"></div>
      </div>
    </div>
  `).join('');
}

async function init() {
  applyTheme();
  showSkeletons();
  await Promise.all([loadGroups(), loadOverview()]);
  await loadAnnotatorList();
}

/* ── Bootstrap ── */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  if (getToken()) {
    hideAuth();
    init();
  } else {
    showAuth();
  }
});
