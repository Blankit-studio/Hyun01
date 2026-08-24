# 🛠️ Weekly 유지보수 가이드

주간 시간표 공유 & 예약 사이트(`Blankit-studio/Schedule`)를 앞으로 직접 수정·운영하기 위한 문서입니다.

- **사이트**: https://blankit-studio.github.io/Schedule/
- **구조**: 정적 사이트(HTML/CSS/JS) + Firebase(Google/익명 인증 + Firestore)
- **배포**: GitHub Pages (브랜치에 push → 1~2분 뒤 자동 반영)

---

## 1. 파일 지도 (어디를 고치면 되나)

| 파일 | 담당 |
|------|------|
| `index.html` | 페이지 골격, 헤더/로고/테마 토글, CSS·JS 링크(`?v=` 캐시 버전) |
| `styles.css` | 색상 팔레트(`:root`), 다크/라이트, 그리드·모달 스타일 |
| `app.js` | 전부의 로직 — 인증, 라우팅, 시간표, 예약, 드래그, 시간 범위 |
| `firebase-config.js` | Firebase 프로젝트 연결값 (웹 공개용 값) |
| `firestore.rules` | Firestore 보안 규칙 (콘솔에 별도 게시 필요) |
| `logo.svg` | 파비콘/로고 |
| `firebase.json`, `.firebaserc` | Firebase 배포 설정 (Hosting + Firestore 규칙) |
| `deploy-rules.sh` | **보안 규칙 한 줄 배포** 스크립트 |

### app.js 안에서 자주 찾는 지점 (상단 상수)
```js
const DAYS = ["월","화","수","목","금","토","일"];  // 요일
const START_HOUR = 0, END_HOUR = 24;                // 전체 시간 범위(격자 원본)
const MARKS = ["📌","✅","⭐","❤️","🔥","☕","🎯","💬"]; // 예약 마크 이모지
const VISIBILITY = { public, unlisted, private };    // 공개 범위 라벨
```

---

## 2. 코드 수정 → 배포 절차 (매번 동일)

```bash
# 0) 최신화
git checkout claude/eloquent-planck-v8r4dm
git pull

# 1) 파일 수정 후 문법 확인 (권장)
node --check app.js

# 2) 캐시 무효화: 바꾼 파일의 버전 숫자를 올린다 (아래 3번 참고)

# 3) 커밋 & 푸시
git add -A
git commit -m "무엇을 바꿨는지 한 줄"
git push -u origin claude/eloquent-planck-v8r4dm
```

> **⚠️ git 원격 경고**: push 때 `This repository moved ... Schedule.git` 문구가 뜨는 건 저장소 이름이 `Hyun01→Schedule`로 바뀐 흔적이며, push는 정상 처리됩니다. 없애려면 한 번만:
> ```bash
> git remote set-url origin https://github.com/Blankit-studio/Schedule.git
> ```

---

## 3. 캐시 관리 (⭐ 매우 중요)

브라우저가 `styles.css`/`app.js`를 캐시하기 때문에, **파일을 바꿨는데 화면이 그대로면 십중팔구 캐시 문제**입니다. 그래서 `index.html`에서 링크에 버전 쿼리를 붙여 씁니다.

```html
<link rel="stylesheet" href="styles.css?v=8" />
<script type="module" src="app.js?v=9"></script>
```

**규칙: `styles.css`를 바꾸면 그 `?v=` 숫자를 +1, `app.js`를 바꾸면 그 숫자를 +1.** (두 숫자는 서로 독립적으로 올려도 됩니다.)

```bash
# 예: styles.css 를 v=8 → v=9 로 올리기
sed -i 's/styles\.css?v=8/styles.css?v=9/' index.html
```

- 사용자에게 안내: 그래도 안 바뀌면 **강력 새로고침**(Ctrl/Cmd+Shift+R) 또는 시크릿 창.
- `logo.svg`도 바꿨다면 `logo.svg?v=` 숫자를 올리세요.

---

## 4. 자주 하는 커스터마이즈

| 하고 싶은 것 | 방법 |
|--------------|------|
| 예약 마크 이모지 바꾸기 | `app.js`의 `MARKS` 배열 수정 |
| 색상 바꾸기 | `styles.css`의 `:root`(다크) / `html[data-theme="light"]`(라이트) 변수 |
| 브랜드명 바꾸기 | `index.html`의 `.brand-name`, `<title>`, 푸터 |
| 로고 바꾸기 | `logo.svg` 교체(파비콘) + `index.html` 헤더 인라인 `<svg>` 교체 |
| 요일 라벨/순서 | `app.js`의 `DAYS` 배열 |
| 신규 계정 기본 공개범위 | `app.js` `upsertProfile`의 `patch.visibility = "unlisted"` |

