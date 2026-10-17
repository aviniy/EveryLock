import assert from "node:assert/strict";

const base = process.env.CJU_LAB_URL || "http://127.0.0.1:4173";

async function login(mode, username, password) {
  return fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, username, password }),
  });
}

const injection = "' OR '1'='1";
const vulnerableLogin = await login("vulnerable", injection, "anything");
assert.equal(vulnerableLogin.status, 200);
assert.equal((await vulnerableLogin.json()).authenticated, true);

const secureLogin = await login("secure", injection, "anything");
assert.equal(secureLogin.status, 401);
assert.equal((await secureLogin.json()).authenticated, false);

const allowed = await fetch(`${base}/api/child?parentId=P100&childId=20260001&mode=secure`);
assert.equal(allowed.status, 200);

const vulnerableIdor = await fetch(`${base}/api/child?parentId=P100&childId=20260002&mode=vulnerable`);
assert.equal(vulnerableIdor.status, 200);
assert.equal((await vulnerableIdor.json()).student.studentId, "20260002");

const blockedIdor = await fetch(`${base}/api/child?parentId=P100&childId=20260002&mode=secure`);
assert.equal(blockedIdor.status, 403);

const verboseError = await fetch(`${base}/api/error?mode=vulnerable`);
assert.equal(verboseError.status, 500);
assert.match(await verboseError.text(), /StudentRepository\.java/);

const safeError = await fetch(`${base}/api/error?mode=secure`);
assert.equal(safeError.status, 500);
const safeBody = await safeError.json();
assert.equal(safeBody.message, "처리 중 오류가 발생했습니다.");
assert.ok(safeBody.traceId);

const vulnerableSession = await fetch(`${base}/api/session?mode=vulnerable`);
assert.match((await vulnerableSession.json()).exposedSession, /^LAB-/);

const safeSession = await fetch(`${base}/api/session?mode=secure`);
const safeSessionBody = await safeSession.json();
assert.match(safeSessionBody.oneTimeNonce, /^NONCE-/);
assert.equal("exposedSession" in safeSessionBody, false);

const resetLockout = await fetch(`${base}/api/lockout/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountCount: 10 }),
});
assert.equal(resetLockout.status, 200);
assert.equal((await resetLockout.json()).totalAccounts, 10);

const studentStyleReset = await fetch(`${base}/api/lockout/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountCount: 12, idFormat: "student", seed: 2026 }),
});
const studentStyleBody = await studentStyleReset.json();
assert.equal(studentStyleBody.totalAccounts, 12);
assert.ok(studentStyleBody.accounts.every((account) => /^(2023|2024|2025|2026)\d{6}$/.test(account.userId)));

const explicitReset = await fetch(`${base}/api/lockout/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountIds: ["2026010001"] }),
});
const explicitBody = await explicitReset.json();
assert.equal(explicitReset.status, 200);
assert.equal(explicitBody.totalAccounts, 1);
assert.equal(explicitBody.accounts[0].userId, "2026010001");

await fetch(`${base}/api/lockout/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountCount: 10 }),
});

const simulated = await fetch(`${base}/api/lockout/simulate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ events: 100, distribution: "spread" }),
});
const simulatedBody = await simulated.json();
assert.equal(simulatedBody.lockedAccounts, 10);
assert.equal(simulatedBody.availabilityRate, 0);

const lockedUser = simulatedBody.accounts.find((account) => account.status === "LOCKED").userId;
const unlocked = await fetch(`${base}/api/lockout/unlock`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: lockedUser }),
});
assert.equal((await unlocked.json()).lockedAccounts, 9);

await fetch(`${base}/api/lockout/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountCount: 10 }),
});
let loginFailure;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  loginFailure = await login("secure", "2026SIM00001", "wrong");
  const body = await loginFailure.json();
  assert.equal(body.failedAttempts, attempt);
  if (attempt === 5) assert.match(body.message, /비밀번호재설정/);
}
assert.equal(loginFailure.status, 423);

await fetch(`${base}/api/lockout/reset`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountCount: 100 }),
});

console.log("Local lab API simulations passed.");
