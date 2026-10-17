(function ($) {
  "use strict";

  var mode = "vulnerable";
  var lockoutRunning = false;
  var lockoutRemaining = 0;

  function pretty(value) {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  async function request(url, options) {
    var response = await fetch(url, options || {});
    var text = await response.text();
    var body = text;
    try { body = JSON.parse(text); } catch (_) {}
    return { status: response.status, body: body };
  }

  function openConsole(panelId) {
    $("#analysis-console").addClass("open");
    if (panelId) {
      $(".console-tabs button").removeClass("active").filter("[data-panel='" + panelId + "']").addClass("active");
      $(".console-panel").removeClass("active");
      $("#" + panelId).addClass("active");
    }
  }

  function showResult(title, result) {
    openConsole("console-result");
    $("#lab-output").text(title + "\n\n" + pretty(result));
  }

  function setMode(nextMode) {
    mode = nextMode;
    $("#mode-vulnerable,#mode-secure").removeClass("active");
    $(nextMode === "vulnerable" ? "#mode-vulnerable" : "#mode-secure").addClass("active");
    $("#mode-label").text(nextMode === "vulnerable" ? "취약 모드" : "방어 모드")
      .css("background", nextMode === "vulnerable" ? "#9c1d28" : "#087a50");
  }

  function showLocalDialog(title, message) {
    $("#dialog-title").text(title);
    $("#dialog-message").text(message || "외부 서비스 연결은 차단되어 있습니다. 이 화면은 localhost 전용 모의훈련입니다.");
    $("#local-dialog").removeClass("hidden");
  }

  function renderLockout(data) {
    $("#lock-total").text(data.totalAccounts);
    $("#lock-active").text(data.activeAccounts);
    $("#lock-locked").text(data.lockedAccounts);
    $("#lock-availability").text(data.availabilityRate.toFixed(2) + "%");
    $("#lock-grid").html(data.accounts.map(function (account) {
      return '<i class="' + (account.status === "LOCKED" ? "locked" : "") + '" title="' + account.userId + ' · ' + account.failedAttempts + '회"></i>';
    }).join(""));
    var logs = data.recentLogs.slice(-10).reverse().map(function (item) {
      return "[" + item.eventType + "] " + item.virtualUserId + " · " + item.result;
    });
    $("#lock-log").text((lockoutRunning ? "실행 중 · 남은 이벤트 " + lockoutRemaining + "\n" : "") + (logs.join("\n") || "실행 전"));
  }

  async function refreshLockout() {
    var result = await request("/api/lockout/status");
    renderLockout(result.body);
  }

  async function runLockoutChunk() {
    if (!lockoutRunning || lockoutRemaining <= 0) {
      lockoutRunning = false;
      await refreshLockout();
      return;
    }
    var chunk = Math.min(50, lockoutRemaining);
    var result = await request("/api/lockout/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: chunk, distribution: $("#lock-distribution").val() })
    });
    lockoutRemaining -= chunk;
    renderLockout(result.body);
    window.setTimeout(runLockoutChunk, 90);
  }

  $(function () {
    $(".tab li").on("click", function () {
      var target = $(this).attr("data-tab");
      $(".tab li").removeClass("on");
      $(this).addClass("on");
      $(".div_con").addClass("hidden");
      $("#" + target).removeClass("hidden");
    });

    $("#mode-vulnerable").on("click", function () { setMode("vulnerable"); });
    $("#mode-secure").on("click", function () { setMode("secure"); });
    $("#open-console").on("click", function () { openConsole("console-result"); });
    $("#open-lockout").on("click", function () { openConsole("lockout-panel"); refreshLockout(); });
    $("#close-console").on("click", function () { $("#analysis-console").removeClass("open"); });

    $(".console-tabs button").on("click", function () {
      var panel = $(this).attr("data-panel");
      $(".console-tabs button").removeClass("active");
      $(this).addClass("active");
      $(".console-panel").removeClass("active");
      $("#" + panel).addClass("active");
    });

    $("#fill-sqli").on("click", function () {
      $("#newUserId").val("' OR '1'='1");
      $("#newPassword").val("anything");
      showResult("SQL 인젝션 실습값 입력", {
        payload: "' OR '1'='1",
        note: "취약 모드와 방어 모드에서 각각 로그인 버튼을 눌러 결과를 비교하세요."
      });
    });

    $("#LoginForm").on("submit", async function (event) {
      event.preventDefault();
      var result = await request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode,
          username: $("#newUserId").val(),
          password: $("#newPassword").val()
        })
      });
      if (!result.body.authenticated && result.body.message) {
        window.alert(result.body.message);
      }
      showResult("SQL 인젝션 로그인 · " + (mode === "vulnerable" ? "취약 모드" : "방어 모드"), result);
      refreshLockout();
    });

    $("#lock-start").on("click", function () {
      if (lockoutRunning) return;
      lockoutRemaining = Math.max(1, Math.min(100000, Number($("#lock-event-count").val()) || 1));
      lockoutRunning = true;
      runLockoutChunk();
    });
    $("#lock-pause").on("click", function () { lockoutRunning = false; refreshLockout(); });
    $("#lock-reset").on("click", async function () {
      lockoutRunning = false;
      var result = await request("/api/lockout/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCount: Number($("#lock-account-count").val()) || 100 })
      });
      renderLockout(result.body);
    });

    $("[data-local-dialog]").on("click", function (event) {
      event.preventDefault();
      showLocalDialog($(this).attr("data-local-dialog"));
    });
    $(".local-disabled").on("click", function () {
      showLocalDialog("보안인증서 기능", "인증서 모듈과 실제 인증 요청은 로컬 실습에서 비활성화되어 있습니다.");
    });
    $("#local-dialog .modal-close,#local-dialog .modal-ok,#local-dialog .modal-bg").on("click", function () { $("#local-dialog").addClass("hidden"); });

    $("#open-parent").on("click", function (event) {
      event.preventDefault();
      $("#parent-dialog").removeClass("hidden");
    });
    $("#parent-dialog .modal-close,#parent-dialog .modal-bg").on("click", function () { $("#parent-dialog").addClass("hidden"); });
    $("#run-idor").on("click", async function () {
      var childId = $("#child-id").val();
      var result = await request("/api/child?parentId=P100&childId=" + encodeURIComponent(childId) + "&mode=" + mode);
      $("#idor-output").text(pretty(result));
      showResult("IDOR 학부모 조회 · " + (mode === "vulnerable" ? "취약 모드" : "방어 모드"), result);
    });

    $("#fill-xss").on("click", function () {
      $("#profile-name").val('<img src=x onerror="document.getElementById(\'xss-flag\').textContent=\'로컬 실습 스크립트 실행됨\'">');
    });
    $("#run-xss").on("click", async function () {
      $("#xss-flag").text("스크립트 실행 안 됨");
      var result = await request("/api/profile?name=" + encodeURIComponent($("#profile-name").val()));
      if (mode === "vulnerable") {
        $("#xss-output").html("<strong>사용자:</strong> " + result.body.displayName);
      } else {
        $("#xss-output").text("사용자: " + result.body.displayName);
      }
    });

    $("#run-session").on("click", async function () {
      var api = await request("/api/session?mode=" + mode);
      var result = {
        documentCookie: document.cookie || "(HttpOnly이므로 보이지 않음)",
        javascriptVariable: mode === "vulnerable" ? window.exposedSession : "(세션을 JavaScript에 제공하지 않음)",
        api: api
      };
      $("#session-output").text(pretty(result));
      showResult("세션 식별자 노출 · " + (mode === "vulnerable" ? "취약 모드" : "방어 모드"), result);
    });

    $("#run-error").on("click", async function () {
      var result = await request("/api/error?mode=" + mode);
      $("#error-output").text(pretty(result));
      showResult("상세 오류 정보 노출 · " + (mode === "vulnerable" ? "취약 모드" : "방어 모드"), result);
    });
  });
})(window.jQuery);
