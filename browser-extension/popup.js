// ==========================================
// 1. IndexedDB 설정 (잠긴 계정 로컬 DB)
// ==========================================
const DB_NAME = "EveryLockDB";
const STORE_NAME = "locked_accounts";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addLockedAccount(userId, attemptsCount) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const entry = {
    userId: userId,
    timestamp: new Date().toISOString(),
    attempts: attemptsCount,
    status: "LOCKED"
  };
  store.add(entry);
  refreshDbList();
}

async function getAllLockedAccounts() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
  });
}

async function clearDB() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  refreshDbList();
  log("[DB] 모든 저장 기록이 삭제되었습니다.");
}

async function refreshDbList() {
  const records = await getAllLockedAccounts();
  const dbListEl = document.getElementById('dbList');
  if (records.length === 0) {
    dbListEl.innerText = "저장된 데이터가 없습니다.";
    return;
  }
  dbListEl.innerHTML = records.map(r => 
    `[${r.timestamp.split('T')[1].slice(0,8)}] ID: <b>${r.userId}</b> (시도: ${r.attempts}회)`
  ).join("<br>");
}

// ==========================================
// 2. 탭 전환 인터페이스
// ==========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ==========================================
// 3. 와일드카드(-) 패턴 생성 및 자동화 연동
// ==========================================
function generatePatternIds(pattern, count) {
  const results = new Set();
  const maxLoop = count * 100;
  let loop = 0;

  while (results.size < count && loop < maxLoop) {
    loop++;
    let generated = "";
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '-') {
        generated += Math.floor(Math.random() * 10).toString();
      } else {
        generated += pattern[i];
      }
    }
    results.add(generated);
  }
  return Array.from(results);
}

document.getElementById('btnGeneratePattern').addEventListener('click', () => {
  const pattern = document.getElementById('patternInput').value.trim();
  const count = parseInt(document.getElementById('genCount').value) || 5;

  if (!pattern) {
    log("[ERROR] 패턴을 입력해주세요.");
    return;
  }

  const generatedList = generatePatternIds(pattern, count);
  document.getElementById('generatedArea').value = generatedList.join("\n");
  log(`[GENERATOR] 패턴(${pattern}) 기준 ${generatedList.length}개 랜덤 생성 완료.`);
});

// 생성된 리스트를 자동화 제어 탭의 텍스트박스로 즉시 복사
document.getElementById('btnApplyPattern').addEventListener('click', () => {
  const generatedText = document.getElementById('generatedArea').value;
  if (!generatedText) {
    log("[ERROR] 생성된 학번 리스트가 없습니다.");
    return;
  }
  document.getElementById('targetIdsArea').value = generatedText;
  // 자동으로 첫 번째 탭(자동화 제어)으로 전환
  document.querySelector('.tab-btn[data-tab="tab-auto"]').click();
  log("[APPLY] 생성된 학번 리스트가 자동화 제어 패널에 적용되었습니다.");
});

// ==========================================
// 4. 자동화 제어 (실행, 일시정지, 재시작, 중단)
// ==========================================
document.getElementById('btnStart').addEventListener('click', () => sendControlCommand('START'));
document.getElementById('btnPause').addEventListener('click', () => sendControlCommand('PAUSE'));
document.getElementById('btnResume').addEventListener('click', () => sendControlCommand('RESUME'));
document.getElementById('btnStop').addEventListener('click', () => sendControlCommand('STOP'));

async function sendControlCommand(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    log('[ERROR] 활성화된 탭을 찾을 수 없습니다.');
    return;
  }

  let activeUrl;
  try {
    activeUrl = new URL(tab.url);
  } catch (_) {
    log('[SAFETY] 올바른 localhost 실습 탭이 아닙니다.');
    return;
  }
  if (activeUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(activeUrl.hostname)) {
    log('[SAFETY] EveryLock 확장은 127.0.0.1 또는 localhost에서만 실행됩니다.');
    return;
  }

  const rawIdsText = document.getElementById('targetIdsArea').value.trim();
  const targetIds = rawIdsText.split('\n').map(id => id.trim()).filter(id => id.length > 0);
  const maxAttempts = parseInt(document.getElementById('maxAttempts').value) || 10;
  const delayMs = parseInt(document.getElementById('delayMs').value) || 500;

  if (command === 'START' && targetIds.length === 0) {
    log('[ERROR] 대입할 대상 학번(Target IDs)이 없습니다. 패턴 생성기에서 리스트를 생성하거나 직접 입력하세요.');
    return;
  }
  if (command === 'START' && targetIds.some(id => !/^20(?:23|24|25|26)\d{6}$/.test(id))) {
    log('[ERROR] 합성 학번은 2023~2026 + 숫자 6자리 형식만 허용됩니다.');
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: handleInPageAutomation,
    args: [command, targetIds, maxAttempts, delayMs]
  }, (results) => {
    if (chrome.runtime.lastError) {
      log(`[ERROR] ${chrome.runtime.lastError.message}`);
    } else {
      log(`[CONTROL] 명령어(${command}) 전송 완료.`);
    }
  });
}

