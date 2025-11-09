// ---------- Импорты ----------

import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ---------- Мини-замена date-fns ----------
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function subWeeks(date, weeks) {
  return addDays(date, -weeks * 7);
}

function startOfWeekFor(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = воскресенье
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseISO(str) {
  // Делаем корректную локальную дату, а не UTC-сдвинутую
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function format(date, pattern) {
  if (!(date instanceof Date) || isNaN(date)) return "";
  const options = {};
  switch (pattern) {
    case "d":
      options.day = "numeric";
      break;
    case "d MMM":
      options.day = "numeric";
      options.month = "short";
      break;
    case "yyyy-MM-dd":
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    case "d LLL":
      options.day = "numeric";
      options.month = "short";
      break;
    default:
      options.day = "numeric";
      options.month = "short";
      options.year = "numeric";
  }
  return new Intl.DateTimeFormat("ru-RU", options)
    .format(date)
    .replace(/\.$/, "");
}

// ---------- Фиктивная "локаль" ru ----------
const ru = {
  code: "ru",
  formatLong: {},
};
// ---------- Глобальное состояние ----------
let bookings = [];
let packages = [];

const state = {
  anchorDate: new Date(),

  // модал добавления записи
  modalOpen: false,
  modalDateISO: null,
  modalHour: 9,
  modalClient: "",

  // модал добавления пакета
  packageModalOpen: false,
  packageClient: "",
  packageSize: 10,

  // выбранная бронь (для показа крестика)
  selectedBookingId: null,

  // раскрытия
  expandedClients: {},
  expandedPackages: {},

  // модал подтверждения удаления
  confirm: {
    open: false,
    title: "",
    type: null,
    bookingId: null
  }
};


// ---------- Навигация ----------
let currentPage = "calendar"; // текущая страница: "calendar" или "clients"

// ---------- Инициализация ----------
document.addEventListener("DOMContentLoaded", () => {
  initFirestoreSubscriptions();
  initGlobalHandlers();
  render();
});

// ---------- Подписки Firestore ----------
function initFirestoreSubscriptions() {
  onSnapshot(collection(db, "bookings"), (snap) => {
    bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });

  onSnapshot(collection(db, "packages"), (snap) => {
    packages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
// --- Состояние свайпа по календарю ---
const swipe = {
  active: false,
  startX: 0,
  startY: 0,
  dx: 0,
  zone: null
};


// ---------- Обработчики событий ----------
function initGlobalHandlers() {









  document.body.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-bind='modalClient']")) {
      state.modalClient = el.value;
    }
    if (el.matches("[data-bind='packageSize']")) {
      state.packageSize = parseInt(el.value, 10) || 10;
    }
    if (el.matches("[data-bind='packageClient']")) {
      state.packageClient = el.value;
    }
  });

 // ===== Свайп по календарю для смены недели =====
// ===== Свайп по календарю для смены недели =====

let swipeX = 0;
let startX = 0;
let isDragging = false;

document.addEventListener("touchstart", (e) => {
  const zone = e.target.closest(".calendar-scroll-inner");
  if (!zone) return;
  isDragging = true;
  startX = e.touches[0].clientX;
  zone.style.transition = "none";
});

document.addEventListener("touchmove", (e) => {
  if (!isDragging) return;
  const zone = document.querySelector(".calendar-scroll-inner");
  swipeX = e.touches[0].clientX - startX;
  // сохраняем центральную неделю, добавляем подглядывание соседней
  zone.style.transform = `translateX(calc(-33.333% + ${swipeX}px))`;
});

document.addEventListener("touchend", () => {
  if (!isDragging) return;
  isDragging = false;
  const zone = document.querySelector(".calendar-scroll-inner");
  if (!zone) return;

  const THRESHOLD = 60; // порог в пикселях
  const ANIM_SPEED = 0.3; // скорость плавного вставания
  const EASING = "cubic-bezier(0.5, 0.9, 0.9, 0.8)"; // мягкий айфоновский easing

  if (swipeX < -THRESHOLD) {
    // Свайп влево → следующая неделя
    zone.style.transition = `transform 0.35s ${EASING}`;
    zone.style.transform = "translateX(-66.666%)"; // уходит влево

    zone.addEventListener("transitionend", function next() {
      zone.removeEventListener("transitionend", next);

      state.anchorDate = addWeeks(state.anchorDate, 1);
      render();

      const newZone = document.querySelector(".calendar-scroll-inner");
      if (!newZone) return;

      newZone.style.transition = "none";
      newZone.style.transform = "translateX(0%)"; // новая неделя справа

      requestAnimationFrame(() => {
        newZone.style.transition = `transform ${ANIM_SPEED}s ${EASING}`;
        newZone.style.transform = "translateX(-33.333%)"; // плавно центр
      });
    });
  } else if (swipeX > THRESHOLD) {
    // Свайп вправо → предыдущая неделя
    zone.style.transition = `transform 0.35s ${EASING}`;
    zone.style.transform = "translateX(0%)"; // уходит вправо

    zone.addEventListener("transitionend", function next() {
      zone.removeEventListener("transitionend", next);

      state.anchorDate = subWeeks(state.anchorDate, 1);
      render();

      const newZone = document.querySelector(".calendar-scroll-inner");
      if (!newZone) return;

      newZone.style.transition = "none";
      newZone.style.transform = "translateX(-66.666%)"; // новая неделя слева

      requestAnimationFrame(() => {
        newZone.style.transition = `transform ${ANIM_SPEED}s ${EASING}`;
        newZone.style.transform = "translateX(-33.333%)"; // плавно центр
      });
    });
  } else {
    // Недотянул — просто вернуться
    zone.style.transition = `transform ${ANIM_SPEED}s ${EASING}`;
    zone.style.transform = "translateX(-33.333%)";
  }

  swipeX = 0;
  closeAllTransient();
});



// ======== Долгое нажатие для добавления / удаления ========

// ======== Долгое нажатие для добавления / удаления ========

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;
let longPressTimer = null;
let lpStartX = 0, lpStartY = 0;
let targetEl = null;

document.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  lpStartX = t.clientX;
  lpStartY = t.clientY;

  targetEl = e.target.closest(".cell-clickable, .booking-item");
  if (!targetEl) return;

  longPressTimer = setTimeout(() => {
    const cell = targetEl.closest(".cell-clickable");
    const booking = targetEl.closest(".booking-item");

    if (cell && cell.dataset.date && cell.dataset.hour) {
      // ✳️ Добавление
      openAddBookingModal(cell.dataset.date, parseInt(cell.dataset.hour, 10));
    }

    if (booking && booking.dataset.id) {
      // ✳️ Удаление
      openConfirmDeleteBooking(booking.dataset.id);
    }
  }, LONG_PRESS_MS);
}, { passive: false });

