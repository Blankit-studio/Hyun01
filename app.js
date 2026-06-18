// ─────────────────────────────────────────────────────────────
// 위클리 — 주간 시간표 공유 & 예약  (Firebase + Vanilla JS)
// ─────────────────────────────────────────────────────────────
import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField,
  collection, getDocs, onSnapshot, serverTimestamp, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ── 상수 ───────────────────────────────────────────────────────
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const START_HOUR = 6;   // 표시 시작 시각
const END_HOUR = 24;    // 표시 끝 시각 (미포함)
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const MARKS = ["📌", "✅", "⭐", "❤️", "🔥", "☕", "🎯", "💬"];

const VISIBILITY = {
  public:   { label: "공개", desc: "둘러보기 목록에 노출 · 누구나 열람" },
  unlisted: { label: "링크 공개", desc: "목록에 안 보임 · 링크 아는 사람만 열람" },
  private:  { label: "비공개", desc: "나만 볼 수 있음" },
};

const cellKey = (d, h) => `d${d}_h${h}`;
const hh = (h) => String(h).padStart(2, "0") + ":00";
const memoId = (uid, slotId) => `${uid}__${slotId}`;

// ── 전역 상태 ──────────────────────────────────────────────────
let app, auth, db;
let currentUser = null;
let unsubSchedule = null;     // 현재 시간표 문서 구독 해제
let unsubReservations = null; // 현재 예약 구독 해제
let gridState = null;         // { uid, isOwner, scheduleData, resByCell, cellEls }
let modalOnRes = null;        // 예약 모달이 열려 있을 때 예약 변경 시 호출
let selCtx = null;            // 드래그 선택 상태
let justDragged = false;      // 드래그 직후 click 무시 플래그
let longPressTimer = null;    // 모바일 길게누르기 타이머
let selectionCleanup = null;  // 드래그 리스너 해제 함수

// ── DOM 헬퍼 ───────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
};

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2800);
}

// ── 초기화 ─────────────────────────────────────────────────────
function boot() {
  if (!isConfigured) {
    $("#configBanner").hidden = false;
    renderConfigHelp();
    return;
  }
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.error(e);
    $("#configBanner").hidden = false;
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    renderAuthArea();
    if (user && !user.isAnonymous) await upsertProfile(user); // 게스트(익명)는 프로필 미생성
    route();
  });

  window.addEventListener("hashchange", route);
  route();
}

// 로그인 시 본인 프로필을 schedules/{uid} 에 병합 저장
async function upsertProfile(user) {
  if (!user || user.isAnonymous) return;
  try {
    const ref = doc(db, "schedules", user.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const patch = {
      ownerName: user.displayName || "이름없음",
      ownerPhoto: user.photoURL || "",
      ownerEmail: user.email || "",
      updatedAt: serverTimestamp(),
    };
    if (!data.visibility) patch.visibility = "unlisted"; // 신규 계정 기본: 링크 공개
    await setDoc(ref, patch, { merge: true });
  } catch (e) {
    console.warn("프로필 저장 실패", e);
  }
}

// ── 인증 영역 / 액션 ───────────────────────────────────────────
function renderAuthArea() {
  const area = $("#authArea");
  area.innerHTML = "";
  const isMember = currentUser && !currentUser.isAnonymous;
  // '내 시간표' 등은 정식(구글) 회원에게만 노출
  document.querySelectorAll("[data-auth-only]").forEach((n) => (n.style.display = isMember ? "" : "none"));

  if (isMember) {
    area.appendChild(
      el("div", { class: "user-chip" }, [
        el("img", { class: "avatar", src: currentUser.photoURL || fallbackAvatar(currentUser.displayName), alt: "" }),
        el("span", { class: "user-name", text: currentUser.displayName || "사용자" }),
        el("button", { class: "btn btn-sm btn-ghost", onclick: doLogout }, "로그아웃"),
      ])
    );
  } else if (currentUser && currentUser.isAnonymous) {
    area.appendChild(
      el("div", { class: "user-chip" }, [
        el("img", { class: "avatar", src: fallbackAvatar("게"), alt: "" }),
        el("span", { class: "user-name", text: "게스트" }),
        el("button", { class: "btn btn-sm btn-google", onclick: doLogin }, [googleIcon(), "로그인"]),
      ])
    );
  } else {
    area.appendChild(el("button", { class: "btn btn-google", onclick: doLogin }, [googleIcon(), "Google로 로그인"]));
  }
}

async function doLogin() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    toast("로그인되었습니다.");
  } catch (e) {
    console.error(e);
    toast("로그인 실패: " + (e.code || e.message), true);
  }
}
async function doLogout() {
  await signOut(auth);
  toast("로그아웃되었습니다.");
  location.hash = "#/";
}

// ── 라우터 ─────────────────────────────────────────────────────
function teardownSubs() {
  if (unsubSchedule) { unsubSchedule(); unsubSchedule = null; }
  if (unsubReservations) { unsubReservations(); unsubReservations = null; }
  if (selectionCleanup) { selectionCleanup(); selectionCleanup = null; }
  gridState = null;
  modalOnRes = null;
  selCtx = null;
}

