// ─────────────────────────────────────────────────────────────
// 위클리 — 주간 시간표 공유 & 예약  (Firebase + Vanilla JS)
// ─────────────────────────────────────────────────────────────
import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, onSnapshot,
  addDoc, deleteDoc, serverTimestamp, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ── 상수 ───────────────────────────────────────────────────────
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const START_HOUR = 6;   // 표시 시작 시각
const END_HOUR = 24;    // 표시 끝 시각 (미포함)
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const MARKS = ["📌", "✅", "⭐", "❤️", "🔥", "☕", "🎯", "💬"];

const cellKey = (d, h) => `d${d}_h${h}`;
const hh = (h) => String(h).padStart(2, "0") + ":00";

// ── 전역 상태 ──────────────────────────────────────────────────
let app, auth, db;
let currentUser = null;
let unsubReservations = null; // 현재 보고 있는 시간표의 예약 실시간 구독 해제 함수

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

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    if (user) await upsertProfile(user);
    route();
  });

  window.addEventListener("hashchange", route);
  route();
}

// 로그인 시 본인 프로필을 schedules/{uid} 에 병합 저장 (둘러보기 목록에 노출)
async function upsertProfile(user) {
  try {
    const ref = doc(db, "schedules", user.uid);
    await setDoc(
      ref,
      {
        ownerName: user.displayName || "이름없음",
        ownerPhoto: user.photoURL || "",
        ownerEmail: user.email || "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("프로필 저장 실패", e);
  }
}

// ── 인증 영역 / 액션 ───────────────────────────────────────────
function renderAuthArea() {
  const area = $("#authArea");
  area.innerHTML = "";
  document.querySelectorAll("[data-auth-only]").forEach((n) => (n.style.display = currentUser ? "" : "none"));

  if (currentUser) {
    area.appendChild(
      el("div", { class: "user-chip" }, [
        el("img", { class: "avatar", src: currentUser.photoURL || fallbackAvatar(currentUser.displayName), alt: "" }),
        el("span", { class: "user-name", text: currentUser.displayName || "사용자" }),
        el("button", { class: "btn btn-sm btn-ghost", onclick: doLogout }, "로그아웃"),
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
function route() {
  if (unsubReservations) { unsubReservations(); unsubReservations = null; }
  const hash = location.hash || "#/";
  const view = $("#view");
  view.innerHTML = "";

  document.querySelectorAll(".nav-link").forEach((n) => n.classList.remove("active"));

  if (hash === "#/" || hash === "") {
    $('.nav-link[data-route="home"]')?.classList.add("active");
    renderHome(view);
  } else if (hash === "#/me") {
    $('.nav-link[data-route="me"]')?.classList.add("active");
    if (!currentUser) return renderLoginPrompt(view, "내 시간표를 작성하려면 로그인하세요.");
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
    const snap = await getDocs(query(collection(db, "schedules"), orderBy("updatedAt", "desc")));
    cards.innerHTML = "";
    let n = 0;
    snap.forEach((d) => {
      const data = d.data();
      if (!data.ownerName) return;
      n++;
      const planCount = data.cells ? Object.values(data.cells).filter((c) => c && (c.title || c.desc)).length : 0;
      cards.appendChild(
        el("div", { class: "card", onclick: () => (location.hash = "#/u/" + encodeURIComponent(d.id)) }, [
          el("div", { class: "card-head" }, [
            el("img", { class: "avatar", src: data.ownerPhoto || fallbackAvatar(data.ownerName), alt: "" }),
            el("div", {}, [
              el("div", { class: "card-name", text: data.ownerName }),
              el("div", { class: "card-sub", text: d.id === currentUser?.uid ? "내 시간표" : "시간표 보기" }),
            ]),
          ]),
          el("div", { class: "card-meta" }, [el("span", { html: `채워진 시간 <b>${planCount}</b>칸` })]),
        ])
      );
    });
    $("#homeCount").textContent = `${n}명`;
    if (n === 0) cards.appendChild(el("div", { class: "empty", text: "아직 공개된 시간표가 없습니다. 첫 번째로 작성해 보세요!" }));
  } catch (e) {
    console.error(e);
    cards.innerHTML = "";
    cards.appendChild(el("div", { class: "empty", text: "목록을 불러오지 못했습니다. Firestore 보안 규칙과 색인을 확인하세요." }));
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

// ── 시간표 화면 ────────────────────────────────────────────────
async function renderSchedule(view, uid) {
  const isOwner = currentUser && currentUser.uid === uid;
  const wrap = el("div");
  view.appendChild(wrap);
  wrap.appendChild(el("div", { class: "empty", text: "시간표를 불러오는 중…" }));

  let scheduleData = {};
  try {
    const snap = await getDoc(doc(db, "schedules", uid));
    if (!snap.exists() && !isOwner) {
      wrap.innerHTML = "";
      wrap.appendChild(el("div", { class: "empty", text: "존재하지 않는 시간표입니다." }));
      return;
    }
    scheduleData = snap.exists() ? snap.data() : {};
  } catch (e) {
    console.error(e);
    wrap.innerHTML = "";
    wrap.appendChild(el("div", { class: "empty", text: "시간표를 불러오지 못했습니다." }));
    return;
  }

  wrap.innerHTML = "";

  // 헤더
  const ownerName = scheduleData.ownerName || (isOwner ? currentUser.displayName : "사용자");
  const head = el("div", { class: "schedule-head" }, [
    el("div", { class: "owner" }, [
      el("img", { class: "avatar", style: "width:48px;height:48px", src: scheduleData.ownerPhoto || (isOwner ? currentUser.photoURL : "") || fallbackAvatar(ownerName), alt: "" }),
      el("div", {}, [
        el("h2", { text: ownerName + (isOwner ? " (나)" : "") + " 의 주간 시간표" }),
        el("div", { class: "bio", text: scheduleData.bio || (isOwner ? "소개/메모를 추가해 보세요." : "") }),
      ]),
    ]),
  ]);
  const actions = el("div", { class: "schedule-actions" });
  if (isOwner) {
    actions.appendChild(el("button", { class: "btn btn-sm", onclick: () => openBioModal(uid, scheduleData) }, "소개 편집"));
    actions.appendChild(el("button", { class: "btn btn-sm btn-ghost", onclick: copyShareLink(uid) }, "🔗 공유 링크"));
  } else if (currentUser) {
    actions.appendChild(el("button", { class: "btn btn-sm btn-ghost", onclick: copyShareLink(uid) }, "🔗 공유 링크"));
  }
  head.appendChild(actions);
  wrap.appendChild(head);

  // 안내
  wrap.appendChild(
    el("div", { class: "mode-hint" }, [
      isOwner
        ? "✏️ 칸을 클릭하면 그 시간에 할 일을 작성/수정할 수 있어요. 다른 사람이 남긴 예약도 칸에 표시됩니다."
        : currentUser
        ? "🖱️ 원하는 시간 칸을 클릭해 마크와 메모를 남기고 예약하세요. 채워진 칸에서 상대의 일정도 확인할 수 있어요."
        : "👀 둘러보는 중입니다. 예약을 남기려면 우측 상단에서 Google 로그인하세요.",
    ])
  );

  // 그리드
  const grid = el("div", { class: "grid", id: "grid" });
  grid.appendChild(el("div", { class: "corner gh" }));
  DAYS.forEach((d, i) => grid.appendChild(el("div", { class: "gh" + (i >= 5 ? " weekend" : ""), text: d })));

  const cells = scheduleData.cells || {};
  const cellNodes = {}; // key -> {planArea, resRow}
  HOURS.forEach((h) => {
    grid.appendChild(el("div", { class: "time", text: hh(h) }));
    DAYS.forEach((_, d) => {
      const key = cellKey(d, h);
      const plan = cells[key];
      const planArea = el("div", { class: "plan-area" });
      if (plan && (plan.title || plan.desc)) {
        if (plan.title) planArea.appendChild(el("div", { class: "plan-title", text: plan.title }));
        if (plan.desc) planArea.appendChild(el("div", { class: "plan-desc", text: plan.desc }));
      }
      const resRow = el("div", { class: "res-row" });
      const cell = el(
        "div",
        {
          class: "cell" + (plan && (plan.title || plan.desc) ? " has-plan" : ""),
          onclick: () => onCellClick(uid, isOwner, d, h, cells[key]),
        },
        [planArea, resRow]
      );
      cellNodes[key] = { resRow };
      grid.appendChild(cell);
    });
  });

  wrap.appendChild(el("div", { class: "grid-wrap" }, grid));

  // 예약 실시간 구독
  subscribeReservations(uid, cellNodes, isOwner);
}

// 예약 실시간 표시
function subscribeReservations(uid, cellNodes, isOwner) {
  const col = collection(db, "schedules", uid, "reservations");
  unsubReservations = onSnapshot(
    col,
    (snap) => {
      const byCell = {};
      snap.forEach((d) => {
        const r = { id: d.id, ...d.data() };
        const key = cellKey(r.day, r.hour);
        (byCell[key] ||= []).push(r);
      });
      Object.entries(cellNodes).forEach(([key, node]) => {
        node.resRow.innerHTML = "";
        const list = byCell[key] || [];
        list.slice(0, 4).forEach((r) => {
          node.resRow.appendChild(el("span", { class: "res-dot", title: `${r.byName}: ${r.note || ""}` }, [r.mark || "📌"]));
        });
        if (list.length > 4) node.resRow.appendChild(el("span", { class: "res-dot", text: `+${list.length - 4}` }));
      });
      // 현재 열린 예약목록 모달 갱신을 위해 캐시
      subscribeReservations._cache = { uid, byCell, isOwner };
      if (typeof subscribeReservations._onUpdate === "function") subscribeReservations._onUpdate();
    },
    (err) => {
      console.error("예약 구독 오류", err);
      toast("예약 정보를 불러오지 못했습니다.", true);
    }
  );
}

// ── 칸 클릭 처리 ───────────────────────────────────────────────
function onCellClick(uid, isOwner, day, hour, plan) {
  if (isOwner) openPlanModal(uid, day, hour, plan);
  else openReservationModal(uid, day, hour, plan);
}

// 소유자: 일정 편집 모달
function openPlanModal(uid, day, hour, plan) {
  const titleInput = el("input", { type: "text", maxlength: "40", value: plan?.title || "", placeholder: "예: 운동, 회의, 공부" });
  const descInput = el("textarea", { maxlength: "200", placeholder: "이 시간에 대한 자세한 설명 (선택)" });
  descInput.value = plan?.desc || "";

  openModal({
    title: `${DAYS[day]}요일 ${hh(hour)} 일정`,
    sub: "이 시간에 무엇을 하는지 작성하세요.",
    body: [
      el("div", { class: "field" }, [el("label", { text: "제목" }), titleInput]),
      el("div", { class: "field" }, [el("label", { text: "상세 설명" }), descInput]),
    ],
    actions: [
      plan && (plan.title || plan.desc)
        ? el("button", { class: "btn btn-danger", onclick: async () => { await savePlan(uid, day, hour, null); closeModal(); toast("삭제했습니다."); } }, "삭제")
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
  });
  setTimeout(() => titleInput.focus(), 50);
}

async function savePlan(uid, day, hour, value) {
  const ref = doc(db, "schedules", uid);
  const key = cellKey(day, hour);
  try {
    const snap = await getDoc(ref);
    const cells = (snap.exists() && snap.data().cells) || {};
    if (value) cells[key] = value; else delete cells[key];
    await setDoc(ref, { cells, updatedAt: serverTimestamp() }, { merge: true });
    // 화면 갱신
    renderSchedule($("#view"), uid);
  } catch (e) {
    console.error(e);
    toast("저장 실패: " + (e.code || e.message), true);
  }
}

// 방문자: 예약 모달
function openReservationModal(uid, day, hour, plan) {
  if (!currentUser) {
    openModal({
      title: "로그인이 필요합니다",
      sub: "예약을 남기려면 Google 로그인이 필요해요.",
      body: [],
      actions: [
        el("button", { class: "btn btn-ghost", onclick: closeModal }, "닫기"),
        el("button", { class: "btn btn-google", onclick: () => { closeModal(); doLogin(); } }, [googleIcon(), "로그인"]),
      ],
    });
    return;
  }

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
  const noteInput = el("textarea", { maxlength: "200", placeholder: "예약 메모를 남기세요. 예: 30분 통화 가능할까요?" });

  const planInfo = plan && (plan.title || plan.desc)
    ? el("div", { class: "mode-hint", style: "margin:0" }, [el("b", { text: plan.title || "" }), plan.desc ? " — " + plan.desc : ""])
    : el("div", { class: "card-sub", text: "상대가 이 시간에 등록한 일정은 없습니다." });

  // 예약 목록 영역 (실시간)
  const listWrap = el("div", { class: "res-list" });
  const renderList = () => {
    const cache = subscribeReservations._cache;
    const items = (cache?.byCell?.[cellKey(day, hour)]) || [];
    listWrap.innerHTML = "";
    if (items.length === 0) { listWrap.appendChild(el("div", { class: "card-sub", text: "아직 예약이 없습니다." })); return; }
    items
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      .forEach((r) => {
        const canDelete = currentUser && (currentUser.uid === r.byUid || currentUser.uid === uid);
        listWrap.appendChild(
          el("div", { class: "res-item" }, [
            el("span", { class: "res-mark", text: r.mark || "📌" }),
            el("img", { class: "avatar avatar-sm", src: r.byPhoto || fallbackAvatar(r.byName), alt: "" }),
            el("div", { class: "grow" }, [
              el("div", { class: "who", text: r.byName || "익명" }),
              r.note ? el("div", { class: "note", text: r.note }) : null,
            ]),
            canDelete ? el("button", { class: "btn btn-sm btn-danger", onclick: () => removeReservation(uid, r.id) }, "삭제") : null,
          ])
        );
      });
  };
  subscribeReservations._onUpdate = renderList;
  renderList();

  openModal({
    title: `${DAYS[day]}요일 ${hh(hour)} 예약`,
    sub: "마크를 고르고 메모를 남겨 예약하세요.",
    body: [
      planInfo,
      el("div", { class: "field" }, [el("label", { text: "마크 선택" }), emojiPicker]),
      el("div", { class: "field" }, [el("label", { text: "메모" }), noteInput]),
      el("div", { class: "divider" }),
      el("div", { class: "field" }, [el("label", { text: "이 시간의 예약 현황" }), listWrap]),
    ],
    actions: [
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "닫기"),
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          await addReservation(uid, day, hour, selectedMark, noteInput.value.trim());
          noteInput.value = "";
          toast("예약을 남겼습니다.");
        },
      }, "예약하기"),
    ],
    onClose: () => { subscribeReservations._onUpdate = null; },
  });
}

async function addReservation(uid, day, hour, mark, note) {
  try {
    await addDoc(collection(db, "schedules", uid, "reservations"), {
      day, hour, mark,
      note: note || "",
      byUid: currentUser.uid,
      byName: currentUser.displayName || "익명",
      byPhoto: currentUser.photoURL || "",
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(e);
    toast("예약 실패: " + (e.code || e.message), true);
  }
}

async function removeReservation(uid, resId) {
  try {
    await deleteDoc(doc(db, "schedules", uid, "reservations", resId));
    toast("예약을 취소했습니다.");
  } catch (e) {
    console.error(e);
    toast("삭제 실패: " + (e.code || e.message), true);
  }
}

// 소개 편집
function openBioModal(uid, data) {
  const input = el("textarea", { maxlength: "160", placeholder: "예: 평일 저녁/주말 오전에 연락 가능합니다." });
  input.value = data.bio || "";
  openModal({
    title: "소개 / 메모 편집",
    sub: "시간표 상단에 표시됩니다.",
    body: [el("div", { class: "field" }, [el("label", { text: "소개" }), input])],
    actions: [
      el("button", { class: "btn btn-ghost", onclick: closeModal }, "취소"),
      el("button", {
        class: "btn btn-primary",
        onclick: async () => {
          await setDoc(doc(db, "schedules", uid), { bio: input.value.trim(), updatedAt: serverTimestamp() }, { merge: true });
          closeModal();
          renderSchedule($("#view"), uid);
          toast("저장했습니다.");
        },
      }, "저장"),
    ],
  });
  setTimeout(() => input.focus(), 50);
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
  subscribeReservations._onUpdate = null;
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