document.addEventListener("touchmove", (e) => {
  if (!longPressTimer) return;
  const t = e.touches[0];
const dx = Math.abs(t.clientX - lpStartX);
const dy = Math.abs(t.clientY - lpStartY);

  if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}, { passive: true });

document.addEventListener("touchend", () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}, { passive: true });

// 🔒 Запрещаем системное меню (iOS, Android, desktop)
document.addEventListener("contextmenu", e => e.preventDefault());



}




// 🔒 Отключаем стандартное контекстное меню
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});


// ---------- Вспомогательные ----------
function closeAllTransient() {
  state.modalOpen = false;
  state.packageModalOpen = false;
  state.selectedBookingId = null;
  state.confirm = { open: false, title: "", type: null, bookingId: null };
}

function weekDays(baseDate) {
  const start = startOfWeekFor(baseDate);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const HOURS = Array.from({ length: 15 }, (_, i) => 9 + i);

function formatHourForTH(hour) {
  return `<span class="time-label">${hour}<span class="dot">.</span>00</span>`;
}

function formatHourForRU(thHour) {
  const ruHour = (thHour + 24 - 4) % 24;
  return `<span class="time-label">${ruHour}<span class="dot">.</span>00</span>`;
}



function clientNames() {
  const all = [];
  for (const p of packages) {
    if (p.clientName) all.push(p.clientName);
    if (Array.isArray(p.clientNames)) all.push(...p.clientNames);
  }
  return [...new Set(all)];
}

function activeClients() {
  return clientNames().filter((n) =>
    packages.some(
      (p) =>
        (p.clientName === n ||
          (Array.isArray(p.clientNames) && p.clientNames.includes(n))) &&
        (p.used || 0) < p.size
    )
  );
}

function formatPurchase(dateISO) {
  try {
    return format(parseISO(dateISO), "d LLL");
  } catch {
    return dateISO || "";
  }
}

function bookingsForPackage(packageId, clientName) {
  return bookings
    .filter(
      (b) => b.packageId === packageId && b.clientName === clientName
    )
    .sort(
      (a, b) =>
        a.dateISO.localeCompare(b.dateISO) || (a.hour || 0) - (b.hour || 0)
    );
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Рендер ----------
function render() {
  const app = document.getElementById("app");
  if (!app) return;

  if (currentPage === "calendar") {
    app.innerHTML = `
      ${renderHeader()}
      ${renderTable()}
      ${renderActiveClientsBar()}  <!-- вот этот новый короткий блок -->
      ${state.modalOpen ? renderAddBookingModal() : ""}
      ${state.packageModalOpen ? renderPackageModal() : ""}
      ${state.confirm.open ? renderConfirmModal() : ""}
    `;
  }

  if (currentPage === "clients") {
    app.innerHTML = `
      ${renderClientsPanel()}  <!-- полностью твой старый блок -->
      ${state.packageModalOpen ? renderPackageModal() : ""}
      ${state.confirm.open ? renderConfirmModal() : ""}
    `;
  }
}



function renderHeader() {
  const start = startOfWeekFor(state.anchorDate);
  const end = addDays(start, 6);

  // Проверяем, один ли месяц в этой неделе
  const startMonth = start.toLocaleString("ru-RU", { month: "long" });
  const endMonth = end.toLocaleString("ru-RU", { month: "long" });
  const year = start.getFullYear();

  // Если неделя пересекает границу месяцев → показываем оба
  const monthLabel =
    startMonth === endMonth
      ? `${startMonth[0].toUpperCase() + startMonth.slice(1)} ${year}`
      : `${startMonth[0].toUpperCase() + startMonth.slice(1)} – ${
          endMonth[0].toUpperCase() + endMonth.slice(1)
        } ${year}`;

  return `
    <header class="calendar-header">
      <div class="calendar-header-left">
        <span class="month-label">${monthLabel}</span>
      </div>
      <div class="calendar-header-right">

        <button data-action="today">  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="3"></circle>
                                        <path d="M12 2v2m0 16v2m10-10h-2M4 12H2"></path>
                                      </svg></button>

      </div>
    </header>
  `;
}






// ---------- Остальной код ----------
// (всё, что идёт после renderHeader, полностью совпадает с твоим оригиналом)

function renderWeek(offset) {
  const base = addWeeks(state.anchorDate, offset);
  const week = weekDays(base);
  const ruShort = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

  let html = `<table><thead><tr>`;

week.forEach((day, idx) => {
  const dateStr = format(day, "d"); // ← только число
  const weekday = ruShort[day.getDay()];
  const isWeekend = idx >= 5;

  html += `
    <th class="${isWeekend ? "bg-orange" : "bg-red"}">
      <span class="date">${dateStr}</span>
      <span class="weekday">${weekday}</span>
    </th>`;
});


  html += `</tr></thead><tbody>`;

  HOURS.forEach((h) => {
    html += `<tr>`;

    week.forEach((day, idx) => {
      const dateISO = format(day, "yyyy-MM-dd");
      const items = bookings.filter(
        (b) => b.dateISO === dateISO && b.hour === h
      );
      const isWeekend = idx >= 5;

      if (items.length === 0) {
        html += `
          <td class="bg-${isWeekend ? "orange" : "white"} cell-clickable"
              data-action="open-add-booking"
              data-date="${dateISO}"
              data-hour="${h}"></td>`;
      } else {
        html += `<td class="bg-blue"><div class="booking-wrap">`;
        items.forEach((b) => {
html += `
  <div class="booking-item" data-id="${b.id}">
    <div class="booking-name">${escapeHtml(b.clientName)}</div>
    <div class="booking-session">${b.sessionNumber || ""}</div>
  </div>`;

        });
        html += `</div></td>`;
      }
    });

    html += `</tr>`;
  });

  html += `</tbody></table>`;
  return html;
}


// ---------- Основная таблица календаря ----------
function renderTable() {
  return `
    <div class="calendar-container">
      <div class="calendar-left">
        ${renderFixedTimes()}
      </div>
      <div class="calendar-right">
        <div class="calendar-scroll">
          <div class="calendar-scroll-inner">
            ${renderWeek(-1)}
            ${renderWeek(0)}
            ${renderWeek(1)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFixedTimes() {
  let html = `<table class="fixed-time-table"><thead><tr>
    <th class="bg-yellow">Тай</th>
    <th class="bg-gray">Рус</th>
  </tr></thead><tbody>`;

  HOURS.forEach((h) => {
    html += `<tr>
      <td class="bg-yellow time-cell">${formatHourForTH(h)}</td>
      <td class="bg-gray time-cell">${formatHourForRU(h)}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  return html;
}



// ---------- Панель клиентов ----------
function renderClientsPanel() {
  const names = clientNames();

  let html = `<div class="client-panel">
    <div class="client-panel-header">
      <button class="btn-green" data-action="open-package-modal-main">+</button>
    </div>
    <div class="client-list">
  `;

  if (names.length === 0) {
    html += `<div class="text-gray">Нет данных</div>`;
  } else {
    names.forEach((name) => {
      const pkgList = packages.filter(
        (p) =>
          p.clientName === name ||
          (Array.isArray(p.clientNames) && p.clientNames.includes(name))
      );

      const activePkg = pkgList.find((p) => (p.used || 0) < p.size);

      const sharedPkg = pkgList.find(
        (p) => Array.isArray(p.clientNames) && p.clientNames.length > 1
      );
      const isSecondaryInShared =
        sharedPkg && sharedPkg.clientNames[0] !== name;

      const expanded = !!state.expandedClients[name];

      html += `
        <div class="client-card">
          <div class="client-card-header">
            <div class="client-name"
                 data-action="toggle-client-expand"
                 data-client="${escapeHtml(name)}">
              ${escapeHtml(name)}
              <span class="client-status">
                ${
                  activePkg
                    ? `${activePkg.used || 0}/${activePkg.size}`
                    : "✓ завершено"
                }
              </span>
            </div>
            <div class="client-actions">
              ${
                !isSecondaryInShared
                  ? `<button data-action="open-package-modal-client"
                             data-client="${escapeHtml(name)}">
                        + пакет
                     </button>`
                  : ""
              }
              <button class="btn-red"
                      data-action="remove-client"
                      data-client="${escapeHtml(name)}">
                удалить
              </button>
            </div>
          </div>
      `;

      if (expanded) {
        html += `<div class="package-details">`;
        pkgList.forEach((p) => {
          const pkgExpanded = !!state.expandedPackages[p.id];
          const used = p.used || 0;
          const size = p.size;
          html += `
            <div class="package-line">
              <div data-action="toggle-package-expand"
                   data-pid="${p.id}">
                ${used}/${size} — ${formatPurchase(p.addedISO)}
                ${
                  p.clientNames && p.clientNames.length > 1
                    ? `<span class="text-gray">
                         (Общий: ${p.clientNames.join(", ")})
                       </span>`
                    : ""
                }
              </div>
              ${
                used >= size
                  ? `<button class="package-remove-btn"
                             data-action="remove-package"
                             data-client="${escapeHtml(name)}"
                             data-pid="${p.id}">
                        ✕
                     </button>`
                  : ""
              }
            </div>
          `;

          if (pkgExpanded) {
            const sessions = bookingsForPackage(p.id, name);
            html += `<div class="package-sessions">`;
            if (sessions.length === 0) {
              html += `<div>Нет записей</div>`;
            } else {
              sessions.forEach((b) => {
                html += `<div>
                  ${b.sessionNumber || "?"} / ${size} —
                  ${escapeHtml(
                    format(parseISO(b.dateISO), "d LLL", { locale: ru })
                  )}
                </div>`;
              });
            }
            html += `</div>`;
          }
        });
        html += `</div>`;
      }

      html += `</div>`;
    });
  }

  html += `</div></div>`;
  return html;
}

// ---------- Модал: добавление записи ----------
function openAddBookingModal(dateISO, hour) {
  state.modalOpen = true;
  state.modalDateISO = dateISO;
  state.modalHour = hour;
  state.modalClient = activeClients()[0] || "";
  state.selectedBookingId = null;
  render();
}

function renderAddBookingModal() {
  const d = state.modalDateISO
    ? format(parseISO(state.modalDateISO), "d LLL (EEE)", { locale: ru })
    : "";
  return `
    <div class="modal-overlay" data-action="overlay-click">
      <div class="modal">
        <h3>Добавить запись</h3>
        <p>${d} — ${formatHourForTH(
    state.modalHour
  )} / ${formatHourForRU(state.modalHour)}</p>
        <select data-bind="modalClient">
          <option value="">Выберите клиента</option>
          ${clientNames()
            .map(
              (c) => `
              <option value="${escapeHtml(c)}" ${
                c === state.modalClient ? "selected" : ""
              }>
                ${escapeHtml(c)}
              </option>`
            )
            .join("")}
        </select>
        <div class="modal-actions">
          <button class="btn-blue" data-action="save-booking">Сохранить</button>
          <button class="btn-gray" data-action="close-add-booking">Отмена</button>
        </div>
      </div>
    </div>
  `;
}

async function addBooking() {
  const name = (state.modalClient || "").trim();
  if (!name) {
    alert("Выберите клиента.");
    return;
  }

  // Находим все пакеты клиента
  let pkgList = packages.filter(
    (p) =>
      p.clientName === name ||
      (Array.isArray(p.clientNames) && p.clientNames.includes(name))
  );
  if (pkgList.length === 0) {
    alert("У клиента нет доступных пакетов.");
    return;
  }

  // Если есть общий пакет — используем группу имён
  const sharedPkg = pkgList.find(
    (p) => Array.isArray(p.clientNames) && p.clientNames.length > 1
  );
  if (sharedPkg) {
    const sharedNames = [...sharedPkg.clientNames].sort();
    pkgList = packages.filter((p) => {
      if (!Array.isArray(p.clientNames)) return false;
      const current = [...p.clientNames].sort();
      return JSON.stringify(current) === JSON.stringify(sharedNames);
    });
  }

  // Берём активный пакет
  pkgList = pkgList.sort(
    (a, b) => new Date(a.addedISO || 0) - new Date(b.addedISO || 0)
  );
  const targetPkg = pkgList.find((p) => (p.used || 0) < p.size);
  if (!targetPkg) {
    alert("У клиента нет доступных пакетов.");
    return;
  }

  const dateISO = state.modalDateISO;
  const hour = state.modalHour;

  // Проверяем, что слот не занят
  const exists = bookings.some(
    (b) => b.dateISO === dateISO && b.hour === hour
  );
  if (exists) {
    alert("На это время уже есть запись.");
    return;
  }

  // Добавляем новую бронь в Firestore
  const newBookingRef = await addDoc(collection(db, "bookings"), {
    clientName: name,
    dateISO,
    hour,
    packageId: targetPkg.id
  });

  // Теперь пересчитываем номера тренировок пакета
  await reindexPackageSessions(targetPkg.id);
  state.modalOpen = false;
  render();
}


// ---------- Выбор и удаление бронирования ----------
function toggleSelectedBooking(id) {
  state.selectedBookingId = state.selectedBookingId === id ? null : id;
  render();
}

function openConfirmDeleteBooking(id) {
  state.confirm = {
    open: true,
    title: "Удалить запись?",
    type: "booking",
    bookingId: id
  };
  render();
}

function renderConfirmModal() {
  return `
    <div class="modal-overlay" data-action="overlay-click">
      <div class="modal" data-role="confirm-modal">
        <h3>${escapeHtml(state.confirm.title || "Удалить запись?")}</h3>
        <div class="modal-actions">
          <button class="btn-gray" data-action="confirm-cancel">Отмена</button>
          <button class="btn-red"
                  data-action="confirm-ok"
                  data-id="${state.confirm.bookingId || ''}">
            Удалить
          </button>
        </div>
      </div>
    </div>
  `;
}




async function handleConfirmOk(e) {
  // Если функцию вызвали не напрямую из события, пробуем взять event из window
  const event = e || window._lastClickEvent;
  const btn = event?.target?.closest("[data-id]");
  const id = btn?.dataset.id || state.confirm.bookingId;

  console.log("✅ confirm-ok clicked", { id, state: state.confirm });

  if (!id) {
    console.warn("⚠️ Нет bookingId");
    state.confirm = { open: false, title: "", type: null, bookingId: null };
    render();
    return;
  }

  // Закрываем модалку
  state.confirm = { open: false, title: "", type: null, bookingId: null };
  render();

  try {
    await deleteBookingAndReindex(id);
    console.log("🗑 Удалено бронирование:", id);
  } catch (err) {
    console.error("❌ Ошибка при удалении:", err);
    alert("Ошибка удаления, см. консоль");
  }
}




// Пересчёт номеров после удаления
async function deleteBookingAndReindex(id) {
  console.log("🗑 Пытаюсь удалить бронь", id);

  const b = bookings.find((x) => x.id === id);
  if (!b) {
    console.warn("⚠️ Бронь с таким id не найдена в локальном массиве", id);
    return;
  }

  // 1. Удаляем саму бронь
  try {
    await deleteDoc(doc(db, "bookings", id));
    console.log("✅ Бронь удалена из Firestore");
  } catch (err) {
    console.error("❌ Ошибка удаления брони:", err);
    alert("Ошибка удаления записи (см. консоль).");
    return;
  }

  // 2. Если у брони нет packageId — просто выходим
  if (!b.packageId) {
    console.log("ℹ️ У брони нет packageId — пересчёт пакета пропускаем");
    return;
  }

  // 3. Пересчитываем оставшиеся тренировки пакета
  try {
    const q = query(
      collection(db, "bookings"),
      where("packageId", "==", b.packageId)
    );
    const snap = await getDocs(q);

    const remaining = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort(
        (a, c) =>
          a.dateISO.localeCompare(c.dateISO) ||
          (a.hour || 0) - (c.hour || 0)
      );

    // перенумеровываем сессии
    await Promise.all(
      remaining.map((item, idx) =>
        updateDoc(doc(db, "bookings", item.id), {
          sessionNumber: idx + 1
        })
      )
    );

    // обновляем used в пакете
    await updateDoc(doc(db, "packages", b.packageId), {
      used: remaining.length
    });

    console.log("✅ Пересчёт пакета завершён");
  } catch (err) {
    console.error("❌ Ошибка пересчёта пакета:", err);
    // тут НЕ падаем, запись уже удалена
  }
}



async function reindexPackageSessions(packageId) {
  // Получаем все брони пакета
  const q = query(collection(db, "bookings"), where("packageId", "==", packageId));
  const snap = await getDocs(q);
  const sessions = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        a.dateISO.localeCompare(b.dateISO) || (a.hour || 0) - (b.hour || 0)
    );

  // Присваиваем новые номера
  await Promise.all(
    sessions.map((item, idx) =>
      updateDoc(doc(db, "bookings", item.id), { sessionNumber: idx + 1 })
    )
  );

  // Обновляем used в пакете
  await updateDoc(doc(db, "packages", packageId), {
    used: sessions.length
  });
}

// ---------- Модал: добавление пакета ----------
function openPackageModal(prefill) {
  state.packageModalOpen = true;
  state.packageClient = prefill || "";
  state.packageSize = 10;
  render();
}

function renderPackageModal() {
  return `
    <div class="modal-overlay" data-action="close-package-modal">
      <div class="modal">
        <h3>Добавить пакет</h3>
        <input type="text"
               data-bind="packageClient"
               placeholder="Имя клиента (можно несколько через запятую)"
               value="${escapeHtml(state.packageClient)}" />
        <select data-bind="packageSize">
          <option value="1" ${state.packageSize === 1 ? "selected" : ""}>1 трен.</option>
          <option value="5" ${state.packageSize === 5 ? "selected" : ""}>5 трен.</option>
          <option value="10" ${state.packageSize === 10 ? "selected" : ""}>10 трен.</option>
          <option value="20" ${state.packageSize === 20 ? "selected" : ""}>20 трен.</option>
        </select>
        <div class="modal-actions">
          <button class="btn-blue" data-action="save-package">Сохранить</button>
          <button class="btn-gray" data-action="close-package-modal">Отмена</button>
        </div>
      </div>
    </div>
  `;
}

async function savePackage() {
  const raw = (state.packageClient || "").trim();
  if (!raw) {
    alert("Введите имя клиента (или несколько через запятую).");
    return;
  }

  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (names.length === 0) {
    alert("Введите хотя бы одно имя.");
    return;
  }

  const data = {
    size: Number(state.packageSize || 10),
    used: 0,
    addedISO: new Date().toISOString().slice(0, 10)
  };

  if (names.length === 1) {
    data.clientName = names[0];
  } else {
    data.clientNames = names;
  }

  await addDoc(collection(db, "packages"), data);

  state.packageModalOpen = false;
  render();
}

// ---------- Удаление пакета ----------
async function requestRemovePackage(clientName, packageId) {
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg || (pkg.used || 0) < pkg.size) {
    alert("Нельзя удалить незавершённый пакет.");
    return;
  }
  if (!window.confirm(`Удалить пакет ${pkg.used}/${pkg.size} у ${clientName}?`))
    return;
  await deleteDoc(doc(db, "packages", packageId));
}

