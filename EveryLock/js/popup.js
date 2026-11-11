import { getAllLockedAccounts, clearDB } from './database.js';
import { addLog, getLogs, clearLogs } from './logger.js';

// 입력값 자동 저장 및 복원 매커니즘
async function initPersistedInputs() {
  const persistElements = document.querySelectorAll('[data-persist="true"]');
  
  // 저장된 값 불러오기
  try {
    const storageData = await chrome.storage.local.get(null);
    persistElements.forEach(el => {
      if (storageData[el.id] !== undefined) {
        el.value = storageData[el.id];
      }
    });
  } catch (err) {
    console.error("입력값 복원 실패:", err);
  }

  // 값이 바뀔 때마다 자동 저장
  persistElements.forEach(el => {
    el.addEventListener('input', () => {
      chrome.storage.local.set({ [el.id]: el.value });
    });
  });
}

// 실시간 로그 렌더링 함수
async function renderLogs() {
  const logBox = document.getElementById('log');
  if (!logBox) return;

  const logs = await getLogs();
  logBox.innerHTML = "";

  if (logs.length === 0) {
    const item = document.createElement('div');
    item.className = "log-item log-info";
    item.textContent = "[--:--:--] 확장 프로그램이 대기 중입니다.";
    logBox.appendChild(item);
    return;
  }

  logs.forEach(l => {
    const item = document.createElement('div');
    item.className = `log-item log-${l.level}`;
    item.textContent = `[${l.time}] ${l.message}`;
    logBox.appendChild(item);
  });

  // 자동 스크롤 하단 고정
  logBox.scrollTop = logBox.scrollHeight;
}

async function refreshDbList(searchQuery = "") {
  const dbListEl = document.getElementById('dbList');
  if (!dbListEl) return;
  
  dbListEl.innerHTML = "";
  try {
    const records = await getAllLockedAccounts();
    const filteredRecords = records.filter(r => r.userId.includes(searchQuery));

    if (filteredRecords.length === 0) {
      dbListEl.innerText = records.length === 0 ? "저장된 데이터가 없습니다." : "검색 결과가 없습니다.";
      return;
    }

    filteredRecords.forEach(r => {
      const timeStr = r.timestamp.includes('T') ? r.timestamp.split('T')[1].slice(0, 8) : r.timestamp;
      const row = document.createElement('div');
      row.style.marginBottom = "3px";
      
      const timeSpan = document.createElement('span');
      timeSpan.textContent = `[${timeStr}] ID: `;
      
      const idBold = document.createElement('b');
      idBold.textContent = r.userId;
      
      const attemptsSpan = document.createElement('span');
      attemptsSpan.textContent = ` (시도: ${r.attempts}회)`;

      row.appendChild(timeSpan);
      row.appendChild(idBold);
      row.appendChild(attemptsSpan);
      dbListEl.appendChild(row);
    });
  } catch (err) {
    dbListEl.textContent = `[오류] ${err.message}`;
    await addLog(`DB 조회 오류: ${err.message}`, "error");
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initPersistedInputs();
  await renderLogs();
  await refreshDbList();

  // 탭 전환 이벤트
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = document.getElementById(btn.dataset.tab);
      if (targetTab) targetTab.classList.add('active');
    });
  });

  const searchInput = document.getElementById('dbSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      refreshDbList(e.target.value.trim());
    });
  }
});

// 실시간 로그 변경 감지 (chrome.storage.onChanged)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['everylock_logs']) {
    renderLogs();
  }
});

// 패턴 생성기
function generatePatternIds(pattern, countInput) {
  const count = isNaN(countInput) ? 10 : countInput;
  const safeCount = Math.min(Math.max(1, count), 1000);
  
  const wildcardCount = (pattern.match(/-/g) || []).length;
  const maxPossible = Math.pow(10, wildcardCount);

  if (safeCount > maxPossible && wildcardCount > 0) {
    addLog(`요청 개수(${safeCount})가 최대 조합 수(${maxPossible})보다 큽니다.`, "warn");
  }

  const results = new Set();
  let loop = 0;
  const targetLimit = Math.min(safeCount, maxPossible);

  while (results.size < targetLimit && loop < targetLimit * 100) {
    loop++;
    let generated = "";
    for (let i = 0; i < pattern.length; i++) {
      generated += (pattern[i] === '-') ? Math.floor(Math.random() * 10).toString() : pattern[i];
    }
    results.add(generated);
  }
  return Array.from(results);
}

