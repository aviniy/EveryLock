import json

from models import PolicyName, SimulationConfig
from simulation import DISCLAIMER, SimulationEngine


def make_engine() -> SimulationEngine:
    return SimulationEngine(
        SimulationConfig(user_count=100, failure_events=1000, lock_threshold=3, events_per_second=100, seed=42)
    )


def test_same_seed_reproduces_policy_a_results() -> None:
    first, second = make_engine(), make_engine()
    first.process_batch(1000)
    second.process_batch(1000)
    assert first.snapshot()["policy_a"] == second.snapshot()["policy_a"]
    assert [a.failed_attempts for a in first.policy_a.accounts] == [a.failed_attempts for a in second.policy_a.accounts]


def test_policy_comparison_and_completion() -> None:
    engine = make_engine()
    processed = engine.process_batch(1000)
    status = engine.snapshot()
    assert processed == 1000
    assert status["state"] == "completed"
    assert status["progress"] == 100
    assert status["policy_a"]["locked_accounts"] > 0
    assert status["policy_b"]["locked_accounts"] == 0
    assert status["policy_b"]["verification_events"] > 0


def test_unlock_and_exports() -> None:
    engine = SimulationEngine(SimulationConfig(user_count=100, failure_events=10, lock_threshold=1, seed=4))
    engine.process_batch(1)
    locked = next(account for account in engine.policy_a.accounts if account.account_status.value == "LOCKED")
    assert engine.unlock(locked.user_id, PolicyName.A)
    assert json.loads(engine.export_json())["disclaimer"] == DISCLAIMER
    assert "metric,policy_a,policy_b" in engine.export_csv()
