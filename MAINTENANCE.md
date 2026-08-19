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
| `firebase.json`, `.firebaserc` | (선택) Firebase Hosting 배포 설정 |

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
`firestore.rules` 파일 수정 → **콘솔 Firestore → 규칙 탭에 붙여넣고 "게시"**. (git push만으로는 규칙이 적용되지 않습니다. 콘솔 게시가 별도로 필요.)

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
- 오래된 게스트 예약을 주기적으로 비우고 싶다면 → 8번(자동화)의 Cloud Functions 예시 참고. (지금은 자동 삭제 없음 = 예약이 계속 쌓임)
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

## 8. 앞으로 할 수 있는 개선 (백로그)

- 예약 **승인/거절** 흐름 (시간표 주인이 수락해야 확정)
- 예약/변경 **알림**(이메일 등) — Cloud Functions 필요
- 오래된 게스트 예약 **자동 정리** — Cloud Functions 스케줄러
- 시간 범위 설정을 **공유 시 고정**(방문자에게 주인 설정 그대로 보이기)
- 시간표 **주 단위 복제/템플릿**

> Cloud Functions·스케줄러·이메일 발송은 Firebase Blaze(종량제) 요금제가 필요합니다.

---

## 9. 로컬에서 확인

```bash
npx serve .          # 또는  python3 -m http.server 5173
```
→ 표시된 주소 접속. `localhost`가 승인된 도메인에 있어야 로그인 팝업이 동작합니다.
