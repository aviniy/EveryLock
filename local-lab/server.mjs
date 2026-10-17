import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, "public");
const host = "127.0.0.1";
const port = Number(process.env.CJU_LAB_PORT || 4173);
const labSession = `LAB-${randomBytes(16).toString("hex")}`;

const students = {
  "20260001": { studentId: "20260001", name: "김민준", department: "경영학과", status: "재학" },
  "20260002": { studentId: "20260002", name: "이서연", department: "컴퓨터공학과", status: "휴학" },
};
const parentRelations = { P100: ["20260001"] };
const labUsers = { student: "LabPass!2026" };

// Account-lockout research data. These records are synthetic and live only in
// this localhost process; no request is ever sent to the real portal.
const lockoutThreshold = 10;
const lockoutAccounts = new Map();
const lockoutLogs = [];
let simulationCursor = 0;

function makeVirtualId(index) {
  const year = 2024 + (index % 3);
  return `${year}SIM${String(index + 1).padStart(5, "0")}`;
}

function makeStudentStyleId(index, seed) {
  const years = [2026, 2025, 2024, 2023];
  const suffix = ((Number(seed) || 2026) * 9301 + index * 49297) % 1_000_000;
  return `${years[index % years.length]}${String(suffix).padStart(6, "0")}`;
}

function resetLockoutLab(count = 100, idFormat = "synthetic", seed = 2026) {
  const safeCount = Math.max(10, Math.min(1000, Number(count) || 100));
  lockoutAccounts.clear();
  for (let index = 0; index < safeCount; index += 1) {
    const userId = idFormat === "student" ? makeStudentStyleId(index, seed) : makeVirtualId(index);
    lockoutAccounts.set(userId, {
      userId,
      failedAttempts: 0,
      status: "ACTIVE",
      lockedAt: null,
    });
  }
  lockoutAccounts.set("student", {
    userId: "student",
    failedAttempts: 0,
    status: "ACTIVE",
    lockedAt: null,
  });
  simulationCursor = 0;
  lockoutLogs.length = 0;
}

function resetLockoutLabWithIds(accountIds) {
  const safeIds = [...new Set(accountIds)]
    .filter((value) => /^(2023|2024|2025|2026)\d{6}$/.test(String(value)))
    .slice(0, 1000);
  if (!safeIds.length) return false;
  lockoutAccounts.clear();
  for (const userId of safeIds) {
    lockoutAccounts.set(userId, {
      userId,
      failedAttempts: 0,
      status: "ACTIVE",
      lockedAt: null,
    });
  }
  lockoutAccounts.set("student", {
    userId: "student",
    failedAttempts: 0,
    status: "ACTIVE",
    lockedAt: null,
  });
  simulationCursor = 0;
  lockoutLogs.length = 0;
  return true;
}

function getLockoutAccount(userId) {
  const normalized = String(userId || "anonymous").slice(0, 40);
  if (!lockoutAccounts.has(normalized)) {
    lockoutAccounts.set(normalized, {
      userId: normalized,
      failedAttempts: 0,
      status: "ACTIVE",
      lockedAt: null,
    });
  }
  return lockoutAccounts.get(normalized);
}

function addLockoutLog(eventType, account, result, source) {
  lockoutLogs.push({
    timestamp: new Date().toISOString(),
    eventType,
    virtualUserId: account.userId,
    result,
    source,
  });
  if (lockoutLogs.length > 500) lockoutLogs.splice(0, lockoutLogs.length - 500);
}

function registerFailure(userId, source = "LOGIN_FORM") {
  const account = getLockoutAccount(userId);
  if (account.status === "LOCKED") {
    addLockoutLog("SECURITY", account, "DENIED_ALREADY_LOCKED", source);
    return account;
  }
  account.failedAttempts += 1;
  if (account.failedAttempts >= lockoutThreshold) {
    account.status = "LOCKED";
    account.lockedAt = new Date().toISOString();
    addLockoutLog("SECURITY", account, "ACCOUNT_LOCKED", source);
  } else {
    addLockoutLog("ACCOUNT", account, "FAILED_ATTEMPTS_UPDATED", source);
  }
  return account;
}

