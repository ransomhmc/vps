const HOSTS = ['ipcam-74', 'ipcam-75', 'ipcam-76', 'ipcam-77', 'ipcam-78', 'ipcam-79', 'ipcam-80', 'ipcam-81'];

function toTaipei(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

async function api(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('show');
}

function hideError() {
  document.getElementById('errorMsg').classList.remove('show');
}

function renderUptimeBar(host, records) {
  const card = document.getElementById(`uptime-${host}`);
  if (!card) return;

  const sorted = records
    .filter(r => r.hostname === host)
    .sort((a, b) => new Date(a.checked_at || a.created_at) - new Date(b.checked_at || b.created_at));

  const segs = sorted.map(r => ({
    t: r.checked_at || r.created_at,
    ok: r.response_time_ms !== -1,
    ms: r.response_time_ms,
  }));

  const okCount = segs.filter(s => s.ok).length;
  const failCount = segs.filter(s => !s.ok).length;
  const avgMs = okCount > 0
    ? Math.round(segs.filter(s => s.ok).reduce((a, s) => a + s.ms, 0) / okCount)
    : null;
  const uptime = segs.length > 0 ? (okCount / segs.length * 100).toFixed(1) : null;
  const latest = segs.length > 0 ? segs[segs.length - 1] : null;

  // Status badge
  const badge = card.querySelector('.badge');
  if (!latest) {
    badge.innerHTML = 'no data';
    badge.className = 'badge badge-err';
  } else if (!latest.ok) {
    badge.innerHTML = 'DOWN';
    badge.className = 'badge badge-err';
  } else if (latest.ms < 100) {
    badge.innerHTML = `${latest.ms}ms`;
    badge.className = 'badge badge-ok';
  } else if (latest.ms < 500) {
    badge.innerHTML = `${latest.ms}ms`;
    badge.className = 'badge badge-warn';
  } else {
    badge.innerHTML = `${latest.ms}ms`;
    badge.className = 'badge badge-err';
  }

  // Stats
  card.querySelector('.stat-avg').textContent = avgMs !== null ? `${avgMs}ms` : '-';
  card.querySelector('.stat-uptime').textContent = uptime !== null ? `${uptime}%` : '-';
  card.querySelector('.stat-fail').textContent = `${failCount}x`;

  // Render bar segments
  const bar = card.querySelector('.uptime-bar');
  if (segs.length === 0) {
    bar.innerHTML = '<div class="seg-empty">no data</div>';
    return;
  }

  // Sample if too many segments (>600)
  let renderSegs = segs;
  if (segs.length > 600) {
    const step = Math.ceil(segs.length / 600);
    renderSegs = segs.filter((_, i) => i % step === 0);
  }

  const tipEl = document.getElementById('segTip');
  bar.innerHTML = renderSegs.map((s, i) => {
    const label = toTaipei(s.t);
    const ms = s.ok ? `${s.ms}ms` : 'unreachable';
    return `<div class="seg ${s.ok ? 'seg-ok' : 'seg-fail'}" data-idx="${i}" data-time="${label}" data-ms="${ms}"></div>`;
  }).join('');

  function showTip(seg, cx, cy) {
    if (!seg) { tipEl.classList.remove('show'); return; }
    tipEl.textContent = `${seg.dataset.time} — ${seg.dataset.ms}`;
    tipEl.style.left = (cx + 12) + 'px';
    tipEl.style.top = (cy - 10) + 'px';
    tipEl.classList.add('show');
  }

  bar.addEventListener('mouseenter', () => tipEl.classList.add('show'));
  bar.addEventListener('mouseleave', () => tipEl.classList.remove('show'));
  bar.addEventListener('mousemove', e => {
    showTip(e.target.closest('.seg'), e.clientX, e.clientY);
  });
  bar.addEventListener('click', e => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    const shown = tipEl.classList.contains('show');
    if (shown && tipEl.textContent.includes(seg.dataset.time)) {
      tipEl.classList.remove('show');
    } else {
      showTip(seg, e.clientX || e.changedTouches?.[0]?.clientX || 0, e.clientY || e.changedTouches?.[0]?.clientY || 0);
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.host-card')) tipEl.classList.remove('show');
  }, true);
}

function renderUptime(allRecords) {
  const grid = document.getElementById('uptimeGrid');
  grid.innerHTML = HOSTS.map(host => `
    <div class="host-card" id="uptime-${host}">
      <div class="host-head">
        <strong>${host}</strong>
        <span class="badge"></span>
      </div>
      <div class="uptime-bar"></div>
      <div class="host-stats">
        <span>avg <b class="stat-avg">-</b></span>
        <span>uptime <b class="stat-uptime">-</b></span>
        <span>fail <b class="stat-fail">-</b></span>
        <span>speed <b class="stat-speed">-</b></span>
      </div>
    </div>
  `).join('');

  const byHost = {};
  for (const r of allRecords) {
    if (!byHost[r.hostname]) byHost[r.hostname] = [];
    byHost[r.hostname].push(r);
  }

  for (const host of HOSTS) {
    renderUptimeBar(host, byHost[host] || []);
  }
}

const SPEED_COLORS = {
  'ipcam-74': '#f97316', 'ipcam-75': '#22c55e', 'ipcam-76': '#3b82f6',
  'ipcam-77': '#a855f7', 'ipcam-78': '#ec4899', 'ipcam-79': '#14b8a6',
  'ipcam-80': '#eab308', 'ipcam-81': '#6366f1',
};
const speedCharts = {};

function renderSpeed(records) {
  // Per host, keep latest valid record per day (records arrive DESC)
  const daily = {}; // daily[host][date] = { value, time }
  for (const r of records) {
    if (!r.download_mbps || r.download_mbps <= 0) continue;
    const ts = r.tested_at || r.created_at || '';
    const d = ts.slice(0, 10);
    if (!daily[r.hostname]) daily[r.hostname] = {};
    if (!daily[r.hostname][d]) {
      daily[r.hostname][d] = { value: r.download_mbps, time: ts };
    }
  }
  const allDates = [...new Set(records.map(r => (r.tested_at || r.created_at || '').slice(0, 10)))].sort();

  // Speed stats in uptime cards (avg of last 5 daily values)
  for (const host of HOSTS) {
    const dates = Object.keys(daily[host] || {}).sort();
    const vals = dates.slice(-5).map(d => daily[host][d].value);
    const avg = vals.length > 0 ? (vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(2) : '-';
    const el = document.querySelector(`#uptime-${host} .stat-speed`);
    if (el) el.textContent = avg !== '-' ? `${avg} MiB/s` : '-';
  }

  // Speed grid: one bar chart per host
  const grid = document.getElementById('speedGrid');
  grid.innerHTML = HOSTS.map(host => `
    <div class="speed-card">
      <h3>${host} <span id="speedBadge-${host}"></span></h3>
      <div class="chart-wrap"><canvas id="speedChart-${host}"></canvas></div>
    </div>
  `).join('');

  for (const host of HOSTS) {
    if (speedCharts[host]) speedCharts[host].destroy();

    const hostDaily = daily[host] || {};
    const data = allDates.map(d => hostDaily[d] ? { x: d, y: hostDaily[d].value, t: hostDaily[d].time } : { x: d, y: null, t: '' });

    const lastVal = data.filter(p => p.y !== null).pop();
    const badge = document.getElementById(`speedBadge-${host}`);
    if (lastVal) {
      badge.innerHTML = `<span class="badge badge-ok">${lastVal.y.toFixed(1)} MiB/s</span>`;
    }

    const ctx = document.getElementById(`speedChart-${host}`).getContext('2d');
    speedCharts[host] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: allDates,
        datasets: [{
          data: data.map(p => p.y),
          backgroundColor: data.map(p => p.y !== null ? SPEED_COLORS[host] : 'transparent'),
          borderRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => {
                const p = data.find(d => d.x === items[0].label);
                return p && p.t ? toTaipei(p.t) : items[0].label;
              },
              label: ctx => `${ctx.parsed.y.toFixed(2)} MiB/s`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 4 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#8b949e', font: { size: 9 } },
            grid: { color: '#21262d' },
          },
        },
      },
    });
  }
}