document.getElementById('btnGeneratePattern').addEventListener('click', async () => {
  const pattern = document.getElementById('patternInput').value.trim();
  const rawCount = parseInt(document.getElementById('genCount').value, 10);
  const list = generatePatternIds(pattern, rawCount);
  document.getElementById('generatedArea').value = list.join("\n");
  await addLog(`패턴(${pattern}) 기준 ${list.length}개 학번 생성 완료.`, "success");
});

document.getElementById('btnApplyPattern').addEventListener('click', async () => {
  const text = document.getElementById('generatedArea').value;
  if (!text) {
    await addLog("생성된 리스트가 없어 적용할 수 없습니다.", "error");
    return;
  }
  document.getElementById('targetIdsArea').value = text;
  // 스토리지에도 강제 동기화
  chrome.storage.local.set({ 'targetIdsArea': text });

  const autoTabBtn = document.querySelector('.tab-btn[data-tab="tab-auto"]');
  if (autoTabBtn) autoTabBtn.click();
  await addLog("생성된 학번 리스트가 화력 제어 패널에 적용되었습니다.", "info");
});

document.getElementById('btnStart').addEventListener('click', async () => {
  const rawIds = document.getElementById('targetIdsArea').value.trim();
  const targetIds = rawIds.split('\n').map(id => id.trim()).filter(id => id.length > 0);
  const maxAttempts = Math.min(Math.max(1, parseInt(document.getElementById('maxAttempts').value, 10) || 15), 100);
  const concurrencyTabs = Math.min(Math.max(1, parseInt(document.getElementById('concurrencyTabs').value, 10) || 3), 10);
  
  const delayInput = parseInt(document.getElementById('requestDelay').value, 10);
  const requestDelay = Math.min(Math.max(0, isNaN(delayInput) ? 200 : delayInput), 5000);

  if (targetIds.length === 0) {
    await addLog("대상 학번 리스트가 비어있습니다.", "error");
    return;
  }

  await addLog(`[START] ${targetIds.length}개 학번 멀티탭 폭격 시작 (병렬 탭: ${concurrencyTabs}, 딜레이: ${requestDelay}ms)`, "success");

  chrome.runtime.sendMessage({
    action: "START_MULTITAB",
    targetIds,
    maxAttempts,
    concurrencyTabs,
    requestDelay
  }, (res) => {
    if (chrome.runtime.lastError) {
      addLog(`통신 오류: ${chrome.runtime.lastError.message}`, "error");
      return;
    }
    if (res && res.status === "ALREADY_RUNNING") {
      addLog("이미 공격 엔진이 실행 중입니다.", "warn");
    }
  });
});

document.getElementById('btnStop').addEventListener('click', async () => {
  await addLog("멀티탭 폭격 중단 요청 전송됨.", "warn");
  chrome.runtime.sendMessage({ action: "STOP_MULTITAB" });
});

// 백그라운드 메시지 수신
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "ACCOUNT_LOCKED") {
    await refreshDbList();
  }
});

document.getElementById('btnExportJson').addEventListener('click', async () => {
  try {
    const records = await getAllLockedAccounts();
    if (records.length === 0) {
      await addLog("내보낼 DB 기록이 없습니다.", "warn");
      return;
    }
    
    const jsonBlob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(jsonBlob);
    const dl = document.createElement('a');
    dl.href = url;
    dl.download = "locked.json";
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    
    await addLog(`${records.length}개 기록이 locked.json 파일로 내보내졌습니다.`, "success");
  } catch (err) {
    await addLog(`내보내기 오류: ${err.message}`, "error");
  }
});

document.getElementById('btnClearDb').addEventListener('click', async () => {
  try {
    await clearDB();
    await refreshDbList();
    await addLog("DB 전체 기록이 삭제되었습니다.", "warn");
  } catch (err) {
    await addLog(`DB 삭제 오류: ${err.message}`, "error");
  }
});