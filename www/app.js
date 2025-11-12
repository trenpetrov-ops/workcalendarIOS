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

  const THRESHOLD = 75; // порог в пикселях
  const ANIM_SPEED = 0.38; // скорость плавного вставания
  const EASING = "cubic-bezier(0.25, 1, 0.5, 1)"; // мягкий айфоновский easing

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
//----------------------------------------------------
// ----------------------------------------------------
// ----------------------------------------------------





// ----------------------------------------------------
// ======== Долгое нажатие для добавления / удаления ========
/// ----------------------------------------------------


const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

let longPressTimer = null;
let lpStartX = 0, lpStartY = 0;
let targetEl = null;
let isMoving = false;

document.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  lpStartX = t.clientX;
  lpStartY = t.clientY;
  isMoving = false;

  targetEl = e.target.closest(".cell-clickable, .booking-item");
  if (!targetEl) return;

  // сбрасываем предыдущие состояния
  targetEl.classList.remove("pressed");
  targetEl.classList.remove("long-pressing");

  // таймер для визуального эффекта "pressed" (если не свайп)
  // таймер для визуального эффекта "pressed" (если не свайп)
  const pressedTimer = setTimeout(() => {
    if (!isMoving) {
      targetEl.classList.add("pressed");

      // 👇 Добавляем popup-анимацию (всплытие, как на клавиатуре iPhone)
      targetEl.classList.add("show-popup");

      // Убираем popup чуть позже (через 200 мс)
      setTimeout(() => {
        targetEl.classList.remove("show-popup");
      }, 400);
    }
  }, 80);


  // основной таймер долгого удержания
  longPressTimer = setTimeout(async () => {
    if (isMoving) return; // не реагировать на свайпы

    targetEl.classList.remove("pressed");
    targetEl.classList.add("long-pressing");

    try {
      // 💥 Вибрация при срабатывании
      if (window.Capacitor?.Plugins?.Haptics) {
        await window.Capacitor.Plugins.Haptics.impact({ style: 'heavy' });
      } else if (typeof Haptics !== 'undefined') {
        await Haptics.impact({ style: 'heavy' });
      } else if ('vibrate' in navigator) {
        navigator.vibrate(80);
      }
    } catch (err) {
      console.warn('Haptics long press error:', err);
    }

    const cell = targetEl.closest(".cell-clickable");
    const booking = targetEl.closest(".booking-item");

    if (cell && cell.dataset.date && cell.dataset.hour) {
      openAddBookingModal(cell.dataset.date, parseInt(cell.dataset.hour, 10));
    }

    if (booking && booking.dataset.id) {
      openConfirmDeleteBooking(booking.dataset.id);
    }
  }, LONG_PRESS_MS);

  // обработка движения
  const handleMove = (eMove) => {
    const m = eMove.touches[0];
    const dx = Math.abs(m.clientX - lpStartX);
    const dy = Math.abs(m.clientY - lpStartY);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
      // пользователь двигает палец — значит, это свайп
      isMoving = true;
      clearTimeout(longPressTimer);
      clearTimeout(pressedTimer);
      targetEl.classList.remove("pressed", "long-pressing");
    }
  };

  const cancelPress = () => {
    clearTimeout(longPressTimer);
    clearTimeout(pressedTimer);
    document.removeEventListener("touchend", cancelPress);
    document.removeEventListener("touchmove", handleMove);
    targetEl.classList.remove("pressed", "long-pressing");
  };

  document.addEventListener("touchmove", handleMove, { passive: true });
  document.addEventListener("touchend", cancelPress, { once: true });
}, { passive: true });






document.addEventListener("touchmove", (e) => {
  if (!longPressTimer) return;
  const t = e.touches[0];
  const dx = Math.abs(t.clientX - lpStartX);
  const dy = Math.abs(t.clientY - lpStartY);

  if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    document.querySelectorAll(".long-pressing").forEach(el => el.classList.remove("long-pressing"));
  }
}, { passive: true });

document.addEventListener("touchend", () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  // 👇 Убираем эффект
  document.querySelectorAll(".long-pressing").forEach(el => el.classList.remove("long-pressing"));
}, { passive: true });


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

  // ----вызов защиты модалки
    if (state.modalOpen || state.packageModalOpen || state.confirm.open) {
      protectFreshModals();
    }

}
// --------------------- защита модалки

