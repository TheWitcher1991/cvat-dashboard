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

const __cache = {};

function cachedFetch(url, ttlMs = 300000) {
  const now = Date.now();
  if (__cache[url] && now - __cache[url].ts < ttlMs) {
    return Promise.resolve(__cache[url].data);
  }
  try {
    const stored = sessionStorage.getItem('cache:' + url);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (now - parsed.ts < ttlMs) {
        __cache[url] = parsed;
        return Promise.resolve(parsed.data);
      }
    }
  } catch (_) {}
  return fetchJSON(url).then(data => {
    const entry = { data, ts: Date.now() };
    __cache[url] = entry;
    try {
      sessionStorage.setItem('cache:' + url, JSON.stringify(entry));
    } catch (_) {}
    return data;
  });
}

function clearCache() {
  Object.keys(__cache).forEach(k => delete __cache[k]);
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith('cache:')) keys.push(key);
  }
  keys.forEach(k => sessionStorage.removeItem(k));
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

async function loadAnnotatorList() {
  try {
    allAnnotators = await cachedFetch('/api/annotators', 300000);
    document.getElementById('annotatorCount').textContent = allAnnotators.length;
    updateCounters('users', allAnnotators.length);
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
    groups = await cachedFetch('/api/groups', 600000);
  } catch (e) {
    console.error('Groups load error:', e);
  }
}

async function loadOverview() {
  try {
    const data = await cachedFetch('/api/overview', 300000);
    document.getElementById('totalProjects').textContent = data.total_projects;
    document.getElementById('totalTasks').textContent = data.total_tasks;
    document.getElementById('totalAnnotators').textContent = data.total_annotators;
  } catch (e) {
    console.error('Overview load error:', e);
  }
}

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

async function openModal(username) {
  const modal = document.getElementById('statsModal');
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const user = allAnnotators.find(u => u.username === username);
  title.textContent = `Статистика — @${username}`;
  content.innerHTML = showModalSkeleton();

  try {
    const data = await cachedFetch(`/api/annotators/${encodeURIComponent(username)}/stats`, 300000);
    content.innerHTML = renderStatsContent(data);
  } catch (e) {
    content.innerHTML = `<div style="padding:12px 16px;border-radius:var(--radius);border:1px solid var(--red);background:var(--red-bg);color:var(--red);font-size:13px;">Ошибка: ${e.message}</div>`;
  }
}

async function openGroupStats() {
  if (!currentGroup) return;
  const modal = document.getElementById('statsModal');
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  title.textContent = `Статистика — ${currentGroup}`;
  content.innerHTML = showModalSkeleton();

  try {
    const data = await cachedFetch(`/api/groups/${encodeURIComponent(currentGroup)}/stats`, 300000);
    content.innerHTML = renderStatsContent(data);
  } catch (e) {
    content.innerHTML = `<div style="padding:12px 16px;border-radius:var(--radius);border:1px solid var(--red);background:var(--red-bg);color:var(--red);font-size:13px;">Ошибка: ${e.message}</div>`;
  }
}