function route() {
  teardownSubs();
  const hash = location.hash || "#/";
  const view = $("#view");
  view.innerHTML = "";
  document.querySelectorAll(".nav-link").forEach((n) => n.classList.remove("active"));

  if (hash === "#/" || hash === "") {
    $('.nav-link[data-route="home"]')?.classList.add("active");
    renderHome(view);
  } else if (hash === "#/me") {
    $('.nav-link[data-route="me"]')?.classList.add("active");
    if (!currentUser || currentUser.isAnonymous) return renderLoginPrompt(view, "내 시간표를 작성하려면 로그인하세요.");
    renderSchedule(view, currentUser.uid);
  } else if (hash.startsWith("#/u/")) {
    const uid = decodeURIComponent(hash.slice(4));
    renderSchedule(view, uid);
  } else {
    renderHome(view);
  }
}

// ── 둘러보기 (홈) ─────────────────────────────────────────────
async function renderHome(view) {
  view.appendChild(
    el("section", { class: "hero" }, [
      el("h1", { text: "내 일주일을 공유하고, 시간을 예약받으세요" }),
      el("p", {
        text:
          "구글 로그인으로 월·화·수·목·금·토·일 시간 분배를 자세히 작성하세요. " +
          "다른 사람은 원하는 시간 칸을 골라 마크를 남기고 예약할 수 있습니다.",
      }),
      currentUser
        ? el("a", { class: "btn btn-primary", href: "#/me" }, "내 시간표 작성하기")
        : el("button", { class: "btn btn-google", onclick: doLogin }, [googleIcon(), "Google로 시작하기"]),
    ])
  );

  const sec = el("div");
  sec.appendChild(
    el("div", { class: "section-title" }, [el("h2", { text: "공개된 시간표 둘러보기" }), el("span", { class: "count", id: "homeCount" })])
  );
  const cards = el("div", { class: "cards", id: "cards" }, [el("div", { class: "empty", text: "불러오는 중…" })]);
  sec.appendChild(cards);
  view.appendChild(sec);

  try {
    // 공개(public)로 설정된 시간표만 조회 → 보안 규칙의 list 조건과 일치
    const snap = await getDocs(query(collection(db, "schedules"), where("visibility", "==", "public")));
    const docs = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.ownerName) docs.push({ id: d.id, ...data });
    });
    docs.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

    cards.innerHTML = "";
    docs.forEach((data) => {
      const planCount = data.cells ? Object.values(data.cells).filter((c) => c && (c.title || c.desc)).length : 0;
      cards.appendChild(
        el("div", { class: "card", onclick: () => (location.hash = "#/u/" + encodeURIComponent(data.id)) }, [
          el("div", { class: "card-head" }, [
            el("img", { class: "avatar", src: data.ownerPhoto || fallbackAvatar(data.ownerName), alt: "" }),
            el("div", {}, [
              el("div", { class: "card-name", text: data.ownerName }),
              el("div", { class: "card-sub", text: data.id === currentUser?.uid ? "내 시간표" : "시간표 보기" }),
            ]),
          ]),
          el("div", { class: "card-meta" }, [el("span", { html: `채워진 시간 <b>${planCount}</b>칸` })]),
        ])
      );
    });
    $("#homeCount").textContent = `${docs.length}명`;
    if (docs.length === 0) cards.appendChild(el("div", { class: "empty", text: "아직 공개된 시간표가 없습니다. 첫 번째로 작성해 보세요!" }));
  } catch (e) {
    console.error(e);
    cards.innerHTML = "";
    cards.appendChild(el("div", { class: "empty", text: "목록을 불러오지 못했습니다. Firestore 보안 규칙을 확인하세요." }));
  }
}

function renderLoginPrompt(view, msg) {
  view.appendChild(
    el("div", { class: "center-stack", style: "padding:60px 20px" }, [
      el("p", { class: "card-sub", text: msg, style: "font-size:15px" }),
      el("button", { class: "btn btn-google", onclick: doLogin }, [googleIcon(), "Google로 로그인"]),
    ])
  );
}

