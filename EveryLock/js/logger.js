const LOG_STORAGE_KEY = "everylock_logs";
const MAX_LOGS = 300;

export async function addLog(message, level = "info") {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0]; // [HH:MM:SS]
  const logEntry = {
    time: timeStr,
    message: message,
    level: level // info, warn, error, success
  };

  try {
    const data = await chrome.storage.local.get([LOG_STORAGE_KEY]);
    let logs = data[LOG_STORAGE_KEY] || [];
    logs.push(logEntry);

    // 최대 300개 제한 유지 (오래된 것부터 삭제)
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(logs.length - MAX_LOGS);
    }

    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
  } catch (err) {
    console.error("로그 저장 실패:", err);
  }
}

export async function getLogs() {
  try {
    const data = await chrome.storage.local.get([LOG_STORAGE_KEY]);
    return data[LOG_STORAGE_KEY] || [];
  } catch (err) {
    return [];
  }
}

export async function clearLogs() {
  try {
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: [] });
  } catch (err) {}
}