수정 후 반드시 3번(캐시 버전 올리기)을 함께 하세요.

---

## 5. Firebase 콘솔 관리

프로젝트: **`web-schedule-fe24a`** → https://console.firebase.google.com

### 반드시 켜져 있어야 하는 것
1. **Authentication → Sign-in method → Google** 사용
2. **Authentication → Sign-in method → 익명(Anonymous)** 사용 (게스트 예약)
3. **Firestore Database** 생성 + **규칙(Rules)에 `firestore.rules` 게시**
4. **Authentication → Settings → 승인된 도메인**에 `blankit-studio.github.io` 포함

### 보안 규칙을 바꿨다면
`firestore.rules` 파일 수정 후 **둘 중 하나**로 반영합니다. (git push만으로는 규칙이 적용되지 않습니다.)

**방법 A — 명령 한 줄 (권장)**
```bash
bash deploy-rules.sh
```
CLI 설치·로그인까지 알아서 처리하고 `firestore.rules`를 그대로 배포합니다. 처음 한 번만 브라우저 로그인이 뜹니다.

**방법 B — 콘솔에 붙여넣기**
콘솔 Firestore → 규칙 탭 → 전체 삭제(Ctrl+A→Delete) 후 `firestore.rules` 내용 붙여넣기 → **게시**.

> ⚠️ **2026-06 (2차) 예약 승인 규칙 — 재게시 필요**: 예약 생성 시 `status`는 반드시 `'pending'`이어야 하고(예약자가 스스로 승인 불가), **시간표 주인만 `status`를 `'approved'`로 변경**할 수 있도록 규칙을 추가했습니다. 승인 기능을 쓰려면 **콘솔에 새 규칙을 재게시**하세요.

> ✅ **2026-06 규칙 강화 — 게시 완료**: 예약 문서 ID(`d{요일}_h{시}`)와 내부 `day`/`hour` 값이 일치해야만 생성·수정되도록 검증을 추가했습니다. 이전 규칙에서는 조작된 클라이언트가 ID와 다른 시간대를 써넣어 **"정원 1명" 보장을 우회**할 수 있었습니다. 함께 `day`(0~6)·`hour`(0~23) 범위 검증과 문자열 길이 상한(note 200, byName 100, mark 8, 비공개 메모 200)도 추가했습니다. 콘솔 게시 완료 상태입니다.

---

## 6. 데이터 · 운영 관리

### 데이터 위치 (Firestore 콘솔 → Firestore Database → 데이터)
```
schedules/{uid}                         # 사용자별 시간표 + 프로필
schedules/{uid}/reservations/{slotId}   # 예약 (slotId = d{요일}_h{시})
privateMemos/{uid}__{slotId}            # 비공개 메모
```

### (a) 게스트 예약 정리
- 게스트는 **익명 계정**으로 예약하며 `reservations` 문서에 `isGuest: true`로 저장됩니다.
- 특정 시간표의 예약을 지우려면: 콘솔에서 `schedules/{uid}/reservations` 컬렉션의 문서를 삭제.
- 쌓인 예약은 시간표 주인이 사이트에서 **`🧹 예약 정리`** 버튼으로 대기 건만 또는 전체를 삭제할 수 있습니다. (자동 삭제는 없음)
- **익명 계정 자체 정리**: Authentication → Users 에서 익명 사용자가 늘어납니다. 필요 시 수동 삭제 가능(예약 데이터와는 별개).

### (b) 백업 / 내보내기
- 소규모: 콘솔에서 문서를 눈으로 확인/복사.
- 정식 백업: **Firestore → 가져오기/내보내기(Import/Export)** 로 Cloud Storage에 내보내기(관리형 export). 또는 gcloud:
  ```bash
  gcloud firestore export gs://<버킷>/backups/$(date +%F)
  ```

### (c) 특정 시간표 초기화/삭제
- 한 사용자의 시간표 비우기: `schedules/{uid}` 문서의 `cells` 필드만 삭제(예약은 유지).
- 통째 삭제: `schedules/{uid}` 문서 + 그 하위 `reservations` 서브컬렉션 + 관련 `privateMemos/*` 삭제.
  > ⚠️ 콘솔에서 문서를 지워도 **서브컬렉션은 같이 지워지지 않습니다.** 하위 `reservations`를 먼저 지우세요.