// ── 시간표 화면 (실시간) ───────────────────────────────────────
function renderSchedule(view, uid) {
  const isOwner = currentUser && currentUser.uid === uid;
  view.innerHTML = "";
  const wrap = el("div");
  view.appendChild(wrap);

  const headBox = el("div");
  const hintBox = el("div");
  const gridWrap = el("div", { class: "grid-wrap" });
  const statusBox = el("div", {}, [el("div", { class: "empty", text: "시간표를 불러오는 중…" })]);
  wrap.append(headBox, hintBox, gridWrap, statusBox);

  gridState = { uid, isOwner, scheduleData: {}, resByCell: {} };

  function renderHeader() {
    const data = gridState.scheduleData || {};
    const ownerName = data.ownerName || (isOwner ? currentUser.displayName : "사용자");
    const vis = VISIBILITY[data.visibility] || VISIBILITY.public;

    const actions = el("div", { class: "schedule-actions" });
    if (isOwner) {
      actions.appendChild(el("span", { class: "vis-badge", text: "공개범위: " + vis.label }));
      actions.appendChild(el("button", { class: "btn btn-sm", onclick: () => openSettingsModal(uid, data) }, "⚙️ 설정"));
    }
    actions.appendChild(el("button", { class: "btn btn-sm btn-ghost", onclick: copyShareLink(uid) }, "🔗 공유 링크"));

    const head = el("div", { class: "schedule-head" }, [
      el("div", { class: "owner" }, [
        el("img", { class: "avatar", style: "width:48px;height:48px", src: data.ownerPhoto || (isOwner ? currentUser.photoURL : "") || fallbackAvatar(ownerName), alt: "" }),
        el("div", {}, [
          el("h2", { text: ownerName + (isOwner ? " (나)" : "") + " 의 주간 시간표" }),
          el("div", { class: "bio", text: data.bio || (isOwner ? "소개/메모를 추가해 보세요." : "") }),
        ]),
      ]),
      actions,
    ]);
    headBox.innerHTML = "";
    headBox.appendChild(head);

    hintBox.innerHTML = "";
    hintBox.appendChild(
      el("div", { class: "mode-hint" }, [
        isOwner
          ? "✏️ 칸을 클릭하면 일정을 작성/수정할 수 있어요. 여러 칸은 드래그(모바일은 길게 눌러 드래그)로 한 번에 작성할 수 있습니다."
          : "🖱️ 빈 칸을 클릭해 예약하세요. 로그인 없이 게스트로도 가능해요. 여러 시간은 드래그(모바일은 길게 눌러 드래그)로 한 번에 예약할 수 있고, 한 칸당 한 명만 예약됩니다.",
      ])
    );
  }

  function renderGrid() {
    const prevScroll = gridWrap.scrollLeft;
    const cells = (gridState.scheduleData && gridState.scheduleData.cells) || {};
    gridState.cellEls = {};
    const grid = el("div", { class: "grid" });
    grid.appendChild(el("div", { class: "corner gh" }));
    DAYS.forEach((d, i) => grid.appendChild(el("div", { class: "gh" + (i >= 5 ? " weekend" : ""), text: d })));

    HOURS.forEach((h) => {
      grid.appendChild(el("div", { class: "time", text: hh(h) }));
      DAYS.forEach((_, d) => {
        const key = cellKey(d, h);
        const plan = cells[key];
        const res = gridState.resByCell[key];
        const planArea = el("div", { class: "plan-area" });
        if (plan && (plan.title || plan.desc)) {
          if (plan.title) planArea.appendChild(el("div", { class: "plan-title", text: plan.title }));
          if (plan.desc) planArea.appendChild(el("div", { class: "plan-desc", text: plan.desc }));
        }
        const resRow = el("div", { class: "res-row" });
        if (res) {
          const mine = currentUser && res.byUid === currentUser.uid;
          resRow.appendChild(
            el("span", { class: "res-dot" + (mine ? " mine" : ""), title: `${res.byName}${res.note ? ": " + res.note : ""}` }, [
              res.mark || "📌",
            ])
          );
        }
        const cell = el(
          "div",
          {
            class: "cell" + (plan && (plan.title || plan.desc) ? " has-plan" : "") + (res ? " reserved" : ""),
            "data-day": d, "data-hour": h,
            onclick: () => {
              if (justDragged) { justDragged = false; return; }
              onCellClick(uid, isOwner, d, h, (gridState.scheduleData.cells || {})[key]);
            },
            onmousedown: (e) => { if (e.button === 0) { e.preventDefault(); dragStart(d, h); } },
            onmouseenter: () => { if (selCtx) dragMove(d, h); },
            ontouchstart: (e) => onCellTouchStart(e, d, h),
          },
          [planArea, resRow]
        );
        gridState.cellEls[`${d}_${h}`] = cell;
        grid.appendChild(cell);
      });
    });

    gridWrap.innerHTML = "";
    gridWrap.appendChild(grid);
    gridWrap.scrollLeft = prevScroll;
  }

  // 시간표 문서 실시간 구독 → 작성 즉시 반영
  unsubSchedule = onSnapshot(
    doc(db, "schedules", uid),
    (snap) => {
      statusBox.innerHTML = "";
      if (!snap.exists()) {
        if (isOwner) {
          gridState.scheduleData = {};
          renderHeader();
          renderGrid();
        } else {
          wrap.innerHTML = "";
          wrap.appendChild(el("div", { class: "empty", text: "존재하지 않는 시간표입니다." }));
        }
        return;
      }
      gridState.scheduleData = snap.data();
      renderHeader();
      renderGrid();
    },
    (err) => {
      console.error("시간표 구독 오류", err);
      teardownSubs();
      wrap.innerHTML = "";
      const msg = err.code === "permission-denied"
        ? "🔒 비공개 시간표이거나 접근 권한이 없습니다."
        : "시간표를 불러오지 못했습니다.";
      wrap.appendChild(el("div", { class: "empty", text: msg }));
    }
  );

  // 예약 실시간 구독
  unsubReservations = onSnapshot(
    collection(db, "schedules", uid, "reservations"),
    (snap) => {
      const map = {};
      snap.forEach((d) => {
        const r = { id: d.id, ...d.data() };
        map[cellKey(r.day, r.hour)] = r; // 정원 1명: 슬롯당 1건
      });
      gridState.resByCell = map;
      if (gridState.scheduleData) renderGrid();
      if (typeof modalOnRes === "function") modalOnRes();
    },
    (err) => console.error("예약 구독 오류", err)
  );

  // 여러 칸 드래그 선택 리스너 (문서 레벨)
  const onUp = () => finishDesktop();
  const onMove = (e) => onDocTouchMove(e);
  const onEnd = () => { clearTimeout(longPressTimer); finishTouch(); };
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd);
  document.addEventListener("touchcancel", onEnd);
  selectionCleanup = () => {
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
    clearTimeout(longPressTimer);
    selCtx = null;
  };
}

