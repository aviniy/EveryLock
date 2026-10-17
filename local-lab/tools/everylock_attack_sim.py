#!/usr/bin/env python3
"""EveryLock localhost-only account lockout request simulator."""

from __future__ import annotations

import argparse
import json
import random
import re
import string
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


DEFAULT_TARGET = "http://127.0.0.1:4173"
STUDENT_ID_PATTERN = re.compile(r"^(2023|2024|2025|2026)\d{6}$")
PASSWORD_ALPHABET = string.ascii_letters + string.digits


class NoRedirect(HTTPRedirectHandler):
    """Prevent unexpected redirection off the specified target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


@dataclass(slots=True)
class Result:
    target: str
    seed: int
    virtual_users: int
    attempts_per_user: int
    total_requests: int = 0
    invalid_credentials: int = 0
    locked_responses: int = 0
    successful_responses: int = 0
    transport_errors: int = 0
    duration_seconds: float = 0.0


def validate_target(value: str) -> str:
    """Accept only an HTTP loopback origin used by the isolated lab."""
    raw = value.strip()
    if not raw:
        raise argparse.ArgumentTypeError("대상 URL을 입력해주세요.")
    if "://" not in raw:
        raw = "http://" + raw
    parsed = urlparse(raw)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise argparse.ArgumentTypeError("격리된 실습을 위해 HTTP loopback 호스트만 허용됩니다.")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise argparse.ArgumentTypeError("경로·쿼리·자격 증명이 없는 loopback origin만 입력하세요.")
    port = parsed.port or 4173
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    return f"http://{host}:{port}"


def bounded_int(minimum: int, maximum: int):
    def parse(value: str) -> int:
        number = int(value)
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"{minimum}~{maximum} 범위만 허용됩니다.")
        return number

    return parse


def generate_student_ids(count: int, seed: int) -> list[str]:
    """Generate unique, deterministic IDs matching YYYY + six digits."""
    rng = random.Random(seed)
    years = (2026, 2025, 2024, 2023)
    generated: set[str] = set()
    while len(generated) < count:
        generated.add(f"{rng.choice(years)}{rng.randrange(1_000_000):06d}")
    return sorted(generated)


def generate_password(rng: random.Random) -> str:
    return "".join(rng.choices(PASSWORD_ALPHABET, k=8))


def post_json(opener, url: str, payload: dict[str, Any], timeout: float = 3.0) -> tuple[int, dict[str, Any]]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "EveryLock-Simulator/1.0",
        },
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            raw_data = response.read().decode("utf-8")
            if not raw_data.strip():
                return response.status, {}
            return response.status, json.loads(raw_data)
    except HTTPError as error:
        try:
            response_body = error.read().decode("utf-8")
            parsed_body = json.loads(response_body)
        except (json.JSONDecodeError, AttributeError):
            parsed_body = {"message": str(error)}
        return error.code, parsed_body
    except (URLError, TimeoutError, TimeoutError) as error:
        raise error


def run_simulation(args: argparse.Namespace) -> Result:
    target = validate_target(args.target)
    student_ids = generate_student_ids(args.users, args.seed)
    password_rng = random.Random(args.seed ^ 0xE10C)
    result = Result(target, args.seed, args.users, args.attempts)
    opener = build_opener(NoRedirect())

    if args.reset_lab:
        try:
            post_json(opener, f"{target}/api/lockout/reset", {"accountCount": 10})
        except Exception as e:
            print(f"[WARNING] 랩 초기화 요청 실패 (서버 오프라인 가능성): {e}", file=sys.stderr)

    if args.dry_run:
        print("[DRY RUN] 네트워크 요청을 전송하지 않습니다.")
        print(f"대상: {target}/api/login")
        print(f"가상 학번 예시: {', '.join(student_ids[:5])}")
        print("비밀번호 형식: 영문 대/소문자 + 숫자, 8자리 (값은 출력·저장하지 않음)")
        return result

    interval = 1.0 / args.rate
    started = time.perf_counter()
    last_request_at = started - interval
    total_planned = args.users * args.attempts

    for attempt in range(1, args.attempts + 1):
        for index, student_id in enumerate(student_ids, start=1):
            elapsed = time.perf_counter() - last_request_at
            if elapsed < interval:
                time.sleep(interval - elapsed)

            password = generate_password(password_rng)
            try:
                status, response = post_json(
                    opener,
                    f"{target}/api/login",
                    {"mode": "secure", "username": student_id, "password": password},
                    timeout=2.5
                )
                result.total_requests += 1
                if status == 401:
                    result.invalid_credentials += 1
                elif status == 423 or response.get("accountStatus") == "LOCKED":
                    result.locked_responses += 1
                elif status == 200:
                    result.successful_responses += 1
            except Exception as error:
                result.transport_errors += 1
                if args.verbose:
                    print(f"[ERROR] 요청 실패 ({student_id}): {error}", file=sys.stderr)
            finally:
                last_request_at = time.perf_counter()

            completed = (attempt - 1) * args.users + index
            if args.verbose or completed == total_planned or completed % max(1, total_planned // 10) == 0:
                print(
                    f"[{completed:>5}/{total_planned}] "
                    f"round={attempt} locked={result.locked_responses} errors={result.transport_errors}"
                )

    result.duration_seconds = round(time.perf_counter() - started, 3)
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="EveryLock localhost 전용 계정 잠금 요청 시뮬레이터"
    )
    parser.add_argument("--target", type=str, default=DEFAULT_TARGET, help="loopback URL (기본 http://127.0.0.1:4173)")
    parser.add_argument("--users", type=bounded_int(1, 1000), default=100, help="가상 학번 수 (기본 100)")
    parser.add_argument("--attempts", type=bounded_int(1, 10), default=10, help="계정당 실패 횟수 (최대 10)")
    parser.add_argument("--rate", type=bounded_int(1, 100), default=20, help="초당 최대 요청 수 (최대 100)")
    parser.add_argument("--seed", type=int, default=2026, help="재현 가능한 난수 시드")
    parser.add_argument("--reset-lab", action="store_true", help="실행 전 잠금 상태 초기화")
    parser.add_argument("--dry-run", action="store_true", help="생성 규칙만 확인하고 요청하지 않음")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--output", type=Path, help="요약 JSON 저장 경로")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = run_simulation(args)
    except Exception as e:
        print(f"[FATAL] 시뮬레이션 실행 중 오류 발생: {e}", file=sys.stderr)
        return 1
    summary = asdict(result)
    print("\n=== EveryLock 시뮬레이션 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"요약 저장: {args.output.resolve()}")
    return 0 if result.transport_errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
