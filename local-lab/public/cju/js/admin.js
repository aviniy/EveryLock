(function () {
  "use strict";
  var rows = document.getElementById("locked-rows");

  async function api(path, options) {
    var response = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, options || {}));
    return response.json();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function render(data) {
    document.getElementById("admin-total").textContent = data.totalAccounts;
    document.getElementById("admin-active").textContent = data.activeAccounts;
    document.getElementById("admin-locked").textContent = data.lockedAccounts;
    document.getElementById("admin-availability").textContent = data.availabilityRate.toFixed(2) + "%";
    var locked = data.accounts.filter(function (account) { return account.status === "LOCKED"; });
    rows.innerHTML = locked.map(function (account) {
      return "<tr><td>" + escapeHtml(account.userId) + "</td><td>" + account.failedAttempts + "</td><td>" + new Date(account.lockedAt).toLocaleString("ko-KR") + "</td><td class=\"status-locked\">LOCKED</td><td><button class=\"unlock-one\" data-user=\"" + escapeHtml(account.userId) + "\">잠금 해제</button></td></tr>";
    }).join("");
    document.getElementById("admin-empty").style.display = locked.length ? "none" : "block";
    document.getElementById("admin-log").textContent = data.recentLogs.filter(function (item) { return item.eventType === "RECOVERY"; }).slice(-15).reverse().map(function (item) { return item.timestamp + "  " + item.virtualUserId + "  " + item.result; }).join("\n") || "로그 없음";
  }

  async function refresh() { render(await api("/api/lockout/status")); }
  rows.addEventListener("click", async function (event) {
    if (!event.target.matches(".unlock-one")) return;
    render(await api("/api/lockout/unlock", { method: "POST", body: JSON.stringify({ userId: event.target.getAttribute("data-user") }) }));
  });
  document.getElementById("unlock-all").addEventListener("click", async function () {
    render(await api("/api/lockout/unlock-all", { method: "POST", body: "{}" }));
  });
  refresh();
  setInterval(refresh, 1000);
})();