// ── 여러 칸 드래그 선택 ────────────────────────────────────────
function selRange(a, b) {
  return { d0: Math.min(a.d, b.d), d1: Math.max(a.d, b.d), h0: Math.min(a.h, b.h), h1: Math.max(a.h, b.h) };
}
function selList(r) {
  const l = [];
  for (let d = r.d0; d <= r.d1; d++) for (let h = r.h0; h <= r.h1; h++) l.push({ d, h });
  return l;
}
function highlightSel(r) {
  if (!gridState?.cellEls) return;
  Object.values(gridState.cellEls).forEach((c) => c.classList.remove("selecting"));
  if (!r) return;
  selList(r).forEach(({ d, h }) => gridState.cellEls[`${d}_${h}`]?.classList.add("selecting"));
}
function dragStart(d, h) {
  justDragged = false;
  selCtx = { start: { d, h }, cur: { d, h }, moved: false, active: false };
}
function dragMove(d, h) {
  if (!selCtx) return;
  if (d !== selCtx.cur.d || h !== selCtx.cur.h) selCtx.moved = true;
  selCtx.cur = { d, h };
  highlightSel(selRange(selCtx.start, selCtx.cur));
}
function dragTouchActivate() {
  if (!selCtx) return;
  selCtx.active = true;
  highlightSel(selRange(selCtx.start, selCtx.cur));
  if (navigator.vibrate) navigator.vibrate(15);
}
function onCellTouchStart(e, d, h) {
  const t = e.touches[0];
  if (!t) return;
  dragStart(d, h);
  selCtx.touchXY = { x: t.clientX, y: t.clientY };
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(dragTouchActivate, 280); // 길게 누르면 선택 시작
}
function onDocTouchMove(e) {
  if (!selCtx) return;
  const t = e.touches[0];
  if (!t) return;
  if (!selCtx.active) {
    // 활성화 전 많이 움직이면 스크롤로 보고 선택 취소
    const dx = Math.abs(t.clientX - selCtx.touchXY.x);
    const dy = Math.abs(t.clientY - selCtx.touchXY.y);
    if (dx > 10 || dy > 10) { clearTimeout(longPressTimer); selCtx = null; }
    return;
  }
  e.preventDefault(); // 선택 중에는 스크롤 막기
  const target = document.elementFromPoint(t.clientX, t.clientY);
  const cellEl = target && target.closest ? target.closest(".cell") : null;
  if (cellEl && cellEl.dataset.day != null) dragMove(+cellEl.dataset.day, +cellEl.dataset.hour);
}
function finishDesktop() {
  if (!selCtx) return;
  const { moved, start, cur } = selCtx;
  selCtx = null;
  highlightSel(null);
  if (moved) {
    const list = selList(selRange(start, cur));
    justDragged = true;
    setTimeout(() => (justDragged = false), 400);
    openBulkModal(gridState.uid, gridState.isOwner, list);
  }
}
function finishTouch() {
  if (!selCtx || !selCtx.active) { selCtx = null; return; }
  const list = selList(selRange(selCtx.start, selCtx.cur));
  selCtx = null;
  highlightSel(null);
  justDragged = true;
  setTimeout(() => (justDragged = false), 400);
  if (list.length === 1) {
    const { d, h } = list[0];
    onCellClick(gridState.uid, gridState.isOwner, d, h, (gridState.scheduleData.cells || {})[cellKey(d, h)]);
  } else {
    openBulkModal(gridState.uid, gridState.isOwner, list);
  }
}

// ── 칸 클릭 처리 ───────────────────────────────────────────────
function onCellClick(uid, isOwner, day, hour, plan) {
  if (isOwner) openPlanModal(uid, day, hour, plan);
  else openReservationModal(uid, day, hour, plan);
}