// 탭 내부에서 순차적으로 학번을 대입하며 자동화 수행
async function handleInPageAutomation(command, targetIds, maxAttempts, delayMs) {
  if (location.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(location.hostname)) {
    console.error('[EveryLock] Safety guard: loopback lab only.');
    return;
  }
  if (!window.__everylockState) {
    window.__everylockState = { isRunning: false, isPaused: false, idIndex: 0, currentAttempt: 0 };
  }

  const state = window.__everylockState;

  if (command === 'STOP') {
    state.isRunning = false;
    state.isPaused = false;
    console.log("%c[EveryLock] 자동화가 중단되었습니다.", "color: #ff5555; font-weight: bold;");
    return;
  }

  if (command === 'PAUSE') {
    if (state.isRunning) {
      state.isPaused = true;
      console.log("%c[EveryLock] 자동화가 일시정지되었습니다.", "color: #ffc85a; font-weight: bold;");
    }
    return;
  }

  if (command === 'RESUME') {
    if (state.isRunning && state.isPaused) {
      state.isPaused = false;
      console.log("%c[EveryLock] 자동화를 재개합니다.", "color: #54f090; font-weight: bold;");
      runMultiAccountLoop();
    }
    return;
  }

  if (command === 'START') {
    state.isRunning = true;
    state.isPaused = false;
    state.idIndex = 0;
    state.currentAttempt = 0;
    state.targetIds = targetIds;
    console.log(`%c[EveryLock] 다중 계정 자동화 시작 (총 ${targetIds.length}개 계정)`, "color: #54f090; font-weight: bold;");
    runMultiAccountLoop();
  }

  async function runMultiAccountLoop() {
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    function getRandomPassword() {
      let pw = "";
      for (let i = 0; i < 8; i++) pw += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
      return pw;
    }

    // 학번 배열을 순회하며 대입 루프 수행
    while (state.isRunning && state.idIndex < state.targetIds.length) {
      if (state.isPaused) break;

      const currentId = state.targetIds[state.idIndex];
      state.currentAttempt = 0;

      console.log(`%c[TARGET] 현재 대상 학번 대입 중: ${currentId} (${state.idIndex + 1}/${state.targetIds.length})`, "color: #4ee8ff;");

      // 각 계정별로 maxAttempts 횟수만큼 비밀번호 무작위 대입 시도
      while (state.isRunning && !state.isPaused && state.currentAttempt < maxAttempts) {
        state.currentAttempt++;
        window.objId = currentId;
        window.objPw = getRandomPassword();

        const idInput = document.querySelector('input[name="username"], input[name="id"], #objId, #userId, input.id');
        const pwInput = document.querySelector('input[name="password"], #objPw, #userPassword, input.password');

        if (idInput) idInput.value = window.objId;
        if (pwInput) pwInput.value = window.objPw;

        try {
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'secure', username: window.objId, password: window.objPw })
          });

          const responseBody = await response.json().catch(() => ({}));
          console.log(`[Attempt ${state.currentAttempt}/${maxAttempts}] synthetic ID: ${window.objId} | status=${response.status}`);

          const isReallyLocked = response.status === 423 || responseBody.accountStatus === 'LOCKED';

          if (isReallyLocked) {
            console.log(`%c[LOCKED] 대상 학번 ${window.objId} 잠금 발생!`, "color: #ffc85a; font-weight: bold;");
            
            // 확장프로그램 팝업 DB에 즉시 반영하기 위해 커스텀 이벤트나 메시지 송신 역할 대신 콘솔 기록
            window.dispatchEvent(new CustomEvent('EveryLockLockedEvent', { 
              detail: { userId: window.objId, attempts: state.currentAttempt } 
            }));

            break; // 이 계정은 잠겼으므로 다음 학번으로 넘어감
          }
        } catch (error) {
          console.error(`[ERROR] 요청 전송 오류:`, error);
        }

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      state.idIndex++;
    }

    if (state.idIndex >= state.targetIds.length) {
      state.isRunning = false;
      console.log("%c[EveryLock] 모든 대상 학번 순회 및 자동화 완료!", "color: #54f090; font-weight: bold;");
    }
  }
}

// 탭 내부에서 잠금 감지 시 팝업 DB(IndexedDB)로 자동 수집하는 리스너
window.addEventListener('EveryLockLockedEvent', (e) => {
  const { userId, attempts } = e.detail;
  addLockedAccount(userId, attempts);
  log(`[LOCKED DB] 학번 ${userId} 저장 완료! (${attempts}회 시도)`);
});

// ==========================================
// 5. JSON 파일 내보내기 & DB 관리
// ==========================================
document.getElementById('btnExportJson').addEventListener('click', async () => {
  const records = await getAllLockedAccounts();
  if (records.length === 0) {
    log("[EXPORT] 내보낼 DB 기록이 없습니다.");
    return;
  }

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "locked.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();

  log(`[EXPORT] ${records.length}개 기록이 locked.json 파일로 내보내졌습니다.`);
});

document.getElementById('btnClearDb').addEventListener('click', clearDB);

function log(msg) {
  const box = document.getElementById('log');
  box.innerText += `\n${msg}`;
  box.scrollTop = box.scrollHeight;
}

refreshDbList();
