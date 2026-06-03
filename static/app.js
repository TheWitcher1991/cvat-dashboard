let allAnnotators = [];
let groups = [];
let currentGroup = null;
let statsLoaded = false;

async function fetchJSON(url) {
  const res = await fetch(url);
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
  if (s.includes('annotation') || s.includes('annotation')) return 'badge-annotation';
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

function renderTabs() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';

  const allTab = document.createElement('button');
  allTab.className = `tab ${currentGroup === null ? 'active' : ''}`;
  allTab.textContent = `Все (${allAnnotators.length})`;
  allTab.onclick = () => { currentGroup = null; renderTabs(); renderTable(); };
  container.appendChild(allTab);

  groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className = `tab ${currentGroup === g.name ? 'active' : ''}`;
    btn.textContent = `${g.name} (${g.count})`;
    btn.onclick = () => { currentGroup = g.name; renderTabs(); renderTable(); };
    container.appendChild(btn);
  });
}

function renderTable() {
  const tbody = document.getElementById('annotatorsBody');
  const filtered = currentGroup
    ? allAnnotators.filter(u => u.group === currentGroup)
    : allAnnotators;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Нет разметчиков</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const name = displayName(u);
    return `<tr>
      <td>
        <div class="user-info">
          <div class="user-avatar">${initials(u)}</div>
          <div>
            <div class="user-name">${name}</div>
            <div class="user-username">@${u.username}</div>
          </div>
        </div>
      </td>
      <td><span class="badge badge-default">${u.group || '—'}</span></td>
      <td>${statsLoaded ? (u.total_projects ?? 0) : '—'}</td>
      <td>${statsLoaded ? (u.total_tasks ?? 0) : '—'}</td>
      <td>${statsLoaded ? (u.total_jobs ?? 0) : '—'}</td>
      <td>${statsLoaded ? (u.total_frames != null ? u.total_frames.toLocaleString() : 0) : '—'}</td>
      <td><button class="btn btn-sm" onclick="showUserStats('${u.username}')">Статистика</button></td>
    </tr>`;
  }).join('');
}

async function loadAnnotatorList() {
  try {
    allAnnotators = await fetchJSON('/api/annotators');
    document.getElementById('annotatorCount').textContent = allAnnotators.length;
    renderTabs();
    renderTable();
  } catch (e) {
    document.getElementById('annotatorsBody').innerHTML =
      `<tr><td colspan="5" style="text-align:center;color:var(--red);padding:32px;">Ошибка: ${e.message}</td></tr>`;
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
  const data = await fetchJSON('/api/overview');
  document.getElementById('totalProjects').textContent = data.total_projects;
  document.getElementById('totalTasks').textContent = data.total_tasks;
  document.getElementById('totalJobs').textContent = data.total_jobs;
  document.getElementById('totalAnnotators').textContent = data.total_annotators;
}

async function loadBatchStats() {
  allAnnotators = await fetchJSON('/api/annotators/batch-stats');
  document.getElementById('annotatorCount').textContent = allAnnotators.length;
  renderTabs();
  renderTable();
}

async function loadStats() {
  const btn = document.getElementById('getStatsBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Загрузка...';

  try {
    await Promise.all([loadOverview(), loadBatchStats()]);
    statsLoaded = true;
    btn.style.display = 'none';
    refreshBtn.style.display = '';
  } catch (e) {
    showError('Ошибка: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Получить статистику';
}

async function showUserStats(username) {
  const panel = document.getElementById('statsPanel');
  const title = document.getElementById('statsPanelTitle');
  const content = document.getElementById('statsContent');
  panel.classList.add('open');
  content.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);">Загрузка...</div>';

  const user = allAnnotators.find(u => u.username === username);
  title.textContent = `Статистика — @${username}`;

  try {
    const data = await fetchJSON(`/api/annotators/${encodeURIComponent(username)}/stats`);

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

    content.innerHTML = `
      <div class="card">
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
            <div class="stat-label">Jobs</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${data.total_frames.toLocaleString()}</div>
            <div class="stat-label">Frames</div>
          </div>
        </div>
        <div style="margin-top:16px;">
          <div style="font-size:12px;font-weight:500;color:var(--text-dim);margin-bottom:6px;">Jobs по статусу:</div>
          <div class="status-list">${statusHtml || '<span class="badge badge-default">нет данных</span>'}</div>
        </div>
        <div style="margin-top:12px;">
          <div style="font-size:12px;font-weight:500;color:var(--text-dim);margin-bottom:6px;">Jobs по этапу:</div>
          <div class="status-list">${stageHtml || '<span class="badge badge-default">нет данных</span>'}</div>
        </div>
        <div style="margin-top:12px;">
          <div style="font-size:12px;font-weight:500;color:var(--text-dim);margin-bottom:6px;">Задачи по статусу:</div>
          <div class="status-list">${taskStatusHtml || '<span class="badge badge-default">нет данных</span>'}</div>
        </div>
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div style="padding:12px 16px;border-radius:var(--radius);border:1px solid var(--red);background:var(--red-bg);color:var(--red);font-size:13px;">Ошибка: ${e.message}</div>`;
  }
}

function closeStats() {
  document.getElementById('statsPanel').classList.remove('open');
}

async function init() {
  await loadGroups();
  await loadAnnotatorList();
}

document.addEventListener('DOMContentLoaded', init);