// 소유자: 일정 편집 + 예약 확인/삭제
function openPlanModal(uid, day, hour, plan) {
  const titleInput = el("input", { type: "text", maxlength: "40", value: plan?.title || "", placeholder: "예: 운동, 회의, 공부" });
  const descInput = el("textarea", { maxlength: "200", placeholder: "이 시간에 대한 자세한 설명 (선택)" });
  descInput.value = plan?.desc || "";

  // 이 슬롯의 예약 표시 (있으면)
  const resBox = el("div");
  const renderResBox = () => {
    const res = gridState?.resByCell?.[cellKey(day, hour)];
    resBox.innerHTML = "";
    if (!res) return;
    resBox.appendChild(el("div", { class: "divider" }));
    resBox.appendChild(
      el("div", { class: "field" }, [
        el("label", { text: "이 시간의 예약" }),
        el("div", { class: "res-item" }, [
          el("span", { class: "res-mark", text: res.mark || "📌" }),
          el("img", { class: "avatar avatar-sm", src: res.byPhoto || fallbackAvatar(res.byName), alt: "" }),
          el("div", { class: "grow" }, [
            el("div", { class: "who", text: res.byName || "익명" }),
            res.note ? el("div", { class: "note", text: res.note }) : el("div", { class: "note", text: "(공개 메모 없음)" }),
          ]),
          el("button", { class: "btn btn-sm btn-danger", onclick: () => removeReservation(uid, day, hour) }, "예약 삭제"),
        ]),
      ])
    );
  };
  renderResBox();
  modalOnRes = renderResBox;

  openModal({
    title: `${DAYS[day]}요일 ${hh(hour)} 일정`,
    sub: "이 시간에 무엇을 하는지 작성하세요.",
    body: [
      el("div", { class: "field" }, [el("label", { text: "제목" }), titleInput]),
      el("div", { class: "field" }, [el("label", { text: "상세 설명" }), descInput]),
      resBox,
    ],
    actions: [
      plan && (plan.title || plan.desc)
        ? el("button", { class: "btn btn-danger", onclick: async () => { await savePlan(uid, day, hour, null); closeModal(); toast("삭제했습니다."); } }, "일정 삭제")
        : null,
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "취소"),
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const t = titleInput.value.trim();
          const d = descInput.value.trim();
          if (!t && !d) { toast("내용을 입력하세요.", true); return; }
          await savePlan(uid, day, hour, { title: t, desc: d });
          closeModal();
          toast("저장했습니다.");
        },
      }, "저장"),
    ],
    onClose: () => { modalOnRes = null; },
  });
  setTimeout(() => titleInput.focus(), 50);
}

async function savePlan(uid, day, hour, value) {
  const ref = doc(db, "schedules", uid);
  // 중첩 맵의 특정 키만 갱신/삭제. merge 는 키 삭제를 못하므로 deleteField() 사용.
  const fieldPath = `cells.${cellKey(day, hour)}`;
  try {
    await updateDoc(ref, {
      [fieldPath]: value ? value : deleteField(),
      updatedAt: serverTimestamp(),
    });
    // onSnapshot 이 즉시 화면을 갱신하므로 별도 재렌더 불필요
  } catch (e) {
    // 문서가 아직 없으면(updateDoc 실패) 생성
    if (e.code === "not-found" && value) {
      try {
        await setDoc(ref, { cells: { [cellKey(day, hour)]: value }, updatedAt: serverTimestamp() }, { merge: true });
        return;
      } catch (e2) { e = e2; }
    }
    console.error(e);
    toast("저장 실패: " + (e.code || e.message), true);
  }
}

// 게스트(비로그인) 예약 시 익명 인증 보장
async function ensureReserver() {
  if (currentUser) return currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    console.error(e);
    const blocked = e.code === "auth/admin-restricted-operation" || e.code === "auth/operation-not-allowed";
    toast(blocked
      ? "게스트 예약이 꺼져 있어요. Firebase 콘솔에서 '익명 로그인'을 켜주세요."
      : "게스트 인증 실패: " + (e.code || e.message), true);
    return null;
  }
}