function renderLogins(records) {
  const filtered = records
    .filter(r => r.source_ip && !r.source_ip.startsWith('100.'))
    .slice(0, 5);

  const tbody = document.getElementById('loginBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="login-none">No logins from non-internal IPs</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    return `<tr><td>${toTaipei(r.login_time || r.created_at)}</td><td>${r.hostname || '-'}</td><td>${r.username || '-'}</td><td>${r.source_ip || '-'}</td></tr>`;
  }).join('');
}

async function load() {
  hideError();
  document.body.classList.add('refreshing');

  const now = new Date();
  document.getElementById('lastUpdate').textContent = `Last updated: ${now.toLocaleString()}`;

  const sinceMonitor = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sinceSpeed = new Date(now - 7 * 86400000).toISOString();

  try {
    const [monitorData, speedData, loginData] = await Promise.all([
      api(`/api/list?collection=host_monitor&limit=5000&since=${sinceMonitor}`),
      api(`/api/list?collection=speed_test&limit=200&since=${sinceSpeed}`),
      api(`/api/list?collection=login_record&limit=50`),
    ]);

    renderUptime(monitorData.records || []);
    renderSpeed(speedData.records || []);
    renderLogins(loginData.records || []);
  } catch (e) {
    showError(`Failed to load data: ${e.message}`);
  } finally {
    document.body.classList.remove('refreshing');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  setInterval(load, 300000);
});
