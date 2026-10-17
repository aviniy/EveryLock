"""EveryLock domain models.

All records are synthetic and exist only inside the local simulator process.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


class AccountStatus(StrEnum):
    ACTIVE = "ACTIVE"
    LOCKED = "LOCKED"


class PolicyName(StrEnum):
    A = "A"
    B = "B"


@dataclass(slots=True)
class VirtualAccount:
    user_id: str
    password_hash: str
    failed_attempts: int = 0
    account_status: AccountStatus = AccountStatus.ACTIVE
    lock_timestamp: str | None = None
    delay_seconds: int = 0
    verification_required: bool = False

    def public(self) -> dict[str, object]:
        """Return non-sensitive UI data. Password hashes never leave the backend."""
        return {
            "user_id": self.user_id,
            "failed_attempts": self.failed_attempts,
            "account_status": self.account_status.value,
            "delay_seconds": self.delay_seconds,
            "verification_required": self.verification_required,
        }


@dataclass(slots=True)
class SimulationEvent:
    timestamp: str
    event_type: str
    virtual_user_id: str
    policy: str
    result: str

    @classmethod
    def create(cls, event_type: str, user_id: str, policy: str, result: str) -> "SimulationEvent":
        return cls(
            timestamp=datetime.now(timezone.utc).isoformat(),
            event_type=event_type,
            virtual_user_id=user_id,
            policy=policy,
            result=result,
        )


@dataclass(slots=True)
class PolicyMetrics:
    locked_accounts: int = 0
    denied_events: int = 0
    verification_events: int = 0
    delayed_events: int = 0


@dataclass(slots=True)
class HistoryPoint:
    event_count: int
    locked_a: int
    locked_b: int
    active_a: int
    active_b: int


@dataclass(slots=True)
class SimulationConfig:
    user_count: int = 1000
    failure_events: int = 10000
    lock_threshold: int = 10
    events_per_second: int = 100
    seed: int = 2026

    def validate(self) -> None:
        if not 100 <= self.user_count <= 10_000:
            raise ValueError("가상 사용자 수는 100~10,000명이어야 합니다.")
        if not 1 <= self.failure_events <= 1_000_000:
            raise ValueError("실패 이벤트 수는 1~1,000,000이어야 합니다.")
        if not 1 <= self.lock_threshold <= 100:
            raise ValueError("잠금 임계값은 1~100이어야 합니다.")
        if not 1 <= self.events_per_second <= 10_000:
            raise ValueError("진행 속도는 초당 1~10,000 이벤트여야 합니다.")


@dataclass(slots=True)
class PolicyState:
    accounts: list[VirtualAccount] = field(default_factory=list)
    metrics: PolicyMetrics = field(default_factory=PolicyMetrics)
