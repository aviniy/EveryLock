const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ko-KR');
let selectedPolicy = 'A';
let charts = {};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: { legend: { labels: { color: '#91a5b4', font: { family: 'monospace', size: 10 } } } },
  scales: {
    x: { ticks: { color: '#718391', maxTicksLimit: 6 }, grid: { color: '#18242d' } },
    y: { beginAtZero: true, ticks: { color: '#718391' }, grid: { color: '#18242d' } }
  }
};

function initCharts() {
  charts.lock = new Chart($('lockChart'), { type: 'line', data: { labels: [], datasets: [
    { label: 'Policy A', data: [], borderColor: '#ff5470', backgroundColor: '#ff547022', fill: true, tension: .25, pointRadius: 0 },
    { label: 'Policy B', data: [], borderColor: '#42d8ff', tension: .25, pointRadius: 0 }
  ]}, options: chartDefaults });
  charts.ratio = new Chart($('ratioChart'), { type: 'doughnut', data: { labels: ['정상', '잠금'], datasets: [{ data: [1000, 0], backgroundColor: ['#48f0a4', '#ff5470'], borderColor: '#0c1219' }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: chartDefaults.plugins } });
  charts.events = new Chart($('eventChart'), { type: 'line', data: { labels: [], datasets: [{ label: '누적 실패 이벤트', data: [], borderColor: '#ffc857', backgroundColor: '#ffc85722', fill: true, pointRadius: 0 }] }, options: chartDefaults });
}

function config() {
  return { user_count: +$('userCount').value, failure_events: +$('failureEvents').value, lock_threshold: +$('threshold').value, events_per_second: +$('speed').value, seed: +$('seed').value };
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) { const problem = await response.json().catch(() => ({})); throw new Error(problem.detail || '요청 처리 실패'); }
  return response.json();
}

function metric(data) { return selectedPolicy === 'A' ? data.policy_a : data.policy_b; }

function render(data) {
  const m = metric(data);
  $('totalValue').textContent = nf.format(m.total_accounts);
  $('activeValue').textContent = nf.format(m.active_accounts);
  $('lockedValue').textContent = nf.format(m.locked_accounts);
  $('availabilityValue').textContent = `${m.availability_rate.toFixed(2)}%`;
  $('progressBar').style.width = `${data.progress}%`;
  $('progressText').textContent = `${nf.format(data.event_count)} / ${nf.format(data.config.failure_events)} 이벤트 (${data.progress.toFixed(2)}%)`;
  const labels = { idle: '대기', running: '실행 중', paused: '일시정지', completed: '완료' };
  $('stateLabel').textContent = labels[data.state];
  $('statusDot').style.background = data.state === 'running' ? '#48f0a4' : data.state === 'completed' ? '#42d8ff' : '#718391';
  renderAccounts(data.accounts[selectedPolicy], data.accounts.display_limited);
  renderLogs(data.recent_logs);
  renderCharts(data, m);
  $('aLocked').textContent = nf.format(data.policy_a.locked_accounts);
  $('bLocked').textContent = nf.format(data.policy_b.locked_accounts);
  $('aDenied').textContent = nf.format(data.policy_a.denied_events);
  $('bDenied').textContent = nf.format(data.policy_b.denied_events);
  $('aAvailable').textContent = `${data.policy_a.availability_rate.toFixed(2)}%`;
  $('bAvailable').textContent = `${data.policy_b.availability_rate.toFixed(2)}%`;
  $('bDelayed').textContent = nf.format(data.policy_b.delayed_events);
  $('bVerify').textContent = nf.format(data.policy_b.verification_events);
  $('ratioPolicy').textContent = `POLICY ${selectedPolicy}`;
}

function renderAccounts(accounts, limited) {
  $('accountHint').textContent = limited ? '표시 성능을 위해 500개 샘플' : `${nf.format(accounts.length)}개 전체 표시`;
  $('accountGrid').innerHTML = accounts.map(a => {
    const cls = a.account_status === 'LOCKED' ? 'locked' : a.verification_required ? 'verify' : '';
    return `<span class="account ${cls}" title="${a.user_id} · 실패 ${a.failed_attempts}회 · ${a.account_status}"></span>`;
  }).join('');
}

function renderLogs(logs) {
  $('eventLog').innerHTML = logs.slice().reverse().map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString('ko-KR', { hour12: false });
    return `<p class="${e.event_type.toLowerCase()}"><b>[${e.event_type}]</b> ${time} · ${e.virtual_user_id} · P${e.policy} · ${e.result}</p>`;
  }).join('') || '<p>시뮬레이션 이벤트를 기다리는 중...</p>';
}

function renderCharts(data, m) {
  const history = data.history;
  const labels = history.map(p => nf.format(p.event_count));
  charts.lock.data.labels = labels;
  charts.lock.data.datasets[0].data = history.map(p => p.locked_a);
  charts.lock.data.datasets[1].data = history.map(p => p.locked_b);
  charts.lock.update('none');
  charts.ratio.data.datasets[0].data = [m.active_accounts, m.locked_accounts];
  charts.ratio.update('none');
  charts.events.data.labels = labels;
  charts.events.data.datasets[0].data = history.map(p => p.event_count);
  charts.events.update('none');
}

async function refresh() { try { render(await api('/api/status')); } catch (e) { console.error(e); } }

$('startBtn').addEventListener('click', async () => { try { render(await api('/api/start', { method: 'POST', body: JSON.stringify(config()) })); } catch (e) { alert(e.message); } });
$('pauseBtn').addEventListener('click', async () => render(await api('/api/pause', { method: 'POST' })));
$('resetBtn').addEventListener('click', async () => { try { render(await api('/api/reset', { method: 'POST', body: JSON.stringify(config()) })); } catch (e) { alert(e.message); } });
$('stepBtn').addEventListener('click', async () => render(await api('/api/step?amount=1', { method: 'POST' })));
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active'); selectedPolicy = tab.dataset.policy; refresh();
}));

initCharts();
refresh();
setInterval(refresh, 500);
