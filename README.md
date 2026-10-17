# EveryLock

EveryLock은 계정 잠금 정책이 정상 사용자 가용성에 미치는 영향을 연구하기 위한 **로컬 전용 교육용 시뮬레이터**다. 실제 계정이나 외부 인증 서버를 대상으로 하지 않으며, 모든 계정과 이벤트는 합성 데이터다.

## 연구 배경

관찰 단계에서는 인증 오류 문구에 실패 횟수가 표시되는 경우와 표시되지 않는 경우가 확인됐다. 동일 조건에서 이 차이가 반복된다면 계정 존재 여부가 노출될 수 있어 CWE-204/CWE-203 후보로 볼 수 있다. 또한 실패 횟수 초과 안내는 CWE-645 관점의 가용성 위험 가설을 제시한다.

이 기록만으로 실제 계정 열거, 정상 사용자의 로그인 차단, 잠금 지속시간 또는 대규모 서비스 거부 가능성이 입증된 것은 아니다. 실서비스 추가 검증은 시스템 소유자의 서면 승인과 전용 테스트 계정이 있을 때만 수행해야 한다.

## 구성

- `everylock/`: FastAPI 기반 정책 A/B 비교 대시보드와 CSV/JSON 보고서
- `local-lab/`: Node.js 기반 가상 포털, 관리자 화면, 테스트 도구
- `browser-extension/`: Everylock Attack 크롬 확장 버전
- `SECURITY.md`: 사용 범위와 제보 원칙

## 실행

### FastAPI 시뮬레이터

```powershell
cd everylock
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

브라우저에서 `http://127.0.0.1:8000`을 연다.

### 로컬 포털 랩

```powershell
cd local-lab
node server.mjs
```

브라우저에서 `http://127.0.0.1:4173`을 연다. 테스트는 `node test.mjs`로 실행한다.

## 연구 한계와 윤리

- 화면 관찰은 서버 내부 구현이나 취약점의 확정 증거가 아니다.
- 합성 학번은 실제 사용자와 연결되지 않는다.
- 오류 응답은 통일하고, 잠금·속도 제한·추가 인증·복구 절차를 함께 평가해야 한다.
- 스크린샷과 보고서에는 학번, 비밀번호, 쿠키, 세션 값 등 개인정보를 포함하지 않는다.

> 본 결과는 격리된 가상 환경에서 수행한 시뮬레이션이며, 실제 운영 시스템의 대규모 공격 가능성을 입증하지 않는다.

## 참고 노션 포트폴리오

- https://app.notion.com/p/aviniy/EveryLock-Project-3fc5747616b28166b6c8d93de1ddb2b2?source=copy_link