function protectFreshModals() {
  const overlays = document.querySelectorAll(".modal-overlay");
  overlays.forEach((overlay) => {
    if (overlay.dataset.protected) return; // уже обработали

    overlay.dataset.protected = "1";
    const modal = overlay.querySelector(".modal");

    // временно блокируем любые тапы по модалке и оверлею
    overlay.style.pointerEvents = "none";
    if (modal) modal.style.pointerEvents = "none";

    setTimeout(() => {
      overlay.style.pointerEvents = "";
      if (modal) modal.style.pointerEvents = "";
    }, 220); // 0.22с — достаточно, чтобы палец успел отжаться
  });
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
  const dateStr = format(day, "d");
  const weekday = ruShort[day.getDay()];
  const isWeekend = idx >= 5;

  // ✅ Проверяем, совпадает ли с сегодняшним днем
  const isToday =
    format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  html += `
    <th class="${isWeekend ? "bg-orange" : "bg-red"} ${isToday ? "today-col" : ""}">
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
  // Проверяем: эта запись — на сегодняшний день?
  const isToday = b.dateISO === format(new Date(), "yyyy-MM-dd");

  html += `
    <div class="booking-item ${isToday ? "booking-today" : ""}" data-id="${b.id}">
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


function renderClientsPanel() {
  const names = clientNames();

  let html = `
    <div class="client-panel">
      <div class="client-panel-header">
        <button class="btn-green" data-action="open-package-modal-main">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>List-add SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 17h7m5-1h3m0 0h3m-3 0v3m0-3v-3M3 12h11M3 7h11"></path></svg>
        </button>
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
      const isSecondaryInShared = sharedPkg && sharedPkg.clientNames[0] !== name;
      const expanded = !!state.expandedClients[name];

      // карточка клиента
      html += `
        <div class="client-card" data-client="${escapeHtml(name)}">

<div class="client-card-header-wrap">
          <!-- кнопка удаления под хедером -->
          <div class="client-swipe-actions">
            <button class="client-delete-btn"
                    data-action="remove-client"
                    data-client="${escapeHtml(name)}"
                    aria-label="Удалить">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>
                    </button>
          </div>

          <!-- шапка (имя + кнопки), она уезжает при свайпе -->
          <div class="client-card-header">
            <div class="client-name"
                 data-action="toggle-client-expand"
                 data-client="${escapeHtml(name)}">
              ${escapeHtml(name)}
              <span class="client-status">
                ${activePkg ? `${activePkg.used || 0}/${activePkg.size}` : "✓ завершено"}
              </span>
            </div>
            <div class="client-actions">
              ${!isSecondaryInShared ? `
                <button data-action="open-package-modal-client"
                        data-client="${escapeHtml(name)}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16"><title>Plus SVG Icon</title><path fill="currentColor" d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"></path></svg>
                        </button>
              ` : ""}
            </div>
          </div>
          </div>
      `;

      // если раскрыто — показываем пакеты
      if (expanded) {
        html += `<div class="package-details">`;

        pkgList.forEach((p) => {
          const used = p.used || 0;
          const size = p.size;
          const pkgExpanded = !!state.expandedPackages[p.id];

          html += `
            <div class="package-line">
              <div data-action="toggle-package-expand" data-pid="${p.id}">
                ${used}/${size} — ${formatPurchase(p.addedISO)}
                ${p.clientNames && p.clientNames.length > 1
                  ? `<span class="text-gray">(Общий: ${p.clientNames.join(", ")})</span>`
                  : ""}
              </div>
              ${used >= size ? `
                <button class="package-remove-btn"
                        data-action="remove-package"
                        data-client="${escapeHtml(name)}"
                        data-pid="${p.id}">

                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                                                  <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"></path>
                                                </svg>
                        </button>` : ``}
            </div>
          `;

          if (pkgExpanded) {
            const sessions = bookingsForPackage(p.id, name);
            const sessionText =
              sessions.length === 0
                ? "Нет записей"
                : sessions
                    .map(
                      (b) =>
                        `${b.sessionNumber || "?"} / ${size} — ${format(
                          parseISO(b.dateISO),
                          "d LLL",
                          { locale: ru }
                        )}`
                    )
                    .join("\n");

            html += `
              <div class="package-sessions" data-pid="${p.id}">

                <div class="sessions-list">
                  ${
                    sessions.length === 0
                      ? `<div>Нет записей</div>`
                      : sessions
                          .map(
                            (b) => `
                            <div>
                              ${b.sessionNumber || "?"} / ${size} —
                              ${escapeHtml(
                                format(parseISO(b.dateISO), "d LLL", { locale: ru })
                              )}
                            </div>`
                          )
                          .join("")
                  }
                </div>
                    <button class="copy-btn"
                            data-action="copy-sessions"
                            data-text="${escapeHtml(sessionText)}"
                            title="Скопировать">
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 256 256"><title>Copy SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M48.186 92.137c0-8.392 6.49-14.89 16.264-14.89s29.827-.225 29.827-.225s-.306-6.99-.306-15.88c0-8.888 7.954-14.96 17.49-14.96c9.538 0 56.786.401 61.422.401c4.636 0 8.397 1.719 13.594 5.67c5.196 3.953 13.052 10.56 16.942 14.962c3.89 4.402 5.532 6.972 5.532 10.604c0 3.633 0 76.856-.06 85.34c-.059 8.485-7.877 14.757-17.134 14.881c-9.257.124-29.135.124-29.135.124s.466 6.275.466 15.15s-8.106 15.811-17.317 16.056c-9.21.245-71.944-.49-80.884-.245c-8.94.245-16.975-6.794-16.975-15.422s.274-93.175.274-101.566m16.734 3.946l-1.152 92.853a3.96 3.96 0 0 0 3.958 4.012l73.913.22a3.865 3.865 0 0 0 3.91-3.978l-.218-8.892a1.988 1.988 0 0 0-2.046-1.953s-21.866.64-31.767.293c-9.902-.348-16.672-6.807-16.675-15.516c-.003-8.709.003-69.142.003-69.142a1.989 1.989 0 0 0-2.007-1.993l-23.871.082a4.077 4.077 0 0 0-4.048 4.014m106.508-35.258c-1.666-1.45-3.016-.84-3.016 1.372v17.255c0 1.106.894 2.007 1.997 2.013l20.868.101c2.204.011 2.641-1.156.976-2.606zm-57.606.847a2.002 2.002 0 0 0-2.02 1.988l-.626 96.291a2.968 2.968 0 0 0 2.978 2.997l75.2-.186a2.054 2.054 0 0 0 2.044-2.012l1.268-62.421a1.951 1.951 0 0 0-1.96-2.004s-26.172.042-30.783.042c-4.611 0-7.535-2.222-7.535-6.482S152.3 63.92 152.3 63.92a2.033 2.033 0 0 0-2.015-2.018z"></path></svg>
                            </button>

              </div>
            `;
          }
        });

        html += `</div>`; // .package-details
      }

      html += `</div>`; // .client-card
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
    <div class="modal-overlay" data-role="overlay">
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



// --- ------------клик копировать ------------------

        case "copy-sessions": {
          const text = el.dataset.text || "";
          try {
            await navigator.clipboard.writeText(text);

            // 💥 Вибрация при успешном копировании
            if (window.Capacitor?.Plugins?.Haptics) {
              await window.Capacitor.Plugins.Haptics.impact({ style: "light" });
            } else if ("vibrate" in navigator) {
              navigator.vibrate(30);
            }

            // ✨ Эффект успешного копирования
            el.classList.add("copied");
            setTimeout(() => el.classList.remove("copied"), 600);

            // ✅ Показываем тост "Скопировано!"
            showToast("Скопировано!");
          } catch (err) {
            showToast("Не удалось скопировать 😕");
          }
          break;
        }


  }

   // безопасное закрытие модалок при клике в фон
      document.addEventListener("click", (e) => {
        const overlay = e.target.closest(".modal-overlay");
        const modal = e.target.closest(".modal");
        if (overlay && !modal) {
          // закрываем только если кликнули по фону
          state.modalOpen = false;
          state.packageModalOpen = false;
          state.confirm.open = false;
          render();
        }
      });
});
// --- ------------------------------
// --- свап .client-card ---
// ----------------------------------------
(() => {
  const OPEN_X = -88;
  let startX = 0;
  let currentX = 0;
  let dragging = false;
  let card = null;
  let header = null;
  let openedCard = null;

  function closeCard(c) {
    if (!c) return;
    const h = c.querySelector(".client-card-header");
    if (!h) return;
    h.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
    h.style.transform = "translateX(0)";
    c.classList.remove("swiped");
  }

  function openCard(c) {
    const h = c.querySelector(".client-card-header");
    if (!h) return;
    h.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
    h.style.transform = `translateX(${OPEN_X}px)`;
    c.classList.add("swiped");
    openedCard = c;
  }

  document.addEventListener("touchstart", (e) => {
    const h = e.target.closest(".client-card-header");
    if (!h) return;

    card = h.closest(".client-card");
    header = h;

    if (openedCard && openedCard !== card) closeCard(openedCard);

    startX = e.touches[0].clientX;
    currentX = 0;
    dragging = true;
    header.style.transition = "none";
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!dragging || !header) return;

    const dx = e.touches[0].clientX - startX;
    if (Math.abs(dx) > 8) e.preventDefault();
    const x = Math.min(0, Math.max(OPEN_X, dx + (card.classList.contains("swiped") ? OPEN_X : 0)));
    header.style.transform = `translateX(${x}px)`;
    currentX = x;
  }, { passive: false });

  document.addEventListener("touchend", async (e) => {
    if (!dragging || !header || !card) return;
    header.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";

    if (currentX < OPEN_X / 2) {
      openCard(card);
      try {
        if (window.Capacitor?.Plugins?.Haptics) {
          await window.Capacitor.Plugins.Haptics.impact({ style: "light" });
        } else if ("vibrate" in navigator) {
          navigator.vibrate(20);
        }
      } catch {}
    } else {
      closeCard(card);
      if (openedCard === card) openedCard = null;
    }

    dragging = false;
    header = null;
    card = null;
    currentX = 0;
  }, { passive: true });

  // тап по хедеру закрывает открытую карточку
  document.addEventListener("click", (e) => {
    const h = e.target.closest(".client-card-header");
    if (!h) return;
    const c = h.closest(".client-card");
    if (!c) return;
    if (c.classList.contains("swiped")) {
      closeCard(c);
      openedCard = null;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (openedCard && !e.target.closest(".client-card")) {
      closeCard(openedCard);
      openedCard = null;
    }
  });
})();

// --- ------------------------------
// --- осообщения внизу ---
// ----------------------------------------
function showToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.className = "toast-message";
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 1200);
}

// --- ------------------------------
// --- обрезка имени ---
// ----------------------------------------
function truncateName(name, max = 8) {
  if (!name) return "";
  return name.length > max ? name.slice(0, max) + "…" : name;
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("hapticsTest");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      const cap = window.Capacitor;
      console.log("Capacitor:", cap);
      if (cap?.isNativePlatform && cap?.Plugins?.Haptics) {
        await cap.Plugins.Haptics.impact({ style: 'heavy' });
        alert("✅ Haptics вызван (heavy)");
      } else if ('vibrate' in navigator) {
        navigator.vibrate(100);
        alert("💡 vibrate() вызван");
      } else {
        alert("❌ Haptics недоступен");
      }
    } catch (err) {
      alert("⚠️ Ошибка Haptics: " + err);
    }
  });
});


// === Плавающая кнопка с анимирующимися SVG ===

// безопасная функция для прорисовки иконок
function setIconFor(page) {
  const $cal = document.getElementById("icon-calendar");
  const $peo = document.getElementById("icon-people");

  // если по какой-то причине нет svg — выходим, чтобы не было ошибки
  if (!$cal || !$peo) {
    console.warn("FAB SVG elements not found");
    return;
  }

  // показываем нужную иконку
  const show = (page === "calendar") ? $peo : $cal;
  const hide = (show === $peo) ? $cal : $peo;

  hide.classList.remove("active", "draw");
  show.classList.add("active");

  // сбрасываем и снова включаем анимацию "прорисовки"
  void show.offsetWidth;
  show.classList.add("draw");
}

// основная установка FAB-кнопки
function installAnimatedFab() {
  const fab = document.getElementById("fab-toggle");
  if (!fab) {
    console.warn("FAB button not found in DOM");
    return;
  }

  fab.addEventListener("click", () => {
    const targetPage = (currentPage === "calendar") ? "clients" : "calendar";

    // меняем текущую страницу
    currentPage = targetPage;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`[data-page='${targetPage}']`)?.classList.add("active");
    render();

    setIconFor(currentPage);

    // лёгкий отклик
    try {
      if (window.Capacitor?.Plugins?.Haptics)
        window.Capacitor.Plugins.Haptics.impact({ style: "light" });
      else if ("vibrate" in navigator)
        navigator.vibrate(20);
    } catch {}
  });

  // показать актуальную иконку при запуске
  setIconFor(currentPage);
}

// ждём, пока страница загрузится
document.addEventListener("DOMContentLoaded", () => {
  installAnimatedFab();
});
