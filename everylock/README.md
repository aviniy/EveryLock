# EveryLock

EveryLock은 **CWE-645: Overly Restrictive Account Lockout Mechanism**을 교육 목적으로 연구하는 로컬 전용 시뮬레이터입니다. 동일한 가상 인증 실패 이벤트를 하드 잠금 정책(Policy A)과 적응형 방어 정책(Policy B)에 적용하여 계정 잠금, 인증 마찰, 서비스 가용성의 차이를 비교합니다.

> 본 결과는 격리된 가상 환경에서 수행한 시뮬레이션이며, 실제 운영 시스템의 대규모 공격 가능성을 입증하지 않는다.

## 안전 범위

- 서버는 기본적으로 `127.0.0.1`에만 바인딩됩니다.
- 외부 사이트 로그인, 실제 인증 시스템 연동, 프록시 사용, 요청 제한 우회 기능이 없습니다.
- 시뮬레이션은 HTTP 로그인 요청을 만들지 않고 Python 메모리의 가상 계정 상태만 바꿉니다.
- 가상 식별자는 `2026SIM-00001`처럼 `SIM` 표식을 포함하여 실제 학번과 혼동되지 않습니다.
- 원본 비밀번호는 저장·표시·기록하지 않으며 이벤트 로그에도 비밀번호나 해시가 포함되지 않습니다.
- Chart.js는 `static/vendor`에 로컬 포함되어 실행 중 CDN 요청이 발생하지 않습니다.

## 정책 모델

| 정책 | 동작 | 모델의 비용 |
|---|---|---|
| Policy A | 임계값 도달 시 계정 하드 잠금, 관리자 해제 필요 | 계정 가용성 저하 |
| Policy B | 단계적 지연, 임계값 이후 추가 인증 요구, 하드 잠금 없음 | 지연 및 추가 인증 마찰 |

Policy B가 항상 우수하다고 가정하지 않습니다. 대시보드는 잠금 수뿐 아니라 거부 이벤트, 지연, 추가 인증 횟수를 함께 표시합니다. 이 연구 모델은 실제 위험 엔진을 구현한 것이 아니라 방어 설계의 트레이드오프를 보여주는 단순화된 모형입니다.

## 설치

Python 3.12 이상이 필요합니다. PowerShell에서:

```powershell
cd "C:\Users\aviniy\Documents\잡 프로젝트\cju-portal-security-project\everylock"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## 실행

```powershell
python main.py
```

브라우저에서 <http://127.0.0.1:8000>을 엽니다. LAN 전체에 노출되는 `0.0.0.0` 바인딩은 사용하지 마세요.

대시보드에서 사용자 수(100~10,000명), 실패 이벤트 수, 잠금 임계값, 진행 속도, 랜덤 시드를 설정할 수 있습니다. 시작·일시정지·초기화·단일 단계 실행을 지원하며 CSV/JSON 보고서를 내려받을 수 있습니다.

## 테스트

```powershell
python -m pytest -q
```

테스트는 비밀번호 해시 검증, 계정 잠금과 해제, Policy A/B 동작, 시드 재현성, 보고서 내보내기를 확인합니다.

## 구조

```text
everylock/
├── main.py              # FastAPI 앱 및 로컬 API
├── simulation.py        # 재현 가능한 내부 이벤트 엔진과 보고서
├── auth.py              # 가상 계정, 해시, 로컬 인증 도우미
├── policies.py          # Policy A/B 처리 로직
├── models.py            # 데이터 모델
├── requirements.txt
├── templates/index.html # 한국어 대시보드
├── static/
│   ├── style.css
│   ├── app.js
│   └── vendor/chart.umd.js
├── tests/
│   ├── test_auth.py
│   ├── test_simulation.py
│   └── test_policies.py
└── reports/             # 사용자가 저장할 보고서 디렉터리
```

## API 요약

- `GET /api/status` — 현재 상태 및 차트 데이터
- `POST /api/start`, `/api/pause`, `/api/reset`, `/api/step` — 실행 제어
- `POST /api/unlock` — 가상 관리자 해제
- `GET /api/report` — 구조화된 결과 보고서
- `GET /api/export/json`, `/api/export/csv` — 결과 다운로드

API 문서는 실행 후 <http://127.0.0.1:8000/docs>에서 확인할 수 있습니다.