// 방문자: 예약 모달 (정원 1명 + 공개 메모 + 비공개 메모, 게스트 허용)
async function openReservationModal(uid, day, hour, plan) {
  const isGuest = !currentUser || currentUser.isAnonymous;
  const slotId = cellKey(day, hour);
  const existing = gridState?.resByCell?.[slotId];
  const mine = !!(existing && currentUser && existing.byUid === currentUser.uid);

  const planInfo = plan && (plan.title || plan.desc)
    ? el("div", { class: "mode-hint", style: "margin:0" }, [el("b", { text: plan.title || "" }), plan.desc ? " — " + plan.desc : ""])
    : el("div", { class: "card-sub", text: "상대가 이 시간에 등록한 일정은 없습니다." });

  // 이미 다른 사람이 예약한 경우 → 예약 불가
  if (existing && !mine) {
    openModal({
      title: `${DAYS[day]}요일 ${hh(hour)} 예약`,
      sub: "이미 예약된 시간입니다. (정원 1명)",
      body: [
        planInfo,
        el("div", { class: "field" }, [
          el("label", { text: "예약 현황" }),
          el("div", { class: "res-item" }, [
            el("span", { class: "res-mark", text: existing.mark || "📌" }),
            el("img", { class: "avatar avatar-sm", src: existing.byPhoto || fallbackAvatar(existing.byName), alt: "" }),
            el("div", { class: "grow" }, [
              el("div", { class: "who", text: existing.byName || "익명" }),
              existing.note ? el("div", { class: "note", text: existing.note }) : null,
            ]),
          ]),
        ]),
      ],
      actions: [el("button", { class: "btn btn-ghost", onclick: closeModal }, "닫기")],
    });
    return;
  }

  // 내 비공개 메모 불러오기 (있으면)
  let privateText = "";
  if (mine) privateText = await loadPrivateMemo(uid, slotId);

  let selectedMark = (mine && existing.mark) || MARKS[0];
  const emojiPicker = el("div", { class: "emoji-picker" });
  MARKS.forEach((m) => {
    const b = el("button", { class: "emoji-opt" + (m === selectedMark ? " selected" : ""), type: "button", text: m });
    b.addEventListener("click", () => {
      selectedMark = m;
      emojiPicker.querySelectorAll(".emoji-opt").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    emojiPicker.appendChild(b);
  });

  const noteInput = el("textarea", { maxlength: "200", placeholder: "상대에게 보이는 공개 메모. 예: 30분 통화 가능할까요?" });
  noteInput.value = mine ? (existing.note || "") : "";
  const privateInput = el("textarea", { maxlength: "200", placeholder: "나만 볼 수 있는 메모. 예: 우리 회사 위치 공유, 준비물 등" });
  privateInput.value = privateText;

  // 게스트는 이름 입력 (이전에 쓴 이름 기억)
  const nameInput = el("input", { type: "text", maxlength: "20", placeholder: "표시할 이름 (예: 홍길동)" });
  nameInput.value = localStorage.getItem("guestName") || "";

  const actions = [el("button", { class: "btn btn-ghost", onclick: closeModal }, "닫기")];
  if (mine) {
    actions.push(el("button", { class: "btn btn-danger", onclick: () => removeReservation(uid, day, hour, true) }, "예약 취소"));
  }
  actions.push(
    el("button", {
      class: "btn btn-primary",
      onclick: async () => {
        let byName;
        if (isGuest) {
          byName = nameInput.value.trim();
          if (!byName) { toast("이름을 입력하세요.", true); return; }
          localStorage.setItem("guestName", byName);
        }
        const user = await ensureReserver();
        if (!user) return;
        const ok = await saveReservation(uid, day, hour, selectedMark, noteInput.value.trim(), privateInput.value.trim(), byName, user);
        if (ok) { closeModal(); toast(mine ? "예약을 수정했습니다." : "예약을 남겼습니다."); }
      },
    }, mine ? "예약 수정" : "예약하기")
  );

  const body = [planInfo];
  if (isGuest) body.push(el("div", { class: "field" }, [el("label", { text: "이름 (게스트)" }), nameInput]));
  body.push(
    el("div", { class: "field" }, [el("label", { text: "마크 선택" }), emojiPicker]),
    el("div", { class: "field" }, [el("label", { text: "공개 메모 (상대도 볼 수 있어요)" }), noteInput]),
    el("div", { class: "field" }, [el("label", { text: "🔒 비공개 메모 (나만 보기)" }), privateInput])
  );

  openModal({
    title: `${DAYS[day]}요일 ${hh(hour)} 예약`,
    sub: mine
      ? "내 예약을 수정할 수 있어요."
      : isGuest
      ? "로그인 없이 게스트로 예약할 수 있어요. (정원 1명)"
      : "마크를 고르고 메모를 남겨 예약하세요. (정원 1명)",
    body,
    actions,
  });
  setTimeout(() => (isGuest ? nameInput : noteInput).focus(), 50);
}

async function loadPrivateMemo(uid, slotId) {
  try {
    const snap = await getDoc(doc(db, "privateMemos", memoId(uid, slotId)));
    return snap.exists() ? snap.data().text || "" : "";
  } catch {
    return ""; // 권한 없음 등
  }
}

async function saveReservation(uid, day, hour, mark, note, privateText, byName, user) {
  user = user || currentUser;
  if (!user) return false;
  const slotId = cellKey(day, hour);
  const existing = gridState?.resByCell?.[slotId];
  if (existing && existing.byUid !== user.uid) {
    toast("이미 예약된 시간입니다.", true);
    return false;
  }
  try {
    // 슬롯 단위 고정 ID → 한 칸당 한 건만 존재 (보안 규칙으로 타인 덮어쓰기 차단)
    await setDoc(doc(db, "schedules", uid, "reservations", slotId), {
      day, hour, mark,
      note: note || "",
      byUid: user.uid,
      byName: byName || user.displayName || "게스트",
      byPhoto: user.photoURL || "",
      isGuest: user.isAnonymous || false,
      createdAt: serverTimestamp(),
    });
    // 비공개 메모 저장/삭제
    const mref = doc(db, "privateMemos", memoId(uid, slotId));
    if (privateText) {
      await setDoc(mref, {
        ownerUid: user.uid, scheduleUid: uid, slotId,
        text: privateText, updatedAt: serverTimestamp(),
      });
    } else {
      await deleteDoc(mref).catch(() => {});
    }
    return true;
  } catch (e) {
    console.error(e);
    const msg = e.code === "permission-denied" ? "이미 예약되었거나 권한이 없습니다." : (e.code || e.message);
    toast("예약 실패: " + msg, true);
    return false;
  }
}

async function removeReservation(uid, day, hour, closeAfter = false) {
  const slotId = cellKey(day, hour);
  const res = gridState?.resByCell?.[slotId];
  const docId = res?.id || slotId; // 구버전(랜덤 ID) 예약도 실제 ID로 삭제
  try {
    await deleteDoc(doc(db, "schedules", uid, "reservations", docId));
    await deleteDoc(doc(db, "privateMemos", memoId(uid, slotId))).catch(() => {});
    toast("예약을 취소했습니다.");
    if (closeAfter) closeModal();
  } catch (e) {
    console.error(e);
    toast("삭제 실패: " + (e.code || e.message), true);
  }
}

// ── 여러 칸 일괄 처리 모달 ─────────────────────────────────────
function openBulkModal(uid, isOwner, list) {
  if (isOwner) openBulkPlanModal(uid, list);
  else openBulkReserveModal(uid, list);
}

// 소유자: 여러 칸에 같은 일정 일괄 적용/삭제
function openBulkPlanModal(uid, list) {
  const titleInput = el("input", { type: "text", maxlength: "40", placeholder: "예: 공부, 근무, 운동" });
  const descInput = el("textarea", { maxlength: "200", placeholder: "상세 설명 (선택)" });
  openModal({
    title: `${list.length}개 시간 일괄 설정`,
    sub: "선택한 모든 칸에 같은 일정을 적용합니다.",
    body: [
      el("div", { class: "field" }, [el("label", { text: "제목" }), titleInput]),
      el("div", { class: "field" }, [el("label", { text: "상세 설명" }), descInput]),
    ],
    actions: [
      el("button", { class: "btn btn-danger", onclick: async () => { await bulkSavePlan(uid, list, null); closeModal(); toast(`${list.length}칸을 비웠습니다.`); } }, "선택 칸 비우기"),
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "취소"),
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          const t = titleInput.value.trim();
          const d = descInput.value.trim();
          if (!t && !d) { toast("내용을 입력하세요.", true); return; }
          await bulkSavePlan(uid, list, { title: t, desc: d });
          closeModal();
          toast(`${list.length}칸에 적용했습니다.`);
        },
      }, "적용"),
    ],
  });
  setTimeout(() => titleInput.focus(), 50);
}