function failureMessage(account) {
  if (account.status === "LOCKED") {
    return "비밀번호 오류 횟수를 초과하였습니다. 관리자(T.043-229-8789)에게 문의하시기 바랍니다.";
  }
  if (account.failedAttempts >= 5) {
    return `사용자 아이디 또는 비밀번호가 일치하지 않습니다. ${account.failedAttempts}회 실패됨.\n비밀번호재설정 기능을 이용하여 임시비밀번호를 받아 다시 로그인하기 바랍니다.\n10회 실패 시 계정이 잠기며, 본인 확인작업을 해야만 계정을 사용할 수 있습니다.`;
  }
  return `사용자 아이디 또는 비밀번호가 일치하지 않습니다. ${account.failedAttempts}회 실패됨.`;
}

function lockoutSnapshot() {
  const accounts = [...lockoutAccounts.values()].filter((account) => account.userId !== "student");
  const locked = accounts.filter((account) => account.status === "LOCKED").length;
  return {
    totalAccounts: accounts.length,
    activeAccounts: accounts.length - locked,
    lockedAccounts: locked,
    availabilityRate: accounts.length ? Number((((accounts.length - locked) / accounts.length) * 100).toFixed(2)) : 100,
    threshold: lockoutThreshold,
    processedEvents: lockoutLogs.length,
    accounts: accounts.slice(0, 300),
    recentLogs: lockoutLogs.slice(-60),
    disclaimer: "격리된 localhost 가상 계정만 변경하며 실제 포털에는 요청하지 않습니다.",
  };
}