// ---------- Удаление клиента ----------
async function requestRemoveClient(clientName) {
  const pkgList = packages.filter((p) => p.clientName === clientName);
  const hasActive = pkgList.some((p) => (p.used || 0) < p.size);
  if (hasActive) {
    alert("Нельзя удалить клиента, пока есть незавершённые пакеты.");
    return;
  }
  if (!window.confirm(`Удалить клиента ${clientName}?`)) return;

  for (const p of pkgList) {
    await deleteDoc(doc(db, "packages", p.id));
  }

  const qb = query(
    collection(db, "bookings"),
    where("clientName", "==", clientName)
  );
  const snapB = await getDocs(qb);
  for (const b of snapB.docs) {
    await deleteDoc(doc(db, "bookings", b.id));
  }
}

// ---------- Тогглы раскрытия ----------
function toggleClientExpand(name) {
  state.expandedClients[name] = !state.expandedClients[name];
  render();
}

function togglePackageExpand(id) {
  state.expandedPackages[id] = !state.expandedPackages[id];
  render();
}
// ---- ТЕСТ FIRESTORE ----
// ---- ТЕСТ FIRESTORE ----
getDocs(collection(db, "packages"))
  .then(snap => {
    console.log("🔥 Firestore test — packages:", snap.docs.map(d => d.data()));
  })
  .catch(err => {
    console.error("❌ Firestore error:", err);
  });


