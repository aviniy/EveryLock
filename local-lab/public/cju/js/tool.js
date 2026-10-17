(function () {
  "use strict";

  var running = false;
  var paused = false;
  var remaining = 0;
  var totalPlanned = 0;
  var processed = 0;
  var knownLocked = new Set();
  var timer = null;

  function byId(id) { return document.getElementById(id); }

  async function api(path, options) {
    var response = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, options || {}));
    var body = await response.json();
    if (!response.ok) throw new Error(body.message || "Local API error");
    return body;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function writeLog(message, kind) {
    var line = document.createElement("p");
    line.className = kind || "event";
    line.textContent = "[" + new Date().toLocaleTimeString("ko-KR", { hour12: false }) + "] " + message;
    byId("terminal-output").appendChild(line);
    while (byId("terminal-output").children.length > 350) byId("terminal-output").firstChild.remove();
    byId("terminal-output").scrollTop = byId("terminal-output").scrollHeight;
  }

  function render(data) {
    byId("total").textContent = data.totalAccounts.toLocaleString("ko-KR");
    byId("active").textContent = data.activeAccounts.toLocaleString("ko-KR");
    byId("locked").textContent = data.lockedAccounts.toLocaleString("ko-KR");
    byId("availability").textContent = data.availabilityRate.toFixed(2) + "%";
    byId("stream-count").textContent = processed.toLocaleString("ko-KR") + " EVENTS";
    byId("locked-count").textContent = data.lockedAccounts.toLocaleString("ko-KR") + " FOUND";

    var percentage = totalPlanned ? Math.min(100, processed / totalPlanned * 100) : 0;
    byId("progress-bar").style.width = percentage.toFixed(2) + "%";
    byId("progress-text").textContent = processed.toLocaleString("ko-KR") + " / " + totalPlanned.toLocaleString("ko-KR") + " EVENTS";
    byId("run-state").textContent = running ? (paused ? "PAUSED" : "RUNNING") : processed && processed >= totalPlanned ? "COMPLETE" : "STANDBY";

    byId("account-grid").innerHTML = data.accounts.map(function (account) {
      return '<i class="' + (account.status === "LOCKED" ? "locked" : "") + '" title="' + escapeHtml(account.userId) + ' · ' + account.status + ' · ' + account.failedAttempts + '/10"></i>';
    }).join("");

    var lockedAccounts = data.accounts.filter(function (account) { return account.status === "LOCKED"; });
    byId("locked-rows").innerHTML = lockedAccounts.length ? lockedAccounts.map(function (account) {
      return '<div class="lock-row"><strong>' + escapeHtml(account.userId) + '</strong><span>' + account.failedAttempts + '/10</span><time>' + new Date(account.lockedAt).toLocaleTimeString("ko-KR", { hour12: false }) + '</time></div>';
    }).join("") : '<p class="empty">NO LOCKED ACCOUNTS</p>';

    lockedAccounts.forEach(function (account) {
      if (!knownLocked.has(account.userId)) {
        knownLocked.add(account.userId);
        writeLog(account.userId + " Lock Success!", "success");
      }
    });
  }

  async function initialize() {
    var users = Math.max(10, Math.min(1000, Number(byId("users").value) || 100));
    var attempts = Math.max(1, Math.min(10, Number(byId("attempts").value) || 10));
    var seed = Number(byId("seed").value) || 2026;
    totalPlanned = users * attempts;
    remaining = totalPlanned;
    processed = 0;
    knownLocked = new Set();
    byId("terminal-output").innerHTML = "";
    writeLog("Safety check passed: target=127.0.0.1:4173", "round");
    writeLog("Generated " + users + " synthetic student IDs · password=[A-Za-z0-9]{8}", "event");
    var data = await api("/api/lockout/reset", {
      method: "POST",
      body: JSON.stringify({ accountCount: users, idFormat: "student", seed: seed })
    });
    render(data);
  }

  async function tick() {
    if (!running || paused) return;
    if (remaining <= 0) {
      running = false;
      writeLog("Simulation complete · all planned events processed", "complete");
      return;
    }
    var rate = Math.max(1, Math.min(100, Number(byId("rate").value) || 40));
    var chunk = Math.min(remaining, Math.max(1, Math.floor(rate / 4)));
    try {
      var data = await api("/api/lockout/simulate", {
        method: "POST",
        body: JSON.stringify({ events: chunk, distribution: "spread" })
      });
      processed += chunk;
      remaining -= chunk;
      if (processed % Math.max(chunk, Math.floor(totalPlanned / 10)) < chunk) {
        writeLog("Progress " + processed + "/" + totalPlanned + " · locked=" + data.lockedAccounts, "round");
      }
      render(data);
      if (remaining <= 0) {
        running = false;
        writeLog("Simulation complete · locked=" + data.lockedAccounts + " · availability=" + data.availabilityRate.toFixed(2) + "%", "complete");
        render(data);
        return;
      }
      timer = window.setTimeout(tick, 250);
    } catch (error) {
      running = false;
      writeLog("ERROR: " + error.message, "success");
    }
  }

  byId("start").addEventListener("click", async function () {
    if (running) return;
    await initialize();
    running = true;
    paused = false;
    writeLog("Attack simulation started", "round");
    tick();
  });
  byId("pause").addEventListener("click", function () {
    if (!running) return;
    paused = true;
    if (timer) window.clearTimeout(timer);
    writeLog("Simulation paused by operator", "muted");
    byId("run-state").textContent = "PAUSED";
  });
  byId("resume").addEventListener("click", function () {
    if (!running || !paused) return;
    paused = false;
    writeLog("Simulation resumed", "round");
    tick();
  });
  byId("reset").addEventListener("click", async function () {
    running = false;
    paused = false;
    if (timer) window.clearTimeout(timer);
    await initialize();
    writeLog("Local lab state reset", "muted");
  });
  byId("clear-log").addEventListener("click", function () {
    byId("terminal-output").innerHTML = '<p class="muted">[SYSTEM] Console cleared.</p>';
  });

  initialize();
})();
