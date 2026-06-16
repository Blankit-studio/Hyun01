# 🗓️ 위클리 — 주간 시간표 공유 & 예약

구글 로그인으로 **월·화·수·목·금·토·일** 일주일 시간 분배를 자세히 작성하고 공유하는 웹사이트입니다.
다른 사람은 공개된 시간표를 둘러보고, **원하는 시간 칸을 골라 마크를 남기고 예약**할 수 있습니다.

순수 정적 사이트(HTML/CSS/JS) + **Firebase**(구글 인증 + Firestore) 구조라서 별도 서버가 필요 없습니다.

---

## ✨ 주요 기능

- **Google 로그인** (Firebase Authentication)
- **주간 시간표 작성** — 요일 × 시간(06:00~24:00) 격자에서 칸을 클릭해 제목/상세 설명 작성
- **공개 둘러보기** — 다른 사람들의 시간표를 카드로 탐색
- **시간 예약 (정원 1명)** — 방문자가 특정 칸을 선택해 마크(📌✅⭐…) + 메모를 남기고 예약. 한 칸당 한 명만 예약 가능
- **공개 / 비공개 메모** — 상대도 보는 공개 메모와, 예약자 본인만 보는 🔒 비공개 메모 분리
- **공개 범위 설정** — 공개 / 링크 공개 / 비공개 중 선택
- **실시간 반영** — 시간표 작성·예약이 Firestore `onSnapshot` 으로 즉시 갱신
- **공유 링크** — 내 시간표 URL을 복사해 공유
- **권한 관리** — 시간표는 본인만 편집, 예약은 작성자/시간표 주인이 삭제

---

## 🚀 설정 방법 (약 5분)

### 1. Firebase 프로젝트 만들기
1. [Firebase 콘솔](https://console.firebase.google.com) → **프로젝트 추가**
2. 프로젝트 이름 입력 후 생성

### 2. 웹 앱 등록 & 설정값 복사
1. 프로젝트 개요 → **웹(`</>`)** 아이콘 클릭해 앱 등록
2. 표시되는 `firebaseConfig` 객체의 값을 복사
3. 이 저장소의 [`firebase-config.js`](./firebase-config.js) 의 값을 본인 값으로 교체

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "내프로젝트.firebaseapp.com",
  projectId: "내프로젝트",
  storageBucket: "내프로젝트.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
```

### 3. Google 로그인 켜기
- **Authentication** → **시작하기** → **Sign-in method** 탭 → **Google** 사용 설정 → 저장

### 4. Firestore 만들기 & 보안 규칙 적용
1. **Firestore Database** → **데이터베이스 만들기** (프로덕션 모드로 생성)
2. **규칙(Rules)** 탭으로 이동
3. 이 저장소의 [`firestore.rules`](./firestore.rules) 내용을 붙여넣고 **게시**

### 5. 승인된 도메인 등록
- **Authentication → Settings → 승인된 도메인**에 사이트를 띄울 도메인 추가
  - 로컬 테스트: `localhost`
  - 배포 시: 예) `내아이디.github.io` 또는 Firebase Hosting 도메인

---

## 🖥️ 로컬에서 실행

ES 모듈을 사용하므로 `file://` 로 직접 열면 안 되고, 간단한 정적 서버가 필요합니다.

```bash
# 둘 중 아무거나
npx serve .
# 또는
python3 -m http.server 5173
```

그 후 브라우저에서 `http://localhost:5173` (또는 표시된 주소) 접속.

> ⚠️ 구글 로그인 팝업이 동작하려면 `localhost`가 **승인된 도메인**(4-5단계)에 있어야 합니다.

---

## 🌐 배포

정적 파일이므로 어디든 올릴 수 있습니다.

- **Firebase Hosting**
  ```bash
  npm i -g firebase-tools
  firebase login
  firebase init hosting   # public 디렉터리를 현재 폴더(.)로 지정
  firebase deploy
  ```
- **GitHub Pages** — 저장소 Settings → Pages → 브랜치 지정 후 배포
- **Vercel / Netlify** — 정적 사이트로 import 후 배포

배포 도메인을 **승인된 도메인**에 추가하는 것을 잊지 마세요.

---

## 🗂️ 데이터 구조 (Firestore)

```
schedules/{uid}
├─ ownerName, ownerPhoto, ownerEmail, bio, updatedAt
├─ visibility: "public" | "unlisted" | "private"   # 공개 범위
└─ cells: {                       # 시간표 칸
     "d0_h9":  { title, desc },   # d=요일(0=월…6=일), h=시각(24h)
     "d2_h14": { title, desc },
     ...
   }

# 예약: 문서 ID가 "d{요일}_h{시}" 고정값 → 한 칸당 1건(정원 1명)
schedules/{uid}/reservations/{slotId}
   { day, hour, mark, note(공개), byUid, byName, byPhoto, createdAt }

# 비공개 메모: 작성자 본인만 읽기/쓰기 가능 (문서 ID = "{uid}__{slotId}")
privateMemos/{memoId}
   { ownerUid, scheduleUid, slotId, text, updatedAt }
```

### 공개 범위(visibility)
- **public(공개)** — 둘러보기 목록에 노출되고 누구나 열람
- **unlisted(링크 공개)** — 목록엔 안 보이지만 링크를 아는 사람은 열람
- **private(비공개)** — 본인만 열람 가능

---

## 📁 파일 구성

| 파일 | 설명 |
|------|------|
| `index.html` | 페이지 골격 |
| `styles.css` | 스타일 |
| `app.js` | 앱 로직 (인증·라우팅·시간표·예약) |
| `firebase-config.js` | **본인 Firebase 설정값 입력** |
| `firestore.rules` | Firestore 보안 규칙 |

---

## 🔧 커스터마이즈 팁

- 표시 시간 범위: `app.js` 상단의 `START_HOUR`, `END_HOUR`
- 예약 마크 이모지: `app.js` 의 `MARKS` 배열
- 요일/색상: `DAYS` 및 `styles.css` 의 CSS 변수(`:root`)