// ---- переключение страниц ----
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-page]");
  if (!btn) return;

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  currentPage = btn.dataset.page;
  render();
});


// ---- панель под календарем ----
function renderActiveClientsBar() {
  const active = activeClients();
  if (active.length === 0) return "";

  let html = `<div class="active-clients-bar">`;

  active.forEach((name) => {
    const pkg = packages.find(
      (p) =>
        (p.clientName === name ||
          (Array.isArray(p.clientNames) && p.clientNames.includes(name))) &&
        (p.used || 0) < p.size
    );
    if (!pkg) return;

    const progress = ((pkg.used || 0) / pkg.size) * 100;
    html += `
      <div class="client-progress">
        <div class="client-progress-label">${escapeHtml(truncateName (name))}</div>
        <div class="client-progress-cont">
            <div class="client-progress-pkgSize">${pkg.used}/${pkg.size}</div>
            <div class="client-progress-bar">
                <div class="client-progress-fill" style="width:${progress}%"></div>
            </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

// --- Исправляем всплытие кликов внутри модалки ---
document.body.addEventListener("click", (e) => {
  // Останавливаем всплытие только если клик был именно по контенту модалки, а не по кнопкам
  const modalInner = e.target.closest(".modal");
  const isButton = e.target.closest("[data-action]");
  if (modalInner && !isButton) {
    e.stopPropagation();
  }
});



document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;

  const action = el.dataset.action;
   window._lastClickEvent = e; // <-- добавляем эту строку
  console.log("🔥 CLICK:", action);

  switch (action) {
    case "overlay-click":
      if (e.target.classList.contains("modal-overlay")) {
        state.modalOpen = false;
        state.packageModalOpen = false;
        state.confirm.open = false;
        render();
      }
      break;

    case "confirm-cancel":
      state.confirm = { open: false, title: "", type: null, bookingId: null };
      render();
      break;

    case "confirm-ok":
       await handleConfirmOk(e); // <-- передаём e
      break;

    case "prev-week":
      state.anchorDate = subWeeks(state.anchorDate, 1);
      closeAllTransient();
      render();
      break;

    case "next-week":
      state.anchorDate = addWeeks(state.anchorDate, 1);
      closeAllTransient();
      render();
      break;

    case "today":
      state.anchorDate = new Date();
      closeAllTransient();
      render();
      break;

    case "close-add-booking":
      state.modalOpen = false;
      render();
      break;

    case "save-booking":
      await addBooking();
      break;

    case "confirm-delete-booking":
      openConfirmDeleteBooking(el.dataset.id);
      break;

    case "open-package-modal-main":
      openPackageModal("");
      break;

    case "open-package-modal-client":
      openPackageModal(el.dataset.client || "");
      break;

    case "close-package-modal":
      state.packageModalOpen = false;
      render();
      break;

    case "save-package":
      await savePackage();
      break;

    case "toggle-client-expand":
      toggleClientExpand(el.dataset.client);
      break;

    case "toggle-package-expand":
      togglePackageExpand(el.dataset.pid);
      break;

    case "remove-package":
      await requestRemovePackage(el.dataset.client, el.dataset.pid);
      break;

    case "remove-client":
      await requestRemoveClient(el.dataset.client);
      break;
  }
});

// --- ------------------------------
// --- обрезка имени ---
// ----------------------------------------
function truncateName(name, max = 8) {
  if (!name) return "";
  return name.length > max ? name.slice(0, max) + "…" : name;
}