resetLockoutLab();

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function json(res, status, value, headers) {
  send(res, status, JSON.stringify(value, null, 2), "application/json; charset=utf-8", headers);
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);

  if (req.method === "GET" && url.pathname === "/") {
    const template = await readFile(path.join(root, "public", "index.html"), "utf8");
    const html = template.replaceAll("__LAB_SESSION__", labSession);
    send(res, 200, html, "text/html; charset=utf-8", {
      "Set-Cookie": `LABSESSION=${labSession}; Path=/; HttpOnly; SameSite=Lax`,
      "Content-Security-Policy": "default-src 'self' 'unsafe-inline' https://code.jquery.com; img-src 'self' data:",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin") {
    const html = await readFile(path.join(root, "public", "admin.html"), "utf8");
    send(res, 200, html, "text/html; charset=utf-8", {
      "Content-Security-Policy": "default-src 'self' 'unsafe-inline'",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/tool") {
    const html = await readFile(path.join(root, "public", "tool.html"), "utf8");
    send(res, 200, html, "text/html; charset=utf-8", {
      "Content-Security-Policy": "default-src 'self' 'unsafe-inline'",
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/cju/")) {
    const assetPath = path.resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
    if (!assetPath.startsWith(`${publicRoot}${path.sep}`)) {
      send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      return;
    }
    try {
      const asset = await readFile(assetPath);
      send(res, 200, asset, mimeTypes[path.extname(assetPath).toLowerCase()] || "application/octet-stream");
    } catch {
      send(res, 404, "Not Found", "text/plain; charset=utf-8");
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/profile") {
    json(res, 200, { displayName: url.searchParams.get("name") || "김학생" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const { username = "", password = "", mode = "secure" } = await readJson(req);
    const lockAccount = getLockoutAccount(username || "anonymous");
    if (lockAccount.status === "LOCKED") {
      json(res, 423, {
        mode,
        authenticated: false,
        errorCode: "ACCOUNT_LOCKED",
        failedAttempts: lockAccount.failedAttempts,
        accountStatus: lockAccount.status,
        message: failureMessage(lockAccount),
      });
      return;
    }
    const constructedQuery = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
    const booleanBypass = /'\s*or\s*(['"]?1['"]?\s*=\s*['"]?1|true)/i.test(`${username} ${password}`);
    const authenticated = mode === "vulnerable"
      ? Boolean(labUsers[username] === password || booleanBypass)
      : Boolean(labUsers[username] === password);

    if (!authenticated) {
      const failedAccount = registerFailure(username || "anonymous");
      json(res, failedAccount.status === "LOCKED" ? 423 : 401, {
        mode,
        authenticated: false,
        errorCode: failedAccount.status === "LOCKED" ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS",
        failedAttempts: failedAccount.failedAttempts,
        accountStatus: failedAccount.status,
        message: failureMessage(failedAccount),
        ...(mode === "vulnerable" ? { constructedQuery } : { queryHandling: "매개변수 바인딩을 가정한 정확한 값 비교" }),
      });
      return;
    }
    lockAccount.failedAttempts = 0;
    addLockoutLog("AUTH", lockAccount, "LOGIN_SUCCESS", "LOGIN_FORM");
    json(res, 200, {
      mode,
      authenticated,
      message: "가짜 실습 계정 로그인 성공",
      failedAttempts: 0,
      accountStatus: lockAccount.status,
      ...(mode === "vulnerable" ? { constructedQuery } : { queryHandling: "매개변수 바인딩을 가정한 정확한 값 비교" }),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/lockout/status") {
    json(res, 200, lockoutSnapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lockout/reset") {
    const { accountCount = 100, idFormat = "synthetic", seed = 2026, accountIds = null } = await readJson(req);
    if (Array.isArray(accountIds)) {
      if (!resetLockoutLabWithIds(accountIds)) {
        json(res, 400, { message: "유효한 가상 학번 목록이 필요합니다." });
        return;
      }
    } else {
      resetLockoutLab(accountCount, idFormat === "student" ? "student" : "synthetic", seed);
    }
    json(res, 200, lockoutSnapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lockout/simulate") {
    const { events = 1, distribution = "spread" } = await readJson(req);
    const count = Math.max(1, Math.min(5000, Number(events) || 1));
    const accounts = [...lockoutAccounts.values()].filter((account) => account.userId !== "student");
    for (let index = 0; index < count; index += 1) {
      const targetIndex = distribution === "focused" ? 0 : simulationCursor % accounts.length;
      registerFailure(accounts[targetIndex].userId, "LOCAL_SIMULATOR");
      simulationCursor += 1;
    }
    json(res, 200, lockoutSnapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lockout/unlock") {
    const { userId = "" } = await readJson(req);
    const account = lockoutAccounts.get(userId);
    if (!account) {
      json(res, 404, { message: "가상 계정을 찾을 수 없습니다." });
      return;
    }
    account.failedAttempts = 0;
    account.status = "ACTIVE";
    account.lockedAt = null;
    addLockoutLog("RECOVERY", account, "ACCOUNT_UNLOCKED", "LOCAL_ADMIN");
    json(res, 200, lockoutSnapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lockout/unlock-all") {
    for (const account of lockoutAccounts.values()) {
      if (account.status === "LOCKED") {
        account.failedAttempts = 0;
        account.status = "ACTIVE";
        account.lockedAt = null;
        addLockoutLog("RECOVERY", account, "ACCOUNT_UNLOCKED", "LOCAL_ADMIN_BULK");
      }
    }
    json(res, 200, lockoutSnapshot());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/child") {
    const parentId = url.searchParams.get("parentId") || "P100";
    const childId = url.searchParams.get("childId") || "";
    const mode = url.searchParams.get("mode") || "secure";
    const student = students[childId];

    if (!student) {
      json(res, 404, { message: "학생 정보가 없습니다." });
      return;
    }
    if (mode === "secure" && !parentRelations[parentId]?.includes(childId)) {
      json(res, 403, { message: "이 학생을 조회할 권한이 없습니다." });
      return;
    }
    json(res, 200, { mode, parentId, student });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const mode = url.searchParams.get("mode") || "secure";
    if (mode === "vulnerable") {
      json(res, 200, {
        mode,
        exposedSession: labSession,
        explanation: "HttpOnly 쿠키와 동일한 값이 JavaScript가 읽을 수 있는 응답에 노출됨",
      });
    } else {
      json(res, 200, {
        mode,
        oneTimeNonce: `NONCE-${randomBytes(8).toString("hex")}`,
        explanation: "세션 대신 수명과 용도가 제한된 별도 값을 전달함",
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/error") {
    const mode = url.searchParams.get("mode") || "secure";
    if (mode === "vulnerable") {
      send(
        res,
        500,
        "java.sql.SQLException: relation LAB_STUDENT was not found\n    at lab.portal.StudentRepository.findById(StudentRepository.java:42)\n    at lab.portal.ParentController.lookup(ParentController.java:87)",
        "text/plain; charset=utf-8",
      );
    } else {
      json(res, 500, { message: "처리 중 오류가 발생했습니다.", traceId: `LAB-${Date.now()}` });
    }
    return;
  }

  send(res, 404, "Not Found", "text/plain; charset=utf-8");
});

server.listen(port, host, () => {
  console.log(`CJU portal security lab: http://${host}:${port}`);
  console.log("Synthetic data only. Do not point this lab at a real service.");
});