async function bulkSavePlan(uid, list, value) {
  const ref = doc(db, "schedules", uid);
  const patch = { updatedAt: serverTimestamp() };
  list.forEach(({ d, h }) => { patch[`cells.${cellKey(d, h)}`] = value ? value : deleteField(); });
  try {
    await updateDoc(ref, patch);
  } catch (e) {
    if (e.code === "not-found" && value) {
      try {
        const cells = {};
        list.forEach(({ d, h }) => (cells[cellKey(d, h)] = value));
        await setDoc(ref, { cells, updatedAt: serverTimestamp() }, { merge: true });
        return;
      } catch (e2) { e = e2; }
    }
    console.error(e);
    toast("저장 실패: " + (e.code || e.message), true);
  }
}

// 방문자: 여러 빈 칸을 한 번에 예약 (게스트 허용)
function openBulkReserveModal(uid, list) {
  const isGuest = !currentUser || currentUser.isAnonymous;

  // 다른 사람이 이미 예약한 칸은 제외
  const available = list.filter(({ d, h }) => {
    const ex = gridState?.resByCell?.[cellKey(d, h)];
    return !ex || (currentUser && ex.byUid === currentUser.uid);
  });
  const blocked = list.length - available.length;

  let selectedMark = MARKS[0];
  const emojiPicker = el("div", { class: "emoji-picker" });
  MARKS.forEach((m, i) => {
    const b = el("button", { class: "emoji-opt" + (i === 0 ? " selected" : ""), type: "button", text: m });
    b.addEventListener("click", () => {
      selectedMark = m;
      emojiPicker.querySelectorAll(".emoji-opt").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    emojiPicker.appendChild(b);
  });
  const noteInput = el("textarea", { maxlength: "200", placeholder: "상대에게 보이는 공개 메모 (모든 칸에 동일 적용)" });
  const privateInput = el("textarea", { maxlength: "200", placeholder: "나만 볼 수 있는 메모 (모든 칸에 동일 적용)" });
  const nameInput = el("input", { type: "text", maxlength: "20", placeholder: "표시할 이름 (예: 홍길동)" });
  nameInput.value = localStorage.getItem("guestName") || "";

  const body = [];
  if (isGuest) body.push(el("div", { class: "field" }, [el("label", { text: "이름 (게스트)" }), nameInput]));
  body.push(
    el("div", { class: "field" }, [el("label", { text: "마크 선택" }), emojiPicker]),
    el("div", { class: "field" }, [el("label", { text: "공개 메모 (상대도 볼 수 있어요)" }), noteInput]),
    el("div", { class: "field" }, [el("label", { text: "🔒 비공개 메모 (나만 보기)" }), privateInput])
  );

  openModal({
    title: `${list.length}개 시간 일괄 예약`,
    sub: blocked ? `${blocked}개는 이미 예약되어 제외됩니다.` : "선택한 모든 칸을 같은 내용으로 예약합니다.",
    body,
    actions: [
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "닫기"),
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          if (available.length === 0) { toast("예약 가능한 칸이 없습니다.", true); return; }
          let byName;
          if (isGuest) {
            byName = nameInput.value.trim();
            if (!byName) { toast("이름을 입력하세요.", true); return; }
            localStorage.setItem("guestName", byName);
          }
          const user = await ensureReserver();
          if (!user) return;
          const r = await bulkReserve(uid, available, selectedMark, noteInput.value.trim(), privateInput.value.trim(), byName, user);
          closeModal();
          toast(`${r.done}개 예약 완료${r.skipped ? ` · ${r.skipped}개 건너뜀` : ""}`);
        },
      }, "예약하기"),
    ],
  });
}