function closeModal() {
  document.getElementById('statsModal').classList.remove('open');
  document.body.style.overflow = '';
}

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${name}`);
  });
  if (name === 'dashboard') { loadActivityCalendar(); }
  else if (name === 'users') loadUsers();
  else if (name === 'events') loadEvents();
  else if (name === 'tasks') loadTasksView();
}

async function loadEvents() {
  const list = document.getElementById('events-list');
  const empty = document.getElementById('events-empty');
  list.innerHTML = Array(5).fill('<div class="skeleton skeleton-event"></div>').join('');
  empty.style.display = 'none';
  try {
    const events = await cachedFetch('/api/events', 120000);
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
    updateCounters('events', events.length);
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

async function loadActivityCalendar() {
  const el = document.getElementById('calendarContainer');
  if (!el) return;

  const f = document.getElementById('calDateFrom');
  const t = document.getElementById('calDateTo');
  const p = new URLSearchParams();
  if (f && f.value) p.set('date_from', f.value);
  if (t && t.value) p.set('date_to', t.value);
  const qs = p.toString();

  el.innerHTML = '<div class="skeleton" style="height:100px;border-radius:6px;"></div>';
  try {
    const url = '/api/activity' + (qs ? '?' + qs : '');
    const data = await cachedFetch(url, 300000);
    const days = data.days || [];
    if (!days.length) { el.innerHTML = '<div class="empty-state">Нет данных</div>'; return; }

    const dayMap = {};
    let maxCount = 0;
    for (const d of days) { dayMap[d.date] = d.count; if (d.count > maxCount) maxCount = d.count; }

    const dates = Object.keys(dayMap).sort();
    if (!dates.length) { el.innerHTML = '<div class="empty-state">Нет данных</div>'; return; }

    const padL = 30, padR = 12, padTop = 24, padBot = 24;
    const dayLabelW = 26;
    const availW = el.clientWidth || 600;

    const cell = Math.min(16, Math.max(10, Math.floor((availW - dayLabelW - padL - padR) / 53 - 2)));
    const gap = 2;

    const start = new Date(dates[0]);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(dates[dates.length - 1]);

    const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

    const weeks = [];
    let cur = new Date(start);
    while (cur <= end) {
      const w = [];
      for (let i = 0; i < 7; i++) {
        const ds = cur.toISOString().slice(0, 10);
        const count = dayMap[ds] || 0;
        const level = maxCount > 0 ? Math.ceil((count / maxCount) * 4) : 0;
        w.push({ date: ds, count, level });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(w);
    }

    const cols = weeks.length;
    const svgW = padL + padR + cols * (cell + gap);
    const svgH = padTop + padBot + 7 * (cell + gap) + 18;

    const colors = ['var(--bg-muted)', '#0e4429', '#1a6e3a', '#27a34a', '#3dd168'];

    const monthLabels = [];
    for (let c = 0; c < cols; c++) {
      const d = weeks[c][3];
      if (!d) continue;
      const m = new Date(d.date).getMonth();
      if (m !== (monthLabels.length ? monthLabels[monthLabels.length-1].m : -1)) {
        monthLabels.push({ m, c });
      }
    }
    let monthsHtml = '';
    for (let i = 0; i < monthLabels.length; i++) {
      const startC = monthLabels[i].c;
      const endC = i + 1 < monthLabels.length ? monthLabels[i+1].c : cols;
      const midX = padL + (startC + endC) / 2 * (cell + gap) - gap / 2;
      monthsHtml += `<text x="${midX}" y="14" text-anchor="middle" font-size="10" fill="var(--text-dim)" font-weight="500">${MONTHS[monthLabels[i].m]}</text>`;
    }

    let dayLabelsHtml = '';
    for (let r = 1; r < 7; r += 2) {
      const y = padTop + r * (cell + gap) + cell / 2 + 1;
      dayLabelsHtml += `<text x="${padL - 5}" y="${y}" text-anchor="end" font-size="9" fill="var(--text-dim)">${DAYS_SHORT[r]}</text>`;
    }

    let cells = '';
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < cols; c++) {
        const d = weeks[c][r];
        if (!d) continue;
        const x = padL + c * (cell + gap);
        const y = padTop + r * (cell + gap);
        cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${colors[d.level]}"><title>${d.date}: ${d.count} задач</title></rect>`;
      }
    }

    let legend = '';
    for (let i = 0; i < 5; i++) {
      const lx = svgW - padR - (5 - i) * (cell + gap + 16) + 4;
      legend += `<rect x="${lx}" y="${svgH - padBot + 4}" width="${cell}" height="${cell}" rx="2" fill="${colors[i]}"/>`;
    }
    legend += `<text x="${svgW - padR - 5 * (cell + gap + 16) + 14}" y="${svgH - padBot + cell + 3}" font-size="9" fill="var(--text-dim)">Меньше</text>`;
    legend += `<text x="${svgW - padR - 6}" y="${svgH - padBot + cell + 3}" text-anchor="end" font-size="9" fill="var(--text-dim)">Больше</text>`;

    el.innerHTML = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="max-width:100%;height:auto;">${monthsHtml}${dayLabelsHtml}${cells}${legend}</svg>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="color:var(--red);">Ошибка: ${esc(e.message)}</div>`;
  }
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

async function loadUsers() {
  showSkeletons();
  await Promise.all([loadGroups(), loadOverview()]);
  await loadAnnotatorList();
}

async function loadTasksView(dateFrom, dateTo) {
  const el = document.getElementById('tasks-container');
  if (!el) return;

  const f = document.getElementById('tasksDateFrom');
  const t = document.getElementById('tasksDateTo');
  if (!dateFrom) dateFrom = f.value;
  if (!dateTo) dateTo = t.value;

  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  const qs = params.toString();

  el.innerHTML = '<div class="skeleton" style="height:200px;border-radius:8px;"></div>';
  try {
    const groupsList = await cachedFetch('/api/groups', 600000);
    const rows = await Promise.all(groupsList.map(async g => {
      try {
        const url = `/api/groups/${encodeURIComponent(g.name)}/stats` + (qs ? '?' + qs : '');
        const stats = await cachedFetch(url, 300000);
        const completed = stats.jobs_by_status?.completed ?? 0;
        const total = stats.total_jobs ?? 0;
        const pct = total > 0 ? Math.round(completed / total * 100) : 0;
        return { name: g.name, ...stats, completed, pct };
      } catch {
        return { name: g.name, total_jobs: 0, total_tasks: 0, total_projects: 0, total_frames: 0, completed: 0, pct: 0 };
      }
    }));
    const _pi = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;opacity:.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    const _ti = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;opacity:.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    const _ji = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;opacity:.5"><path d="M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"/><path d="M12 12l3 -2"/><path d="M12 7v5"/></svg>';
    const _ci = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;opacity:.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
    el.innerHTML = `<table class="table-compact">
      <thead><tr>
        <th>Вуз</th>
        <th>Проекты</th>
        <th>Задачи</th>
        <th>Задания</th>
        <th>Выполнено</th>
        <th></th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><strong>${esc(r.name)}</strong></td>
        <td>${_pi}${r.total_projects ?? 0}</td>
        <td>${_ti}${r.total_tasks ?? 0}</td>
        <td>${_ji}${r.total_jobs ?? 0}</td>
        <td>${_ci}${r.completed}</td>
        <td style="min-width:140px;"><div class="progress-bar"><div class="progress-fill" style="width:${r.pct}%"></div><span class="progress-label">${r.pct}%</span></div></td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="color:var(--red);padding:12px;">Ошибка: ${esc(e.message)}</div>`;
  }
}

async function refresh() {
  clearCache();
  const active = document.querySelector('.view.active');
  if (!active) return;
  const name = active.id.replace('view-', '');
  if (name === 'dashboard') { await loadActivityCalendar(); }
  else if (name === 'users') await loadUsers();
  else if (name === 'events') await loadEvents();
  else if (name === 'tasks') await loadTasksView();
}

async function init() {
  applyTheme();
  initTaskDates();
  initUsersDates();
  initCalDates();
  checkHealth();
  setInterval(checkHealth, 30000);
  loadActivityCalendar();
}

function initTaskDates() {
  const f = document.getElementById('tasksDateFrom');
  const t = document.getElementById('tasksDateTo');
  if (!f || !t) return;
  if (!f.value) {
    const d = new Date();
    t.value = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 7);
    f.value = d.toISOString().slice(0, 10);
  }
  f.onchange = () => loadTasksView();
  t.onchange = () => loadTasksView();
}

function initUsersDates() {
  const f = document.getElementById('dateFrom');
  const t = document.getElementById('dateTo');
  if (!f || !t) return;
  if (!f.value) {
    const d = new Date();
    t.value = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 7);
    f.value = d.toISOString().slice(0, 10);
  }
}

function initCalDates() {
  const f = document.getElementById('calDateFrom');
  const t = document.getElementById('calDateTo');
  if (!f || !t) return;
  if (!f.value) {
    const d = new Date();
    t.value = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - 7);
    f.value = d.toISOString().slice(0, 10);
  }
  f.onchange = () => loadActivityCalendar();
  t.onchange = () => loadActivityCalendar();
}

async function checkHealth() {
  const dot = document.getElementById('healthDot');
  const label = document.getElementById('healthLabel');
  if (!dot || !label) return;
  dot.className = 'health-dot loading';
  label.textContent = 'CVAT...';
  try {
    const res = await cachedFetch('/api/health', 30000);
    dot.className = 'health-dot ok';
    label.textContent = 'CVAT OK';
  } catch {
    dot.className = 'health-dot err';
    label.textContent = 'CVAT Error';
  }
}

function updateCounters(name, count) {
  const el = document.getElementById(`${name}Counter`);
  if (el) {
    el.textContent = count > 0 ? count : '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  if (getToken()) {
    hideAuth();
    init();
  } else {
    showAuth();
  }
});