### (d) 사용량 / 비용 모니터링
- **Firestore → 사용량(Usage)** 탭에서 읽기/쓰기/저장량 확인.
- 무료(Spark) 한도: 문서 읽기 5만/일, 쓰기 2만/일 수준. 실시간 구독(`onSnapshot`)은 갱신마다 읽기를 소모하므로, 방문/예약이 늘면 이 수치를 주기적으로 확인하세요.
- 한도 초과가 우려되면 Blaze(종량제)로 전환하거나, 실시간 구독을 일부 축소(예: 예약을 폴링) 검토.

---

## 7. 문제 해결 (오류 코드별)

| 증상/콘솔 오류 | 원인 | 조치 |
|----------------|------|------|
| "Firebase 설정이 필요합니다" 화면 | `firebase-config.js` 미설정 | 값 입력 |
| `auth/configuration-not-found` | Google 로그인 미활성 | 콘솔에서 Google 사용 설정 |
| `auth/admin-restricted-operation` / `operation-not-allowed` (게스트) | 익명 로그인 미활성 | 콘솔에서 익명 사용 설정 |
| `auth/unauthorized-domain` | 도메인 미승인 | 승인된 도메인에 접속 도메인 추가 |
| `permission-denied` | 규칙 미게시/불일치 | `firestore.rules` 콘솔 재게시 |
| 화면이 예전 그대로 | 캐시 | `?v=` 올렸는지 확인 + 강력 새로고침 |
| 로그인 팝업이 안 뜸 | 팝업 차단 | 브라우저 팝업 허용 |

디버깅 시 브라우저 **F12 → Console** 의 빨간 오류 메시지가 가장 정확한 단서입니다.

---

## 8. 점검 이력

| 날짜 | 발견/조치 |
|------|-----------|
| 2026-06 | **보안 규칙 강화** — 예약 문서 ID와 `day`/`hour` 불일치로 "정원 1명"이 우회될 수 있던 문제 차단, 값 범위·문자열 길이 검증 추가. **콘솔 게시 완료** |
| 2026-06 | **예약 승인/거절 도입** — 예약이 `pending`으로 접수되고 주인 승인 시 `approved`. 주인만 status 변경 가능하도록 규칙 추가. **재게시 필요** |
| 2026-06 | **승인 대기 목록 추가(결함 수정)** — 시간 표시 범위를 좁혀 둔 경우 범위 밖 시간(예: 새벽)에 들어온 예약 요청이 화면에 없어 **주인이 승인/거절할 수 없던 문제**. 헤더에 `⏳ 승인 대기 N` 버튼과 전체 대기 목록 모달 추가 |
| 2026-06 | **예약 일괄 정리 기능** — 주인이 대기 건/전체 예약을 한 번에 삭제 (데이터 누적 대응) |
| 2026-06 | **localStorage 크래시 수정** — 게스트 이름 저장/복원 4곳이 `try/catch` 없이 노출돼, Safari 시크릿 모드·쿠키 차단 환경에서 접근만으로 예외가 발생해 **예약 모달이 열리지 않던** 문제. `lsGet`/`lsSet` 안전 래퍼로 전면 통일 |

> 코딩 규칙: `localStorage`는 **반드시 `lsGet()`/`lsSet()`을 통해서만** 사용하세요. 직접 호출하면 일부 브라우저에서 앱이 멈출 수 있습니다.

---

## 9. 앞으로 할 수 있는 개선 (백로그)

- 예약/변경 **알림**(이메일 등) — Cloud Functions 필요
- 오래된 예약 **자동 정리 스케줄러** — 현재는 주인이 `🧹 예약 정리`로 수동 삭제
- 시간 범위 설정을 **공유 시 고정**(방문자에게 주인 설정 그대로 보이기)
- 시간표 **주 단위 복제/템플릿**

> Cloud Functions·스케줄러·이메일 발송은 Firebase Blaze(종량제) 요금제가 필요합니다.

---

## 10. 로컬에서 확인

```bash
npx serve .          # 또는  python3 -m http.server 5173
```
→ 표시된 주소 접속. `localhost`가 승인된 도메인에 있어야 로그인 팝업이 동작합니다.
