"""Deterministic, in-memory account lockout simulation engine."""

from __future__ import annotations

import csv
import io
import json
import random
import threading
from dataclasses import asdict

from auth import admin_unlock, generate_accounts
from models import HistoryPoint, PolicyName, PolicyState, SimulationConfig, SimulationEvent
from policies import apply_policy_a, apply_policy_b


DISCLAIMER = (
    "본 결과는 격리된 가상 환경에서 수행한 시뮬레이션이며, 실제 운영 시스템의 "
    "대규모 공격 가능성을 입증하지 않는다."
)


class SimulationEngine:
    def __init__(self, config: SimulationConfig | None = None) -> None:
        self._mutex = threading.RLock()
        self.config = config or SimulationConfig()
        self.running = False
        self.paused = False
        self.completed = False
        self.event_count = 0
        self.logs: list[SimulationEvent] = []
        self.history: list[HistoryPoint] = []
        self.reset(self.config)

    def reset(self, config: SimulationConfig | None = None) -> None:
        with self._mutex:
            if config is not None:
                config.validate()
                self.config = config
            base = generate_accounts(self.config.user_count, self.config.seed)
            # Both policies receive equivalent initial accounts and the same event stream.
            self.policy_a = PolicyState(accounts=base)
            self.policy_b = PolicyState(accounts=generate_accounts(self.config.user_count, self.config.seed))
            self._rng = random.Random(self.config.seed)
            self.running = False
            self.paused = False
            self.completed = False
            self.event_count = 0
            self.logs = []
            self.history = [HistoryPoint(0, 0, 0, self.config.user_count, self.config.user_count)]

    def process_batch(self, amount: int) -> int:
        with self._mutex:
            remaining = self.config.failure_events - self.event_count
            amount = max(0, min(amount, remaining))
            for _ in range(amount):
                index = self._rng.randrange(self.config.user_count)
                account_a = self.policy_a.accounts[index]
                account_b = self.policy_b.accounts[index]
                self.logs.append(SimulationEvent.create("SIMULATION", account_a.user_id, "BOTH", "AUTHENTICATION_FAILURE"))
                self.logs.extend(apply_policy_a(account_a, self.config.lock_threshold, self.policy_a.metrics))
                self.logs.extend(apply_policy_b(account_b, self.config.lock_threshold, self.policy_b.metrics))
                self.event_count += 1
            if amount:
                self._record_history()
            if self.event_count >= self.config.failure_events:
                self.running = False
                self.paused = False
                self.completed = True
            return amount

    def _record_history(self) -> None:
        locked_a = self.policy_a.metrics.locked_accounts
        locked_b = self.policy_b.metrics.locked_accounts
        self.history.append(
            HistoryPoint(
                self.event_count,
                locked_a,
                locked_b,
                self.config.user_count - locked_a,
                self.config.user_count - locked_b,
            )
        )
        if len(self.history) > 300:
            self.history = [self.history[0], *self.history[-299:]]

    def unlock(self, user_id: str, policy: PolicyName) -> bool:
        with self._mutex:
            state = self.policy_a if policy == PolicyName.A else self.policy_b
            account = next((item for item in state.accounts if item.user_id == user_id), None)
            if account is None:
                return False
            was_locked = account.account_status.value == "LOCKED"
            admin_unlock(account)
            if was_locked:
                state.metrics.locked_accounts = max(0, state.metrics.locked_accounts - 1)
            self.logs.append(SimulationEvent.create("RECOVERY", user_id, policy.value, "ACCOUNT_UNLOCKED"))
            return True

    def snapshot(self) -> dict[str, object]:
        with self._mutex:
            total = self.config.user_count

            def metrics(state: PolicyState) -> dict[str, object]:
                locked = state.metrics.locked_accounts
                active = total - locked
                return {
                    "total_accounts": total,
                    "active_accounts": active,
                    "locked_accounts": locked,
                    "lockout_rate": round(locked / total * 100, 2),
                    "availability_rate": round(active / total * 100, 2),
                    "denied_events": state.metrics.denied_events,
                    "verification_events": state.metrics.verification_events,
                    "delayed_events": state.metrics.delayed_events,
                }

            return {
                "state": "completed" if self.completed else "running" if self.running else "paused" if self.paused else "idle",
                "event_count": self.event_count,
                "progress": round(self.event_count / self.config.failure_events * 100, 2),
                "config": asdict(self.config),
                "policy_a": metrics(self.policy_a),
                "policy_b": metrics(self.policy_b),
                "accounts": {
                    "A": [account.public() for account in self.policy_a.accounts[:500]],
                    "B": [account.public() for account in self.policy_b.accounts[:500]],
                    "display_limited": total > 500,
                },
                "history": [asdict(point) for point in self.history],
                "recent_logs": [asdict(event) for event in self.logs[-80:]],
                "disclaimer": DISCLAIMER,
            }

    def report(self) -> dict[str, object]:
        data = self.snapshot()
        return {
            "research_purpose": "계정 잠금 정책 악용이 정상 사용자 서비스 가용성에 미치는 영향 연구",
            "environment": "127.0.0.1 전용, 내부 메모리 기반 가상 인증 환경",
            "virtual_user_count": self.config.user_count,
            "authentication_policies": {
                "A": "임계값 도달 시 관리자 해제 전까지 계정 잠금",
                "B": "단계적 지연, 위험 기반 추가 인증, 안전한 복구를 가정한 적응형 정책",
            },
            "simulation_result": {
                "processed_failure_events": self.event_count,
                "policy_a": data["policy_a"],
                "policy_b": data["policy_b"],
            },
            "availability_impact": "정책별 활성 계정 비율과 거부 이벤트 수를 함께 비교해야 한다.",
            "defense_comparison": "Policy B는 하드 잠금을 줄이지만 지연 및 추가 인증 마찰을 발생시킨다.",
            "limitations": [
                "실제 사용자 행동, 네트워크, 분산 공격 인프라를 모델링하지 않는다.",
                "가상 실패 이벤트를 균등 무작위로 배분한 단순화된 모델이다.",
                "결과는 실제 대학 포털의 보안 상태를 나타내지 않는다.",
            ],
            "conclusion": "잠금 임계값만으로 방어하면 가용성 저하가 커질 수 있어 다층 통제가 필요하다.",
            "seed": self.config.seed,
            "disclaimer": DISCLAIMER,
        }

    def export_json(self) -> str:
        return json.dumps(self.report(), ensure_ascii=False, indent=2)

    def export_csv(self) -> str:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["metric", "policy_a", "policy_b"])
        snapshot = self.snapshot()
        for key in ("locked_accounts", "lockout_rate", "availability_rate", "denied_events", "verification_events", "delayed_events"):
            writer.writerow([key, snapshot["policy_a"][key], snapshot["policy_b"][key]])
        writer.writerow(["processed_failure_events", self.event_count, self.event_count])
        writer.writerow(["seed", self.config.seed, self.config.seed])
        writer.writerow(["disclaimer", DISCLAIMER, DISCLAIMER])
        return output.getvalue()