async function bulkReserve(uid, list, mark, note, privateText, byName, user) {
  user = user || currentUser;
  if (!user) return { done: 0, skipped: list.length };
  let done = 0, skipped = 0;
  for (const { d, h } of list) {
    const slotId = cellKey(d, h);
    const existing = gridState?.resByCell?.[slotId];
    if (existing && existing.byUid !== user.uid) { skipped++; continue; }
    try {
      await setDoc(doc(db, "schedules", uid, "reservations", slotId), {
        day: d, hour: h, mark,
        note: note || "",
        byUid: user.uid,
        byName: byName || user.displayName || "게스트",
        byPhoto: user.photoURL || "",
        isGuest: user.isAnonymous || false,
        createdAt: serverTimestamp(),
      });
      const mref = doc(db, "privateMemos", memoId(uid, slotId));
      if (privateText) {
        await setDoc(mref, { ownerUid: user.uid, scheduleUid: uid, slotId, text: privateText, updatedAt: serverTimestamp() });
      } else {
        await deleteDoc(mref).catch(() => {});
      }
      done++;
    } catch (e) {
      console.error(e);
      skipped++;
    }
  }
  return { done, skipped };
}

// 설정: 소개 + 공개 범위
function openSettingsModal(uid, data) {
  const bioInput = el("textarea", { maxlength: "160", placeholder: "예: 평일 저녁/주말 오전에 연락 가능합니다." });
  bioInput.value = data.bio || "";

  const visSelect = el("select");
  Object.entries(VISIBILITY).forEach(([key, v]) => {
    visSelect.appendChild(el("option", { value: key, ...(data.visibility || "public") === key ? { selected: "selected" } : {} }, `${v.label} — ${v.desc}`));
  });

  openModal({
    title: "시간표 설정",
    sub: "소개와 공개 범위를 설정하세요.",
    body: [
      el("div", { class: "field" }, [el("label", { text: "소개 / 메모" }), bioInput]),
      el("div", { class: "field" }, [el("label", { text: "공개 범위" }), visSelect]),
    ],
    actions: [
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "취소"),
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          try {
            await setDoc(doc(db, "schedules", uid), {
              bio: bioInput.value.trim(),
              visibility: visSelect.value,
              updatedAt: serverTimestamp(),
            }, { merge: true });
            closeModal();
            toast("저장했습니다.");
          } catch (e) {
            console.error(e);
            toast("저장 실패: " + (e.code || e.message), true);
          }
        },
      }, "저장"),
    ],
  });
  setTimeout(() => bioInput.focus(), 50);
}

function copyShareLink(uid) {
  return async () => {
    const url = location.origin + location.pathname + "#/u/" + encodeURIComponent(uid);
    try {
      await navigator.clipboard.writeText(url);
      toast("공유 링크를 복사했습니다.");
    } catch {
      prompt("아래 링크를 복사하세요:", url);
    }
  };
}

// ── 모달 시스템 ────────────────────────────────────────────────
function openModal({ title, sub, body, actions, onClose }) {
  closeModal();
  const backdrop = el("div", { class: "modal-backdrop", id: "modalBackdrop" });
  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-head" }, [el("h3", { text: title }), sub ? el("div", { class: "sub", text: sub }) : null]),
    el("div", { class: "modal-body" }, body.filter(Boolean)),
    el("div", { class: "modal-foot" }, (actions || []).filter(Boolean)),
  ]);
  backdrop.appendChild(modal);
  backdrop._onClose = onClose;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener("keydown", escClose);
  $("#modalRoot").appendChild(backdrop);
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
function closeModal() {
  const b = $("#modalBackdrop");
  if (b) { if (typeof b._onClose === "function") b._onClose(); b.remove(); }
  document.removeEventListener("keydown", escClose);
  modalOnRes = null;
}

// ── 설정 미완료 시 안내 ────────────────────────────────────────
function renderConfigHelp() {
  const view = $("#view");
  view.innerHTML = "";
  view.appendChild(
    el("section", { class: "hero" }, [
      el("h1", { text: "거의 다 됐어요! 🎉" }),
      el("p", {
        html:
          "이 앱을 실행하려면 본인의 <b>Firebase 프로젝트</b>에 연결해야 합니다.<br>" +
          "<code>firebase-config.js</code> 파일에 Firebase 설정값을 입력하고, " +
          "Google 로그인과 Firestore를 활성화하세요.",
      }),
      el("a", { class: "btn btn-primary", href: "https://console.firebase.google.com", target: "_blank", rel: "noopener" }, "Firebase 콘솔 열기"),
    ])
  );
}

// ── 아이콘 / 폴백 ──────────────────────────────────────────────
function googleIcon() {
  const span = el("span");
  span.innerHTML =
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  return span.firstChild;
}
function fallbackAvatar(name = "?") {
  const ch = encodeURIComponent((name || "?").trim().charAt(0).toUpperCase() || "?");
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='%23262c4f'/><text x='50%25' y='54%25' font-size='30' fill='%238b97ff' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif'>${ch}</text></svg>`;
}

// ── 시작 ───────────────────────────────────────────────────────
boot();
