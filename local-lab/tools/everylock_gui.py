#!/usr/bin/env python3
"""EveryLock native Windows GUI for the isolated localhost lab."""

from __future__ import annotations

import argparse
import json
import queue
import random
import re
import string
import sys
import threading
import time
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


DEFAULT_TARGET = "http://127.0.0.1:4173"
PASSWORD_ALPHABET = string.ascii_letters + string.digits
STUDENT_ID_RE = re.compile(r"^(2023|2024|2025|2026)\d{6}$")
CHANCE_PATTERN_RE = re.compile(r"^(2023|2024|2025|2026)[0-9-]{6}$")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def generate_password(rng: random.Random) -> str:
    return "".join(rng.choices(PASSWORD_ALPHABET, k=8))


def validate_target(raw_target: str) -> str:
    """Normalize a URL while refusing non-loopback destinations."""
    raw = raw_target.strip()
    if not raw:
        raise ValueError("대상 URL 또는 호스트를 입력해주세요.")
    
    if "://" not in raw:
        raw = "http://" + raw

    parsed = urlparse(raw)
    if parsed.scheme != "http":
        raise ValueError("로컬 실습은 http 방식만 허용합니다.")
    
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("올바른 호스트 주소를 입력해주세요.")
    if hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("안전 제한: 127.0.0.1, localhost, ::1만 허용됩니다.")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError("경로·쿼리·자격 증명이 없는 loopback origin만 입력하세요.")
    
    port = parsed.port
    if not port:
        port = 443 if parsed.scheme == "https" else 80

    if not 1 <= port <= 65535:
        raise ValueError("포트는 1~65535 범위여야 합니다.")
    
    display_host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
    return f"{parsed.scheme}://{display_host}:{port}"


def pattern_regex(pattern: str) -> re.Pattern[str]:
    return re.compile("^" + "".join("\\d" if char == "-" else re.escape(char) for char in pattern) + "$")


def generate_weighted_student_ids(count: int, pattern: str, chance: int, seed: int) -> list[str]:
    pattern = pattern.strip()
    if not CHANCE_PATTERN_RE.fullmatch(pattern):
        raise ValueError("Chance 패턴은 예: 202601---- 형식이어야 합니다.")
    wildcards = pattern.count("-")
    targeted_count = round(count * chance / 100)
    if 10**wildcards < targeted_count:
        raise ValueError("Chance 패턴의 빈자리가 목표 계정 수보다 부족합니다.")
    rng = random.Random(seed)
    matcher = pattern_regex(pattern)
    generated: set[str] = set()
    targeted: list[str] = []
    while len(targeted) < targeted_count:
        candidate = "".join(str(rng.randrange(10)) if char == "-" else char for char in pattern)
        if candidate not in generated:
            generated.add(candidate)
            targeted.append(candidate)
    general: list[str] = []
    years = (2026, 2025, 2024, 2023)
    while len(general) < count - targeted_count:
        candidate = f"{rng.choice(years)}{rng.randrange(1_000_000):06d}"
        if candidate not in generated and not matcher.fullmatch(candidate):
            generated.add(candidate)
            general.append(candidate)
    result = targeted + general
    rng.shuffle(result)
    return result


def post_json(opener, target: str, path: str, payload: dict[str, Any], timeout: float = 3.0) -> tuple[int, dict[str, Any]]:
    request = Request(
        f"{target}{path}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "EveryLock-Windows-GUI/1.0"},
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return response.status, (json.loads(raw) if raw.strip() else {})
    except HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except (json.JSONDecodeError, AttributeError):
            body = {"message": str(error)}
        return error.code, body


def get_json(opener, target: str, path: str, timeout: float = 3.0) -> tuple[int, dict[str, Any]]:
    request = Request(
        f"{target}{path}",
        method="GET",
        headers={"User-Agent": "EveryLock-Windows-GUI/1.0"},
    )
    with opener.open(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        return response.status, (json.loads(raw) if raw.strip() else {})


class EveryLockApp:
    BG = "#050907"
    PANEL = "#09120d"
    PANEL_2 = "#0d1912"
    LINE = "#1f3b2a"
    GREEN = "#54f090"
    GREEN_DARK = "#16864a"
    RED = "#ff5265"
    CYAN = "#4ee8ff"
    AMBER = "#ffc85a"
    TEXT = "#d9eee0"
    MUTED = "#708f79"
    FONT = "Cascadia Mono"

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("EveryLock - Smart URL Attack Console")
        self.root.geometry("1320x900")
        self.root.minsize(1080, 760)
        self.root.configure(bg=self.BG)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        self.events: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.worker: threading.Thread | None = None
        self.account_ids: list[str] = []
        self.failed: dict[str, int] = {}
        self.locked: set[str] = set()
        self.total_planned = 0
        self.processed = 0
        self.started_at = 0.0
        self.current_target = validate_target(DEFAULT_TARGET)
        self.last_config: dict[str, Any] = {}

        self._setup_style()
        self._build_ui()
        self._draw_account_map()
        self.root.after(80, self._drain_events)

    def _setup_style(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(
            "EveryLock.Horizontal.TProgressbar",
            troughcolor="#102117",
            background=self.GREEN,
            bordercolor="#102117",
            lightcolor=self.GREEN,
            darkcolor=self.GREEN_DARK,
        )
        style.configure(
            "Treeview",
            background="#07100b",
            foreground=self.TEXT,
            fieldbackground="#07100b",
            bordercolor=self.LINE,
            rowheight=28,
            font=(self.FONT, 10),
        )
        style.configure(
            "Treeview.Heading",
            background="#101d15",
            foreground=self.MUTED,
            bordercolor=self.LINE,
            font=(self.FONT, 9, "bold"),
        )
        style.map("Treeview", background=[("selected", "#173c27")])

    def _frame(self, parent, **kwargs) -> tk.Frame:
        return tk.Frame(parent, bg=kwargs.pop("bg", self.PANEL), **kwargs)

    def _label(self, parent, text: str = "", **kwargs) -> tk.Label:
        return tk.Label(
            parent,
            text=text,
            bg=kwargs.pop("bg", parent.cget("bg")),
            fg=kwargs.pop("fg", self.TEXT),
            font=kwargs.pop("font", (self.FONT, 10)),
            **kwargs,
        )

    def _build_ui(self) -> None:
        header = self._frame(self.root, bg="#050b07", height=76, highlightbackground=self.LINE, highlightthickness=1)
        header.pack(fill="x")
        header.pack_propagate(False)
        mark = self._label(header, "EL", fg=self.GREEN, font=(self.FONT, 16, "bold"), width=4, height=2)
        mark.pack(side="left", padx=(22, 8), pady=14)
        title = self._frame(header, bg="#050b07")
        title.pack(side="left", pady=13)
        self._label(title, "PROJECT EVERYLOCK", fg=self.GREEN, font=(self.FONT, 9, "bold")).pack(anchor="w")
        self._label(title, "SMART URL ATTACK CONSOLE", font=(self.FONT, 17, "bold")).pack(anchor="w")

        target = self._frame(header, bg="#07110b", highlightbackground=self.LINE, highlightthickness=1)
        target.pack(side="right", padx=22, pady=15)
        self._label(target, "●", fg=self.GREEN, font=(self.FONT, 12)).pack(side="left", padx=(12, 8))
        target_text = self._frame(target, bg="#07110b")
        target_text.pack(side="left", padx=(0, 14), pady=5)
        self._label(target_text, "TARGET ACTIVE", fg=self.MUTED, font=(self.FONT, 8)).pack(anchor="w")
        self.target_header_label = self._label(target_text, "127.0.0.1:4173", fg=self.CYAN, font=(self.FONT, 10, "bold"))
        self.target_header_label.pack(anchor="w")

        self._build_quick_toolbar()

        safety = self._frame(self.root, bg="#17140b", height=30, highlightbackground="#51421e", highlightthickness=1)
        safety.pack(fill="x", padx=16, pady=(12, 7))
        self._label(safety, "SMART URL MODE", bg="#17140b", fg=self.AMBER, font=(self.FONT, 8, "bold")).pack(side="left", padx=12)
        for text in ("AUTO URL PARSING", "ANY IP/DOMAIN/PORT", "SYNTHETIC IDENTITIES"):
            self._label(safety, text, bg="#17140b", fg="#a18e59", font=(self.FONT, 8)).pack(side="left", padx=16)

        content = self._frame(self.root, bg=self.BG)
        content.pack(fill="both", expand=True, padx=16, pady=(0, 14))
        content.grid_columnconfigure(1, weight=1)
        content.grid_rowconfigure(1, weight=1)

        self._build_controls(content)
        self._build_dashboard(content)

    def _build_quick_toolbar(self) -> None:
        toolbar = self._frame(self.root, bg="#08110b", height=48, highlightbackground=self.LINE, highlightthickness=1)
        toolbar.pack(fill="x", padx=16, pady=(10, 0))
        toolbar.pack_propagate(False)
        self._label(toolbar, "TARGET URL", bg="#08110b", fg=self.MUTED, font=(self.FONT, 8, "bold")).pack(side="left", padx=(12, 6))
        
        self.target_url_var = tk.StringVar(value=DEFAULT_TARGET)
        url_entry = tk.Entry(toolbar, textvariable=self.target_url_var, width=38, bg="#030705", fg=self.CYAN, insertbackground=self.GREEN, relief="flat", highlightbackground=self.LINE, highlightcolor=self.GREEN, highlightthickness=1, font=(self.FONT, 9))
        url_entry.pack(side="left", ipady=5, padx=(0, 10))

        quick_buttons = (
            ("● TEST CONNECTION", self.test_connection),
            ("⚡ TESTLOCKER", self.test_locker),
            ("↻ UNLOCK ALL", self.unlock_all),
            ("⇩ EXPORT LOG", self.export_log),
            ("⌫ CLEAR", self.clear_console),
        )
        for text, command in quick_buttons:
            self._button(toolbar, text, command).pack(side="left", padx=3, pady=7)

    def _build_controls(self, parent: tk.Frame) -> None:
        side = self._frame(parent, width=270, highlightbackground=self.LINE, highlightthickness=1)
        side.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=(0, 8))
        side.grid_propagate(False)
        self._section_header(side, "01", "SIMULATION PARAMETERS")

        form = self._frame(side)
        form.pack(fill="x", padx=14, pady=12)
        self.users_var = tk.StringVar(value="100")
        self.attempts_var = tk.StringVar(value="10")
        self.rate_var = tk.StringVar(value="40")
        self.seed_var = tk.StringVar(value="2026")
        self.chance_pattern_var = tk.StringVar(value="202601----")
        self.chance_percent_var = tk.StringVar(value="90")
        self.test_id_var = tk.StringVar(value="2026010001")
        self._entry(form, "VIRTUAL STUDENTS", self.users_var)
        self._entry(form, "ATTEMPTS / ACCOUNT", self.attempts_var)
        self._entry(form, "EVENTS / SECOND", self.rate_var)
        self._entry(form, "RANDOM SEED", self.seed_var)
        chance_row = self._frame(form)
        chance_row.pack(fill="x", pady=(5, 0))
        pattern_box = self._frame(chance_row)
        pattern_box.pack(side="left", fill="x", expand=True, padx=(0, 4))
        self._entry(pattern_box, "CHANCE PATTERN", self.chance_pattern_var)
        chance_box = self._frame(chance_row, width=58)
        chance_box.pack(side="left", padx=(4, 0))
        self._entry(chance_box, "CHANCE %", self.chance_percent_var)
        self._entry(form, "TESTLOCKER STUDENT ID", self.test_id_var)
        self._readonly(form, "ID RULE", "YYYY + 6 DIGITS / '-' = RANDOM")
        self._readonly(form, "PASSWORD RULE", "[A-Za-z0-9] × 8 / NOT STORED")

        buttons = self._frame(side)
        buttons.pack(fill="x", padx=14, pady=(0, 10))
        self.start_button = self._button(buttons, "▶ INITIALIZE & RUN", self.start, self.GREEN, "#0d2b18")
        self.start_button.pack(fill="x", pady=3)
        row = self._frame(buttons)
        row.pack(fill="x", pady=3)
        self._button(row, "Ⅱ PAUSE", self.pause).pack(side="left", fill="x", expand=True, padx=(0, 3))
        self._button(row, "▶ RESUME", self.resume).pack(side="left", fill="x", expand=True, padx=(3, 0))
        self._button(buttons, "↺ RESET TARGET LAB", self.reset, self.RED, "#261015").pack(fill="x", pady=3)
        self.connection_label = self._label(side, "● SERVER CHECK PENDING", fg=self.MUTED, font=(self.FONT, 8))
        self.connection_label.pack(side="bottom", anchor="w", padx=14, pady=12)

    def _build_dashboard(self, parent: tk.Frame) -> None:
        top = self._frame(parent, bg=self.BG)
        top.grid(row=0, column=1, sticky="ew")
        top.grid_columnconfigure(tuple(range(4)), weight=1)
        self.metric_total = self._metric(top, 0, "TOTAL ACCOUNTS", "0", self.TEXT)
        self.metric_active = self._metric(top, 1, "ACTIVE ACCOUNTS", "0", self.GREEN)
        self.metric_locked = self._metric(top, 2, "LOCKED ACCOUNTS", "0", self.RED)
        self.metric_availability = self._metric(top, 3, "AVAILABILITY", "100.00%", self.CYAN)

        dashboard = self._frame(parent, bg=self.BG)
        dashboard.grid(row=1, column=1, sticky="nsew", pady=(8, 0))
        dashboard.grid_columnconfigure(0, weight=3)
        dashboard.grid_columnconfigure(1, weight=2)
        dashboard.grid_rowconfigure(1, weight=1)

        map_panel = self._frame(dashboard, highlightbackground=self.LINE, highlightthickness=1)
        map_panel.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 8))
        self._section_header(map_panel, "02", "ACCOUNT STATE MAP")
        self.account_canvas = tk.Canvas(map_panel, height=86, bg="#060d09", highlightthickness=0)
        self.account_canvas.pack(fill="x", padx=11, pady=10)
        self.account_canvas.bind("<Configure>", lambda _event: self._draw_account_map())

        terminal_panel = self._frame(dashboard, highlightbackground=self.LINE, highlightthickness=1)
        terminal_panel.grid(row=1, column=0, sticky="nsew", padx=(0, 4))
        self._section_header(terminal_panel, "03", "LIVE ATTACK STREAM")
        self.terminal = tk.Text(
            terminal_panel,
            bg="#030604",
            fg="#8db49a",
            insertbackground=self.GREEN,
            borderwidth=0,
            padx=12,
            pady=10,
            font=(self.FONT, 9),
            state="disabled",
            wrap="word",
        )
        self.terminal.pack(fill="both", expand=True)
        self.terminal.tag_configure("system", foreground=self.CYAN)
        self.terminal.tag_configure("event", foreground="#8db49a")
        self.terminal.tag_configure("success", foreground=self.RED, background="#1b090e", font=(self.FONT, 9, "bold"))
        self.terminal.tag_configure("complete", foreground=self.GREEN, font=(self.FONT, 9, "bold"))

        locked_panel = self._frame(dashboard, highlightbackground=self.LINE, highlightthickness=1)
        locked_panel.grid(row=1, column=1, sticky="nsew", padx=(4, 0))
        self._section_header(locked_panel, "04", "LOCKED STUDENT IDS")
        columns = ("student_id", "fail", "locked_at")
        self.locked_tree = ttk.Treeview(locked_panel, columns=columns, show="headings", selectmode="browse")
        self.locked_tree.heading("student_id", text="STUDENT ID")
        self.locked_tree.heading("fail", text="FAIL")
        self.locked_tree.heading("locked_at", text="LOCKED AT")
        self.locked_tree.column("student_id", width=135, anchor="w")
        self.locked_tree.column("fail", width=52, anchor="center")
        self.locked_tree.column("locked_at", width=90, anchor="center")
        self.locked_tree.pack(fill="both", expand=True)

        progress_frame = self._frame(parent, bg=self.BG)
        progress_frame.grid(row=2, column=1, sticky="ew", pady=(8, 0))
        self.progress = ttk.Progressbar(progress_frame, style="EveryLock.Horizontal.TProgressbar", maximum=100)
        self.progress.pack(fill="x")
        status_row = self._frame(progress_frame, bg=self.BG)
        status_row.pack(fill="x", pady=(5, 0))
        self.progress_label = self._label(status_row, "0 / 0 EVENTS", bg=self.BG, fg=self.MUTED, font=(self.FONT, 8))
        self.progress_label.pack(side="left")
        self.state_label = self._label(status_row, "STANDBY", bg=self.BG, fg=self.GREEN, font=(self.FONT, 8, "bold"))
        self.state_label.pack(side="right")

    def _section_header(self, parent: tk.Frame, number: str, text: str) -> None:
        header = self._frame(parent, bg="#0b1510", height=39, highlightbackground=self.LINE, highlightthickness=1)
        header.pack(fill="x")
        header.pack_propagate(False)
        self._label(header, number, bg="#0b1510", fg=self.GREEN, font=(self.FONT, 9, "bold")).pack(side="left", padx=(11, 8))
        self._label(header, text, bg="#0b1510", font=(self.FONT, 10, "bold")).pack(side="left")

    def _entry(self, parent: tk.Frame, label: str, variable: tk.StringVar) -> None:
        self._label(parent, label, fg=self.MUTED, font=(self.FONT, 8)).pack(anchor="w", pady=(6, 2))
        entry = tk.Entry(parent, textvariable=variable, bg="#040806", fg=self.TEXT, insertbackground=self.GREEN, relief="flat", highlightbackground=self.LINE, highlightcolor=self.GREEN, highlightthickness=1, font=(self.FONT, 10))
        entry.pack(fill="x", ipady=6)

    def _readonly(self, parent: tk.Frame, label: str, value: str) -> None:
        self._label(parent, label, fg=self.MUTED, font=(self.FONT, 8)).pack(anchor="w", pady=(6, 2))
        self._label(parent, value, bg="#060b08", fg="#607866", anchor="w", padx=7, pady=7, font=(self.FONT, 8)).pack(fill="x")

    def _button(self, parent: tk.Frame, text: str, command, fg: str | None = None, bg: str | None = None) -> tk.Button:
        return tk.Button(parent, text=text, command=command, bg=bg or "#101d15", fg=fg or self.MUTED, activebackground="#183522", activeforeground=self.GREEN, relief="flat", highlightbackground=self.LINE, highlightthickness=1, cursor="hand2", font=(self.FONT, 9, "bold"), pady=7)

    def _metric(self, parent: tk.Frame, column: int, title: str, value: str, color: str) -> tk.Label:
        card = self._frame(parent, highlightbackground=self.LINE, highlightthickness=1)
        card.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 4, 0 if column == 3 else 4))
        self._label(card, title, fg=self.MUTED, font=(self.FONT, 8)).pack(anchor="w", padx=12, pady=(10, 1))
        label = self._label(card, value, fg=color, font=(self.FONT, 20, "bold"))
        label.pack(anchor="w", padx=12, pady=(0, 9))
        return label

    def _validated_config(self) -> tuple[str, int, int, int, int, str, int]:
        try:
            users_str = self.users_var.get().strip()
            attempts_str = self.attempts_var.get().strip()
            rate_str = self.rate_var.get().strip()
            seed_str = self.seed_var.get().strip()
            chance_str = self.chance_percent_var.get().strip()

            if not all([users_str, attempts_str, rate_str, seed_str, chance_str]):
                raise ValueError("모든 설정값을 빠짐없이 입력해주세요.")

            users = int(users_str)
            attempts = int(attempts_str)
            rate = int(rate_str)
            seed = int(seed_str)
            chance = int(chance_str)
        except ValueError as error:
            raise ValueError(f"설정 오류: {error}") from error
        
        target = validate_target(self.target_url_var.get())
        if not 10 <= users <= 1000:
            raise ValueError("가상 학생 수는 10~1,000명이어야 합니다.")
        if not 1 <= attempts <= 10:
            raise ValueError("계정당 시도 횟수는 1~10회여야 합니다.")
        if not 1 <= rate <= 100:
            raise ValueError("초당 이벤트 수는 1~100이어야 합니다.")
        if not 0 <= chance <= 100:
            raise ValueError("Chance 값은 0~100%여야 합니다.")
        pattern = self.chance_pattern_var.get().strip()
        generate_weighted_student_ids(users, pattern, chance, seed)
        return target, users, attempts, rate, seed, pattern, chance

    def start(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("EveryLock", "이미 작업이 실행 중입니다. 중지하거나 완료될 때까지 기다려주세요.", parent=self.root)
            return
        try:
            config = self._validated_config()
        except ValueError as error:
            messagebox.showerror("설정 오류", str(error), parent=self.root)
            return
        self.stop_event.clear()
        self.pause_event.clear()
        self._clear_results()
        self.worker = threading.Thread(target=self._attack_worker, args=(config,), daemon=True)
        self.worker.start()

    def pause(self) -> None:
        if self.worker and self.worker.is_alive():
            self.pause_event.set()
            self.state_label.configure(text="PAUSED", fg=self.AMBER)
            self._log("Simulation paused by operator", "system")

    def resume(self) -> None:
        if self.worker and self.worker.is_alive() and self.pause_event.is_set():
            self.pause_event.clear()
            self.state_label.configure(text="RUNNING", fg=self.GREEN)
            self._log("Simulation resumed", "system")

    def reset(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("EveryLock", "현재 실행 중인 작업을 먼저 중지하세요.", parent=self.root)
            return
        try:
            target = validate_target(self.target_url_var.get())
        except (ValueError, TypeError) as error:
            messagebox.showerror("대상 오류", str(error), parent=self.root)
            return
        self.stop_event.clear()
        self.pause_event.clear()
        threading.Thread(target=self._reset_worker, args=(target,), daemon=True).start()

    def test_connection(self) -> None:
        try:
            target = validate_target(self.target_url_var.get())
        except (ValueError, TypeError) as error:
            messagebox.showerror("대상 오류", str(error), parent=self.root)
            return
        self.connection_label.configure(text="● CHECKING TARGET SERVER", fg=self.AMBER)
        threading.Thread(target=self._connection_worker, args=(target,), daemon=True).start()

    def _connection_worker(self, target: str) -> None:
        try:
            opener = build_opener(NoRedirect())
            status, data = get_json(opener, target, "/api/lockout/status", timeout=3.0)
            self.events.put(("connection", (target, status, data)))
        except (URLError, TimeoutError, json.JSONDecodeError, ValueError, HTTPError) as error:
            self.events.put(("error", f"{target} 연결 실패: {error}"))

    def test_locker(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("EveryLock", "현재 실행 중인 작업을 먼저 중지하세요.", parent=self.root)
            return
        student_id = self.test_id_var.get().strip()
        if not STUDENT_ID_RE.fullmatch(student_id):
            messagebox.showerror("TestLocker", "학번은 2023~2026 + 숫자 6자리여야 합니다.", parent=self.root)
            return
        try:
            target = validate_target(self.target_url_var.get())
            rate_str = self.rate_var.get().strip()
            if not rate_str:
                raise ValueError("초당 이벤트 수를 입력해주세요.")
            rate = int(rate_str)
            if not 1 <= rate <= 100:
                raise ValueError("초당 이벤트 수는 1~100이어야 합니다.")
        except (ValueError, TypeError) as error:
            messagebox.showerror("TestLocker", str(error), parent=self.root)
            return

        self.stop_event.clear()
        self.pause_event.clear()
        self._clear_results()
        self.worker = threading.Thread(target=self._test_locker_worker, args=(target, student_id, rate), daemon=True)
        self.worker.start()

    def _test_locker_worker(self, target: str, student_id: str, rate: int) -> None:
        opener = build_opener(NoRedirect())
        rng = random.Random(int(self.seed_var.get()) ^ 0x710C)
        try:
            _, data = post_json(opener, target, "/api/lockout/reset", {"accountIds": [student_id]}, timeout=3.0)
            self.events.put(("initialized", (data, 10, target, student_id, 100)))
            interval = 1.0 / rate
            for attempt in range(1, 11):
                if self.stop_event.is_set():
                    self.events.put(("stopped", None))
                    return
                while self.pause_event.is_set() and not self.stop_event.is_set():
                    time.sleep(0.08)
                status, body = post_json(
                    opener,
                    target,
                    "/api/login",
                    {"mode": "secure", "username": student_id, "password": generate_password(rng)},
                    timeout=2.5
                )
                self.events.put(("attempt", (student_id, attempt, status, body)))
                time.sleep(interval)
            self.events.put(("complete", None))
        except (URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError, HTTPError) as error:
            self.events.put(("error", f"TestLocker 실패: {error}"))

    def unlock_all(self) -> None:
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("EveryLock", "현재 실행 중인 작업을 먼저 중지하세요.", parent=self.root)
            return
        try:
            target = validate_target(self.target_url_var.get())
        except (ValueError, TypeError) as error:
            messagebox.showerror("대상 오류", str(error), parent=self.root)
            return
        threading.Thread(target=self._unlock_all_worker, args=(target,), daemon=True).start()

    def _unlock_all_worker(self, target: str) -> None:
        try:
            opener = build_opener(NoRedirect())
            _, data = post_json(opener, target, "/api/lockout/unlock-all", {}, timeout=3.0)
            self.events.put(("unlocked", data))
        except (URLError, TimeoutError, json.JSONDecodeError, ValueError, HTTPError) as error:
            self.events.put(("error", f"전체 잠금 해제 실패: {error}"))

    def export_log(self) -> None:
        path = filedialog.asksaveasfilename(
            parent=self.root,
            title="EveryLock 로그 내보내기",
            defaultextension=".json",
            filetypes=[("JSON report", "*.json")],
            initialfile="everylock-report.json",
        )
        if not path:
            return
        report = {
            "exported_at": datetime.now().isoformat(),
            "target": self.current_target,
            "configuration": self.last_config,
            "processed_events": self.processed,
            "total_planned": self.total_planned,
            "locked_accounts": [
                {"student_id": values[0], "failures": values[1], "locked_at": values[2]}
                for item in self.locked_tree.get_children()
                if (values := self.locked_tree.item(item, "values"))
            ],
            "console": self.terminal.get("1.0", "end-1c").splitlines(),
            "disclaimer": "Smart URL Attack Simulation Report",
        }
        with open(path, "w", encoding="utf-8") as file:
            json.dump(report, file, ensure_ascii=False, indent=2)
        self._log(f"Report exported: {path}", "system")

    def clear_console(self) -> None:
        self.terminal.configure(state="normal")
        self.terminal.delete("1.0", "end")
        self.terminal.configure(state="disabled")
        self._log("Console cleared", "system")

    def _reset_worker(self, target: str) -> None:
        try:
            opener = build_opener(NoRedirect())
            account_ids = generate_weighted_student_ids(100, "202601----", 90, 2026)
            _, data = post_json(opener, target, "/api/lockout/reset", {"accountIds": account_ids}, timeout=3.0)
            self.events.put(("reset", data))
        except (URLError, TimeoutError, json.JSONDecodeError, ValueError, HTTPError) as error:
            self.events.put(("error", f"대상 서버 연결 실패: {error}"))

    def _attack_worker(self, config: tuple[str, int, int, int, int, str, int]) -> None:
        target, users, attempts, rate, seed, pattern, chance = config
        opener = build_opener(NoRedirect())
        rng = random.Random(seed ^ 0xE10C)
        try:
            account_ids = generate_weighted_student_ids(users, pattern, chance, seed)
            _, data = post_json(opener, target, "/api/lockout/reset", {"accountIds": account_ids}, timeout=3.0)
            self.events.put(("initialized", (data, attempts, target, pattern, chance)))
            interval = 1.0 / rate
            last_request = time.perf_counter() - interval
            for round_number in range(1, attempts + 1):
                for student_id in account_ids:
                    if self.stop_event.is_set():
                        self.events.put(("stopped", None))
                        return
                    while self.pause_event.is_set() and not self.stop_event.is_set():
                        time.sleep(0.08)
                    wait = interval - (time.perf_counter() - last_request)
                    if wait > 0:
                        time.sleep(wait)
                    password = generate_password(rng)
                    try:
                        status, body = post_json(
                            opener,
                            target,
                            "/api/login",
                            {"mode": "secure", "username": student_id, "password": password},
                            timeout=2.5
                        )
                    except Exception:
                        status, body = 500, {"failedAttempts": round_number}
                    last_request = time.perf_counter()
                    self.events.put(("attempt", (student_id, round_number, status, body)))
            self.events.put(("complete", None))
        except (URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError, HTTPError) as error:
            self.events.put(("error", f"대상 서버 연결 실패: {error}"))

    def _drain_events(self) -> None:
        try:
            while True:
                event, payload = self.events.get_nowait()
                if event == "initialized":
                    data, attempts, target, pattern, chance = payload
                    self.account_ids = [account["userId"] for account in data.get("accounts", [])]
                    self.failed = {student_id: 0 for student_id in self.account_ids}
                    self.total_planned = len(self.account_ids) * attempts
                    self.started_at = time.perf_counter()
                    self.metric_total.configure(text=f"{len(self.account_ids):,}")
                    self.metric_active.configure(text=f"{len(self.account_ids):,}")
                    self.progress_label.configure(text=f"0 / {self.total_planned:,} EVENTS")
                    self.state_label.configure(text="RUNNING", fg=self.GREEN)
                    self.connection_label.configure(text="● TARGET SERVER CONNECTED", fg=self.GREEN)
                    self.current_target = target
                    self.target_header_label.configure(text=target.removeprefix("http://").removeprefix("https://"))
                    self.last_config = {"accounts": len(self.account_ids), "attempts": attempts, "pattern": pattern, "chance_percent": chance}
                    self._log(f"Target initialized: target={target}", "system")
                    self._log(f"Generated {len(self.account_ids)} synthetic student IDs · chance={pattern}@{chance}%", "event")
                    self._log("Password rule=[A-Za-z0-9]{8} · values are not stored", "event")
                    self._log("Attack simulation started", "system")
                    self._draw_account_map()
                elif event == "attempt":
                    student_id, round_number, status, body = payload
                    self.processed += 1
                    self.failed[student_id] = int(body.get("failedAttempts", round_number))
                    if status == 423 and student_id not in self.locked:
                        self.locked.add(student_id)
                        locked_at = datetime.now().strftime("%H:%M:%S")
                        self.locked_tree.insert("", "end", values=(student_id, "10/10", locked_at))
                        self._log(f"{student_id} Lock Success!", "success")
                    if self.processed % max(1, self.total_planned // 10) == 0:
                        self._log(f"Progress {self.processed}/{self.total_planned} · locked={len(self.locked)}", "system")
                    self._update_metrics()
                elif event == "complete":
                    elapsed = time.perf_counter() - self.started_at
                    self.state_label.configure(text="COMPLETE", fg=self.CYAN)
                    self._log(f"Simulation complete · locked={len(self.locked)} · elapsed={elapsed:.2f}s", "complete")
                elif event == "stopped":
                    self.state_label.configure(text="STOPPED", fg=self.AMBER)
                    self._log("Simulation stopped", "system")
                elif event == "reset":
                    self._clear_results()
                    self.account_ids = [account["userId"] for account in payload.get("accounts", [])]
                    self.failed = {student_id: 0 for student_id in self.account_ids}
                    self.metric_total.configure(text=f"{len(self.account_ids):,}")
                    self.metric_active.configure(text=f"{len(self.account_ids):,}")
                    self.state_label.configure(text="STANDBY", fg=self.GREEN)
                    self.connection_label.configure(text="● TARGET SERVER CONNECTED", fg=self.GREEN)
                    self._log("Target lab state reset", "system")
                    self._draw_account_map()
                elif event == "connection":
                    target, status, data = payload
                    self.current_target = target
                    self.target_header_label.configure(text=target.removeprefix("http://").removeprefix("https://"))
                    self.connection_label.configure(text=f"● CONNECTED / HTTP {status}", fg=self.GREEN)
                    self._log(f"Connection OK: {target} · accounts={data.get('totalAccounts', 0)}", "system")
                elif event == "unlocked":
                    self.locked.clear()
                    self.failed = {student_id: 0 for student_id in self.account_ids}
                    for item in self.locked_tree.get_children():
                        self.locked_tree.delete(item)
                    self.metric_active.configure(text=f"{len(self.account_ids):,}")
                    self.metric_locked.configure(text="0")
                    self.metric_availability.configure(text="100.00%")
                    self._draw_account_map()
                    self._log(f"Unlock All complete · active={payload.get('activeAccounts', 0)}", "complete")
                elif event == "error":
                    self.state_label.configure(text="ERROR", fg=self.RED)
                    self.connection_label.configure(text="● SERVER OFFLINE", fg=self.RED)
                    self._log(str(payload), "success")
                    messagebox.showerror("EveryLock", str(payload), parent=self.root)
        except queue.Empty:
            pass
        self.root.after(80, self._drain_events)

    def _update_metrics(self) -> None:
        total = len(self.account_ids)
        locked = len(self.locked)
        active = max(0, total - locked)
        availability = (active / total * 100) if total else 100.0
        self.metric_active.configure(text=f"{active:,}")
        self.metric_locked.configure(text=f"{locked:,}")
        self.metric_availability.configure(text=f"{availability:.2f}%")
        percentage = (self.processed / self.total_planned * 100) if self.total_planned else 0
        self.progress["value"] = percentage
        self.progress_label.configure(text=f"{self.processed:,} / {self.total_planned:,} EVENTS")
        if self.processed % max(1, total // 4) == 0 or locked:
            self._draw_account_map()

    def _draw_account_map(self) -> None:
        if not hasattr(self, "account_canvas"):
            return
        self.account_canvas.delete("all")
        count = len(self.account_ids) or 100
        width = max(300, self.account_canvas.winfo_width())
        columns = min(50, max(10, int(width / 17)))
        gap = 3
        cell = max(5, min(12, int((width - 22 - (columns - 1) * gap) / columns)))
        for index in range(min(count, 500)):
            row, column = divmod(index, columns)
            x1 = 10 + column * (cell + gap)
            y1 = 7 + row * (cell + gap)
            student_id = self.account_ids[index] if index < len(self.account_ids) else ""
            locked = student_id in self.locked
            fill = "#68202b" if locked else "#153e25"
            outline = self.RED if locked else "#267b45"
            self.account_canvas.create_rectangle(x1, y1, x1 + cell, y1 + cell, fill=fill, outline=outline)

    def _clear_results(self) -> None:
        self.processed = 0
        self.total_planned = 0
        self.account_ids = []
        self.failed = {}
        self.locked = set()
        self.progress["value"] = 0
        self.progress_label.configure(text="0 / 0 EVENTS")
        self.metric_total.configure(text="0")
        self.metric_active.configure(text="0")
        self.metric_locked.configure(text="0")
        self.metric_availability.configure(text="100.00%")
        for item in self.locked_tree.get_children():
            self.locked_tree.delete(item)
        self.terminal.configure(state="normal")
        self.terminal.delete("1.0", "end")
        self.terminal.configure(state="disabled")
        self._draw_account_map()

    def _log(self, message: str, tag: str = "event") -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.terminal.configure(state="normal")
        self.terminal.insert("end", f"[{timestamp}] {message}\n", tag)
        self.terminal.see("end")
        self.terminal.configure(state="disabled")

    def close(self) -> None:
        self.stop_event.set()
        self.root.destroy()


def self_test() -> int:
    rng = random.Random(2026)
    passwords = [generate_password(rng) for _ in range(100)]
    assert all(len(value) == 8 and value.isalnum() and value.isascii() for value in passwords)
    
    assert validate_target("http://127.0.0.1:4173") == "http://127.0.0.1:4173"
    assert validate_target("localhost:4173") == "http://localhost:4173"
    for unsafe_target in ("http://192.168.1.50:4173", "https://example.com"):
        try:
            validate_target(unsafe_target)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe target accepted: {unsafe_target}")

    accounts = generate_weighted_student_ids(100, "202601----", 90, 2026)
    matcher = pattern_regex("202601----")
    assert len(accounts) == 100
    assert len(set(accounts)) == 100
    assert sum(bool(matcher.fullmatch(student_id)) for student_id in accounts) == 90
    assert all(STUDENT_ID_RE.fullmatch(student_id) for student_id in accounts)
    print("EveryLock GUI Smart-URL self-test: OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--self-test", action="store_true")
    args, _ = parser.parse_known_args()
    if args.self_test:
        return self_test()
    root = tk.Tk()
    EveryLockApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
