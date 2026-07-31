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
  getDocs,
  getDoc,
  deleteField
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

const TIME_SETTINGS_STORAGE_KEY = "workcalendar.timeSettings.v1";
const DAY_MINUTES = 24 * 60;
const LEGACY_BOOKING_ZONE_ID = "Asia/Bangkok";
const BOOKING_REFERENCE_ZONE_ID = "UTC";
const TIME_ZONE_OFFSET_CACHE = new Map();
const FEATURED_TIME_ZONE_OPTIONS = [
  { zoneId: "UTC", country: "UTC", shortName: "UTC" },
  { zoneId: "Asia/Bangkok", country: "Таиланд", shortName: "Тай" },
  { zoneId: "Asia/Makassar", country: "Индонезия, Бали", shortName: "Бали" },
  { zoneId: "Europe/Moscow", country: "Россия, Москва", shortName: "Рус" },
  { zoneId: "Asia/Jakarta", country: "Индонезия, Джакарта", shortName: "Джак" },
  { zoneId: "Asia/Singapore", country: "Сингапур", shortName: "Синг" },
  { zoneId: "Asia/Dubai", country: "ОАЭ, Дубай", shortName: "Дуб" },
  { zoneId: "Asia/Almaty", country: "Казахстан, Алматы", shortName: "Каз" },
  { zoneId: "Europe/Istanbul", country: "Турция", shortName: "Тур" },
  { zoneId: "Europe/Berlin", country: "Германия", shortName: "Гер" },
  { zoneId: "Europe/London", country: "Великобритания", shortName: "Лонд" },
  { zoneId: "America/New_York", country: "США, Нью-Йорк", shortName: "NY" },
  { zoneId: "America/Los_Angeles", country: "США, Лос-Анджелес", shortName: "LA" },
  { zoneId: "Australia/Sydney", country: "Австралия, Сидней", shortName: "Сид" }
];
const TIME_ZONE_OPTIONS = buildTimeZoneOptions(FEATURED_TIME_ZONE_OPTIONS);

const DEFAULT_TIME_SETTINGS = {
  yellow: {
    zoneId: "Asia/Bangkok",
    country: "Таиланд",
    shortName: "Тай",
    startMinute: 9 * 60,
    endMinute: 23 * 60
  },
  gray: {
    zoneId: "Europe/Moscow",
    country: "Россия, Москва",
    shortName: "Рус",
    startMinute: 5 * 60,
    endMinute: 19 * 60
  }
};

let timeSettings = loadTimeSettings();

const state = {
  anchorDate: new Date(),

  // модал добавления записи
  modalOpen: false,
  modalDateISO: null,
  modalHour: 9,
  modalClient: "",

  timeSettingsModalOpen: false,
  timeSettingsColumn: "yellow",
  timeSettingsDraft: null,
  timeDropdownOpen: null,

  // модал добавления пакета
  packageModalOpen: false,
  packageClient: "",
  packageSize: 10,
  packageSizeDropdownOpen: false,
  packageMainLocked: false,
  packageMembers: [],
  packageMemberPickerOpen: null,
  packageMonthly: false,
  packageStartISO: currentLocalDateISO(),
  packageCalendarMonthISO: currentMonthStartISO(),
  packageCalendarOpen: false,

  // просмотр и перенос записи
  bookingDetailsOpen: false,
  bookingDetailsId: null,
  bookingMoveDateISO: currentLocalDateISO(),
  bookingMoveHour: 9,
  bookingMoveCalendarMonthISO: currentMonthStartISO(),
  bookingMoveCalendarOpen: false,
  bookingMoveTimeOpen: false,

  // подробности месячного ведения
  supportDetailsOpen: false,
  supportDetailsId: null,
  supportStartCalendarOpen: false,
  supportStartCalendarMonthISO: currentMonthStartISO(),
  supportStartPending: false,
  supportShiftDays: "",
  supportShiftPending: false,

  // выбранная бронь (для показа крестика)
  selectedBookingId: null,

  // раскрытия
  expandedClients: {},
  expandedPackages: {},
  clientsTab: "personal",

  // модал подтверждения удаления
confirm: {
  open: false,
  title: "",
  message: "",
  type: null,       // booking | package | client
  bookingId: null,  // id брони
  itemId: null,     // id пакета/клиента
  deleteMode: "delete-all",
  dropdownOpen: false,
  pending: false
}

};


// ---------- Навигация ----------
let currentPage = "calendar"; // текущая страница: "calendar" или "clients"
let suppressBookingTapUntil = 0;
let suppressClientDeleteClickUntil = 0;

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
    if (el.matches("[data-bind='packageClient']")) {
      state.packageClient = el.value;
    }
  });

  document.body.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches("[data-bind='timezoneSearch']")) {
      const query = el.value.trim().toLocaleLowerCase("ru-RU");
      document.querySelectorAll(".timezone-option").forEach((option) => {
        option.hidden = query !== "" && !option.dataset.search.includes(query);
      });
      return;
    }

    if (el.matches("[data-bind='packageClient']")) {
      state.packageClient = el.value;
      const addButton = document.querySelector(".add-group-member-button");
      if (addButton) {
        addButton.hidden = !canAddPackageMember();
      }
      return;
    }

    if (el.matches("[data-bind='packageMember']")) {
      const index = Number(el.dataset.index);
      const member = state.packageMembers[index];
      if (!member) return;

      member.value = el.value;
      if (el.value === "") {
        member.editing = false;
        state.packageMemberPickerOpen = index;
        render();
        return;
      }

      const addButton = document.querySelector(".add-group-member-button");
      if (addButton) {
        addButton.hidden = !canAddPackageMember();
      }
      return;
    }

    if (el.matches("[data-bind='supportShiftDays']")) {
      state.supportShiftDays = el.value;
      const shiftDays = Number(el.value);
      const shiftButton = document.querySelector(
        '[data-action="shift-support-payment"]'
      );
      if (shiftButton) {
        shiftButton.disabled =
          state.supportShiftPending ||
          !Number.isInteger(shiftDays) ||
          shiftDays < 1 ||
          shiftDays > 365;
      }
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
      suppressBookingTapUntil = Date.now() + 900;
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
      if (targetEl.closest(".booking-item")) {
        suppressBookingTapUntil = Date.now() + 500;
      }
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
  state.packageMembers = [];
  state.packageMemberPickerOpen = null;
  state.packageSizeDropdownOpen = false;
  state.packageCalendarOpen = false;
  state.timeSettingsModalOpen = false;
  state.timeDropdownOpen = null;
  state.bookingDetailsOpen = false;
  state.bookingDetailsId = null;
  state.bookingMoveCalendarOpen = false;
  state.bookingMoveTimeOpen = false;
  state.supportDetailsOpen = false;
  state.supportDetailsId = null;
  state.supportStartCalendarOpen = false;
  state.supportStartCalendarMonthISO = currentMonthStartISO();
  state.supportStartPending = false;
  state.supportShiftDays = "";
  state.supportShiftPending = false;
  state.selectedBookingId = null;

  // ❗ confirm НЕ трогаем!
  state.confirm.open = false;
}


function weekDays(baseDate) {
  const start = startOfWeekFor(baseDate);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function loadTimeSettings() {
  try {
    const raw = localStorage.getItem(TIME_SETTINGS_STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      yellow: normalizeTimeSetting("yellow", saved.yellow),
      gray: normalizeTimeSetting("gray", saved.gray)
    };
  } catch {
    return {
      yellow: normalizeTimeSetting("yellow"),
      gray: normalizeTimeSetting("gray")
    };
  }
}

function normalizeTimeSetting(column, value = {}) {
  const fallback = DEFAULT_TIME_SETTINGS[column];
  const option =
    TIME_ZONE_OPTIONS.find((item) => item.zoneId === value.zoneId) ||
    TIME_ZONE_OPTIONS.find((item) => item.zoneId === fallback.zoneId) ||
    fallback;
  const startMinute = normalizeWorkMinute(value.startMinute, fallback.startMinute);
  const endMinute = normalizeWorkMinute(value.endMinute, fallback.endMinute);

  return {
    zoneId: option.zoneId,
    country: option.country || fallback.country,
    shortName: option.shortName || fallback.shortName,
    startMinute,
    endMinute
  };
}

function saveTimeSettingsToStorage() {
  try {
    localStorage.setItem(TIME_SETTINGS_STORAGE_KEY, JSON.stringify(timeSettings));
  } catch (err) {
    console.warn("Time settings were not saved locally:", err);
  }
}

function normalizeMinuteOfDay(minute) {
  return ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function normalizeWorkMinute(minute, fallback = 0) {
  const value = Number(minute);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(23 * 60, Math.round(value / 60) * 60));
}

function buildTimeZoneOptions(featuredOptions) {
  const featuredById = new Map(featuredOptions.map((option) => [option.zoneId, option]));
  let zoneIds = featuredOptions.map((option) => option.zoneId);

  try {
    if (typeof Intl.supportedValuesOf === "function") {
      zoneIds = Intl.supportedValuesOf("timeZone");
    }
  } catch (err) {
    console.warn("Полный список часовых поясов недоступен:", err);
  }

  const allZoneIds = [...new Set([
    ...zoneIds,
    ...featuredOptions.map((option) => option.zoneId)
  ])];

  const options = allZoneIds.map((zoneId) => {
    const featured = featuredById.get(zoneId);
    if (featured) return featured;

    const location = zoneId.split("/").at(-1).replaceAll("_", " ");
    return {
      zoneId,
      country: timeZoneLocationLabel(zoneId),
      shortName: Array.from(location.replace(/\s/g, "")).slice(0, 4).join("")
    };
  });

  const offsets = new Map(
    options.map((option) => [option.zoneId, getTimeZoneOffsetMinutes(option.zoneId)])
  );

  return options.sort(
    (a, b) =>
      offsets.get(a.zoneId) - offsets.get(b.zoneId) ||
      a.country.localeCompare(b.country, "ru")
  );
}

function timeZoneLocationLabel(zoneId) {
  const [region, ...locationParts] = zoneId.split("/");
  const regionNames = {
    Africa: "Африка",
    America: "Америка",
    Antarctica: "Антарктида",
    Arctic: "Арктика",
    Asia: "Азия",
    Atlantic: "Атлантика",
    Australia: "Австралия",
    Europe: "Европа",
    Indian: "Индийский океан",
    Pacific: "Тихий океан"
  };
  const location = locationParts
    .map((part) => part.replaceAll("_", " "))
    .join(", ");
  return location ? `${regionNames[region] || region} — ${location}` : zoneId;
}

function formatTimePlain(minute) {
  const normalized = normalizeMinuteOfDay(minute);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h}<span class="dot">.</span>${String(m).padStart(2, "0")}`;
}

function formatTimeLabel(minute, className = "") {
  return `<span class="time-label ${className}">${formatTimePlain(minute)}</span>`;
}

function formatColumnTime(baseMinute, column) {
  return formatTimeLabel(baseToColumnMinute(baseMinute, column));
}

function hourOptionLabel(minute) {
  const hour = Math.floor(normalizeWorkMinute(minute, 0) / 60);
  return `${String(hour).padStart(2, "0")}:00`;
}

function renderHourOptions(selectedMinute, field) {
  const selectedHour = Math.floor(normalizeWorkMinute(selectedMinute, 0) / 60);

  return Array.from({ length: 24 }, (_, hour) => {
    const label = `${String(hour).padStart(2, "0")}:00`;
    return `
      <button type="button"
              class="hour-option ${hour === selectedHour ? "active" : ""}"
              data-action="select-work-hour"
              data-field="${field}"
              data-minute="${hour * 60}"
              role="option"
              aria-selected="${hour === selectedHour}">
        ${label}
      </button>`;
  }).join("");
}

function getTimeZoneOffsetMinutes(timeZone, date = new Date()) {
  const cacheKey = `${timeZone}:${date.toISOString().slice(0, 13)}`;
  if (TIME_ZONE_OFFSET_CACHE.has(cacheKey)) {
    return TIME_ZONE_OFFSET_CACHE.get(cacheKey);
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const zonedUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offset = Math.round((zonedUtc - date.getTime()) / 60000);
  TIME_ZONE_OFFSET_CACHE.set(cacheKey, offset);
  return offset;
}

function baseToColumnMinute(baseMinute, column) {
  const baseOffset = getTimeZoneOffsetMinutes(timeSettings.yellow.zoneId);
  const columnOffset = getTimeZoneOffsetMinutes(column.zoneId);
  return baseMinute + columnOffset - baseOffset;
}

function columnToBaseMinute(localMinute, column) {
  const baseOffset = getTimeZoneOffsetMinutes(timeSettings.yellow.zoneId);
  const columnOffset = getTimeZoneOffsetMinutes(column.zoneId);
  return localMinute + baseOffset - columnOffset;
}

function zoneToZoneMinute(localMinute, fromZoneId, toZoneId) {
  return (
    localMinute +
    getTimeZoneOffsetMinutes(toZoneId) -
    getTimeZoneOffsetMinutes(fromZoneId)
  );
}

function bookingReferenceMinute(booking) {
  const savedReferenceMinute = Number(booking.utcMinute);
  if (Number.isFinite(savedReferenceMinute)) return savedReferenceMinute;

  const legacyHour = Number(booking.hour);
  if (!Number.isFinite(legacyHour)) return 0;
  const sourceZoneId = booking.timeZoneId || LEGACY_BOOKING_ZONE_ID;
  return zoneToZoneMinute(
    legacyHour * 60,
    sourceZoneId,
    BOOKING_REFERENCE_ZONE_ID
  );
}

function bookingBaseMinute(booking) {
  return zoneToZoneMinute(
    bookingReferenceMinute(booking),
    BOOKING_REFERENCE_ZONE_ID,
    timeSettings.yellow.zoneId
  );
}

function bookingBaseHour(booking) {
  return Math.round(bookingBaseMinute(booking) / 60);
}

function timeRangeInBaseMinutes(setting) {
  const yellowZoneId = timeSettings.yellow.zoneId;
  const endMinute =
    setting.endMinute < setting.startMinute
      ? setting.endMinute + DAY_MINUTES
      : setting.endMinute;

  return {
    startMinute: zoneToZoneMinute(setting.startMinute, setting.zoneId, yellowZoneId),
    endMinute: zoneToZoneMinute(endMinute, setting.zoneId, yellowZoneId)
  };
}

function scheduleHours() {
  const ranges = [timeSettings.yellow, timeSettings.gray].map(timeRangeInBaseMinutes);
  const visibleStartISO = format(
    addWeeks(startOfWeekFor(state.anchorDate), -1),
    "yyyy-MM-dd"
  );
  const visibleEndISO = format(
    addDays(addWeeks(startOfWeekFor(state.anchorDate), 1), 6),
    "yyyy-MM-dd"
  );
  const visibleBookingMinutes = bookings
    .filter(
      (booking) =>
        booking.dateISO >= visibleStartISO && booking.dateISO <= visibleEndISO
    )
    .map((booking) => bookingBaseHour(booking) * 60);
  const minStartMinute = Math.min(
    ...ranges.map((range) => range.startMinute),
    ...visibleBookingMinutes
  );
  const maxEndMinute = Math.max(
    ...ranges.map((range) => range.endMinute),
    ...visibleBookingMinutes
  );
  const startHour = Math.floor(minStartMinute / 60);
  const endHour = Math.max(startHour, Math.floor(maxEndMinute / 60));
  return Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
}

function timeDiffText(zoneId, compareZoneId) {
  const diff = getTimeZoneOffsetMinutes(zoneId) - getTimeZoneOffsetMinutes(compareZoneId);
  if (diff === 0) return "0ч";
  const sign = diff > 0 ? "+" : "-";
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}ч`;
}

function utcOffsetText(zoneId) {
  const offset = getTimeZoneOffsetMinutes(zoneId);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeColumnsMerged() {
  return timeSettings.yellow.zoneId === timeSettings.gray.zoneId;
}

function visibleTimeColumns() {
  if (timeColumnsMerged()) {
    return [
      {
        key: "yellow",
        className: "bg-yellow bg-gray time-column-merged",
        settings: timeSettings.yellow,
        colspan: 2
      }
    ];
  }

  return [
    { key: "yellow", className: "bg-yellow", settings: timeSettings.yellow, colspan: 1 },
    { key: "gray", className: "bg-gray", settings: timeSettings.gray, colspan: 1 }
  ];
}

function shortZoneLabel(setting) {
  return String(setting.shortName || setting.country || setting.zoneId)
    .replace(/\s+/g, "")
    .slice(0, 4);
}

function bookingSortValue(booking) {
  return bookingReferenceMinute(booking);
}

function sharedClientGroups() {
  const groups = new Map();

  packages.forEach((p) => {
    if (
      p.monthlySupport ||
      p.placeholder ||
      !Array.isArray(p.clientNames) ||
      p.clientNames.length < 2
    ) {
      return;
    }

    const cleanNames = p.clientNames.map((name) => String(name || "").trim()).filter(Boolean);
    const main = cleanNames[0];
    if (!main) return;

    if (!groups.has(main)) {
      groups.set(main, { main, members: new Set([main]) });
    }
    cleanNames.forEach((name) => groups.get(main).members.add(name));
  });

  return [...groups.values()].map((group) => ({
    main: group.main,
    members: [...group.members]
  }));
}

function sharedClientGroupMap() {
  const map = new Map();
  sharedClientGroups().forEach((group) => {
    group.members.forEach((name) => map.set(name, group));
  });
  return map;
}


function clientNames() {
  const all = [];
  for (const p of packages) {
    if (p.monthlySupport) continue;
    if (p.clientName) all.push(p.clientName);
    if (Array.isArray(p.clientNames)) all.push(...p.clientNames);
  }
  const sorted = [...new Set(all)].sort(
    (a, b) =>
      clientRemainingSessions(a) - clientRemainingSessions(b) ||
      a.localeCompare(b, "ru")
  );
  const sortedSet = new Set(sorted);
  const groupByName = sharedClientGroupMap();
  const visited = new Set();
  const ordered = [];

  sorted.forEach((name) => {
    if (visited.has(name)) return;
    const group = groupByName.get(name);

    if (!group) {
      ordered.push(name);
      visited.add(name);
      return;
    }

    [group.main, ...group.members.filter((member) => member !== group.main)].forEach(
      (member) => {
        if (sortedSet.has(member) && !visited.has(member)) {
          ordered.push(member);
          visited.add(member);
        }
      }
    );
  });

  return ordered;
}

function clientRemainingSessions(name) {
  const remaining = packages
    .filter(
      (p) =>
        !p.monthlySupport &&
        !p.placeholder &&
        (p.clientName === name ||
          (Array.isArray(p.clientNames) && p.clientNames.includes(name))) &&
        (p.used || 0) < p.size
    )
    .map((p) => p.size - (p.used || 0));

  return remaining.length ? Math.min(...remaining) : Number.POSITIVE_INFINITY;
}

function activeClients() {
  return clientNames().filter((n) =>
    packages.some(
      (p) =>
        !p.monthlySupport &&
        !p.placeholder &&
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

function currentLocalDateISO() {
  return format(new Date(), "yyyy-MM-dd");
}

function currentMonthStartISO() {
  const now = new Date();
  return format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
}

function monthStartISOFor(dateISO) {
  const date = parseISO(dateISO || currentLocalDateISO());
  return format(new Date(date.getFullYear(), date.getMonth(), 1), "yyyy-MM-dd");
}

function formatDateField(dateISO) {
  if (!dateISO) return "";
  const date = parseISO(dateISO);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatSupportStart(dateISO) {
  if (!dateISO) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parseISO(dateISO));
}

function isValidDateISO(dateISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || "")) return false;
  const date = parseISO(dateISO);
  return !Number.isNaN(date.getTime()) && format(date, "yyyy-MM-dd") === dateISO;
}

function addCalendarMonthsISO(dateISO, monthOffset) {
  if (!isValidDateISO(dateISO)) return "";

  const source = parseISO(dateISO);
  const target = new Date(
    source.getFullYear(),
    source.getMonth() + monthOffset,
    1
  );
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();
  target.setDate(Math.min(source.getDate(), lastDay));
  return format(target, "yyyy-MM-dd");
}

function dateDiffInDays(laterISO, earlierISO) {
  const later = parseISO(laterISO);
  const earlier = parseISO(earlierISO);
  const laterUTC = Date.UTC(
    later.getFullYear(),
    later.getMonth(),
    later.getDate()
  );
  const earlierUTC = Date.UTC(
    earlier.getFullYear(),
    earlier.getMonth(),
    earlier.getDate()
  );
  return Math.round((laterUTC - earlierUTC) / 86400000);
}

function supportBillingCycle(entry, todayISO = currentLocalDateISO()) {
  const startISO = isValidDateISO(entry.startISO)
    ? entry.startISO
    : todayISO;
  let periodStartISO = isValidDateISO(entry.paymentAnchorISO)
    ? entry.paymentAnchorISO
    : startISO;
  let nextPaymentISO = isValidDateISO(entry.nextPaymentISO)
    ? entry.nextPaymentISO
    : addCalendarMonthsISO(startISO, 1);

  if (nextPaymentISO < todayISO) {
    const scheduleBaseISO = nextPaymentISO;
    let monthOffset = 0;
    while (nextPaymentISO < todayISO) {
      periodStartISO = nextPaymentISO;
      monthOffset += 1;
      nextPaymentISO = addCalendarMonthsISO(scheduleBaseISO, monthOffset);
    }
  }

  const periodDays = Math.max(
    1,
    dateDiffInDays(nextPaymentISO, periodStartISO)
  );
  const elapsedDays = Math.max(
    0,
    Math.min(periodDays, dateDiffInDays(todayISO, periodStartISO))
  );

  return {
    periodStartISO,
    nextPaymentISO,
    daysUntil: Math.max(0, dateDiffInDays(nextPaymentISO, todayISO)),
    progress: Math.round((elapsedDays / periodDays) * 100)
  };
}

function pluralDays(value) {
  const absolute = Math.abs(value);
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function supportCountdownText(daysUntil) {
  return daysUntil === 0
    ? "сегодня"
    : `${daysUntil} ${pluralDays(daysUntil)}`;
}

function monthlySupportEntries() {
  return packages
    .filter((p) => p.monthlySupport && p.clientName)
    .map((p) => ({
      id: p.id,
      name: p.clientName,
      startISO: p.supportStartISO || p.addedISO || "",
      paymentAnchorISO: p.supportPaymentAnchorISO || "",
      nextPaymentISO: p.supportNextPaymentISO || ""
    }))
    .sort(
      (a, b) =>
        (a.startISO || "").localeCompare(b.startISO || "") ||
        a.name.localeCompare(b.name, "ru")
    );
}

function bookingsForPackage(packageId, clientName) {
  return bookings
    .filter(
      (b) => b.packageId === packageId && b.clientName === clientName
    )
    .sort(
      (a, b) =>
        a.dateISO.localeCompare(b.dateISO) || bookingSortValue(a) - bookingSortValue(b)
    );
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Рендер ----------
function render() {
  const app = document.getElementById("app");
  if (!app) return;

  if (currentPage === "calendar") {
    app.className = "app-calendar";
    app.innerHTML = `
      ${renderHeader()}
      ${renderTable()}
      ${state.modalOpen ? renderAddBookingModal() : ""}
      ${state.timeSettingsModalOpen ? renderTimeSettingsModal() : ""}
      ${state.packageModalOpen ? renderPackageModal() : ""}
      ${state.bookingDetailsOpen ? renderBookingDetailsModal() : ""}
      ${state.confirm.open ? renderConfirmModal() : ""}
    `;
  }

  if (currentPage === "clients") {
    app.className = "app-clients";
    app.innerHTML = `
      ${renderClientsPanel()}  <!-- полностью твой старый блок -->
      ${state.packageModalOpen ? renderPackageModal() : ""}
      ${state.supportDetailsOpen ? renderSupportDetailsModal() : ""}
      ${state.confirm.open ? renderConfirmModal() : ""}
    `;
  }

  // ----вызов защиты модалки
    if (
      state.modalOpen ||
      state.packageModalOpen ||
      state.bookingDetailsOpen ||
      state.supportDetailsOpen ||
      state.confirm.open ||
      state.timeSettingsModalOpen
    ) {
      protectFreshModals();
    }
    updateFabVisibility();

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



// === скрытие FAB во время модалок (решение бага iOS) ===
function updateFabVisibility() {
  const fab = document.getElementById("fab-toggle");
  if (!fab) return;

  if (
    state.modalOpen ||
    state.packageModalOpen ||
    state.bookingDetailsOpen ||
    state.supportDetailsOpen ||
    state.confirm.open ||
    state.timeSettingsModalOpen
  ) {
    fab.classList.add("hide-under-modal");
  } else {
    fab.classList.remove("hide-under-modal");
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
    const dateStr = format(day, "d");
    const weekday = ruShort[day.getDay()];
    const isWeekend = idx >= 5;

    // Проверяем, совпадает ли с сегодняшним днем
    const isToday =
      format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

    html += `
      <th class="${isWeekend ? "bg-orange" : "bg-red"} ${isToday ? "today-col" : ""}">
        <span class="date">${dateStr}</span>
        <span class="weekday">${weekday}</span>
      </th>`;
  });



  html += `</tr></thead><tbody>`;

  scheduleHours().forEach((h) => {
    html += `<tr>`;

    week.forEach((day, idx) => {
      const dateISO = format(day, "yyyy-MM-dd");
      const items = bookings.filter(
        (b) => b.dateISO === dateISO && bookingBaseHour(b) === h
      );
      const isWeekend = idx >= 5;
      const label = formatTimePlain(h * 60).replace(/<[^>]+>/g, "");

      if (items.length === 0) {
        html += `
          <td class="bg-${isWeekend ? "orange" : "white"} cell-clickable"
              data-action="open-add-booking"
              data-date="${dateISO}"
              data-hour="${h}"
              data-label="${escapeHtml(label)}"></td>`;
      } else {
        html += `<td class="bg-blue"><div class="booking-wrap">`;
        items.forEach((b) => {
          // Проверяем: эта запись — на сегодняшний день?
          const isToday = b.dateISO === format(new Date(), "yyyy-MM-dd");

          html += `
            <div class="booking-item ${isToday ? "booking-today" : ""}"
                 data-action="open-booking-details"
                 data-id="${b.id}">
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
            <div class="calendar-week">${renderWeek(-1)}</div>
            <div class="calendar-week">${renderWeek(0)}</div>
            <div class="calendar-week">${renderWeek(1)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFixedTimes() {
  const columns = visibleTimeColumns();
  let html = `<table class="fixed-time-table"><thead><tr>`;

  columns.forEach((column) => {
    html += `
      <th class="${column.className} time-zone-header"
          data-action="open-time-settings"
          data-column="${column.key}"
          ${column.colspan > 1 ? `colspan="${column.colspan}"` : ""}>
        ${escapeHtml(shortZoneLabel(column.settings))}
      </th>`;
  });

  html += `</tr></thead><tbody>`;

  scheduleHours().forEach((h) => {
    html += `<tr>`;
    columns.forEach((column) => {
      html += `
        <td class="${column.className} time-cell"
            data-action="open-time-settings"
            data-column="${column.key}"
            ${column.colspan > 1 ? `colspan="${column.colspan}"` : ""}>
          ${formatColumnTime(h * 60, column.settings)}
        </td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

function openTimeSettingsModal(column) {
  const key = column === "gray" ? "gray" : "yellow";
  state.timeSettingsColumn = key;
  state.timeSettingsDraft = { ...timeSettings[key] };
  state.timeSettingsModalOpen = true;
  state.timeDropdownOpen = null;
  render();
}

function renderTimeSettingsModal() {
  const column = state.timeSettingsColumn === "gray" ? "gray" : "yellow";
  const otherColumn = column === "yellow" ? "gray" : "yellow";
  const draft = state.timeSettingsDraft || { ...timeSettings[column] };
  const other = timeSettings[otherColumn];

  return `
    <div class="modal-overlay" data-action="overlay-click">
      <div class="modal time-settings-modal">
        <h3>Время</h3>
        <input class="timezone-search"
               type="search"
               data-bind="timezoneSearch"
               placeholder="Поиск города или страны"
               autocomplete="off"
               aria-label="Поиск часового пояса">
        <div class="timezone-list">
          ${TIME_ZONE_OPTIONS.map((option) => {
            const selected = option.zoneId === draft.zoneId;
            const searchText = `${option.country} ${option.zoneId} ${utcOffsetText(option.zoneId)}`
              .toLocaleLowerCase("ru-RU");
            return `
              <button class="timezone-option ${selected ? "active" : ""}"
                      data-action="select-time-zone"
                      data-zone-id="${escapeHtml(option.zoneId)}"
                      data-search="${escapeHtml(searchText)}">
                <span class="timezone-main">
                  <strong>${escapeHtml(option.country)}</strong>
                  <span>${escapeHtml(option.zoneId)} · ${escapeHtml(utcOffsetText(option.zoneId))}</span>
                </span>
                <span class="timezone-diff">${escapeHtml(timeDiffText(option.zoneId, other.zoneId))}</span>
              </button>`;
          }).join("")}
        </div>
        <div class="workday-fields">
          <label>
            <span>Начало</span>
            <span class="hour-select-wrap">
              <button type="button"
                      class="hour-select-field ${state.timeDropdownOpen === "start" ? "open" : ""}"
                      data-action="toggle-hour-dropdown"
                      data-field="start"
                      aria-haspopup="listbox"
                      aria-expanded="${state.timeDropdownOpen === "start"}">
                ${hourOptionLabel(draft.startMinute)}
              </button>
              ${
                state.timeDropdownOpen === "start"
                  ? `<span class="hour-options-list" role="listbox">
                      ${renderHourOptions(draft.startMinute, "start")}
                    </span>`
                  : ""
              }
            </span>
          </label>
          <label>
            <span>Конец</span>
            <span class="hour-select-wrap">
              <button type="button"
                      class="hour-select-field ${state.timeDropdownOpen === "end" ? "open" : ""}"
                      data-action="toggle-hour-dropdown"
                      data-field="end"
                      aria-haspopup="listbox"
                      aria-expanded="${state.timeDropdownOpen === "end"}">
                ${hourOptionLabel(draft.endMinute)}
              </button>
              ${
                state.timeDropdownOpen === "end"
                  ? `<span class="hour-options-list" role="listbox">
                      ${renderHourOptions(draft.endMinute, "end")}
                    </span>`
                  : ""
              }
            </span>
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn-blue" data-action="save-time-settings">Сохранить</button>
          <button class="btn-gray" data-action="close-time-settings">Отмена</button>
        </div>
      </div>
    </div>
  `;
}

function selectTimeZone(zoneId) {
  const option = TIME_ZONE_OPTIONS.find((item) => item.zoneId === zoneId);
  if (!option || !state.timeSettingsDraft) return;
  state.timeSettingsDraft = {
    ...state.timeSettingsDraft,
    zoneId: option.zoneId,
    country: option.country,
    shortName: option.shortName
  };
  state.timeDropdownOpen = null;
  render();
}

function toggleHourDropdown(field) {
  if (!state.timeSettingsDraft) return;
  const key = field === "end" ? "end" : "start";
  state.timeDropdownOpen = state.timeDropdownOpen === key ? null : key;
  render();
}

function selectWorkHour(field, minute) {
  if (!state.timeSettingsDraft) return;
  const key = field === "end" ? "endMinute" : "startMinute";
  state.timeSettingsDraft[key] = normalizeWorkMinute(minute, state.timeSettingsDraft[key]);
  state.timeDropdownOpen = null;
  render();
}

function saveTimeSettings() {
  const column = state.timeSettingsColumn === "gray" ? "gray" : "yellow";
  const rawDraft = state.timeSettingsDraft || timeSettings[column];
  const draft = normalizeTimeSetting(column, rawDraft);
  const crossesMidnight = draft.endMinute < draft.startMinute;

  timeSettings = {
    ...timeSettings,
    [column]: draft
  };
  saveTimeSettingsToStorage();
  state.timeSettingsModalOpen = false;
  state.timeSettingsDraft = null;
  state.timeDropdownOpen = null;
  render();
  showToast(
    crossesMidnight
      ? "Диапазон сохранён. Конец относится к следующему дню."
      : "Диапазон сохранён.",
    "success"
  );
}


function renderClientsPanel() {
  const names = clientNames();
  const monthlyEntries = monthlySupportEntries();
  const activeTab = state.clientsTab === "support" ? "support" : "personal";

  let html = `
    <div class="client-panel">
      <div class="clients-topbar">
        <h2>Клиенты</h2>
        <button class="clients-add-button"
                data-action="open-package-modal-main"
                aria-label="Добавить клиента"
                title="Добавить клиента">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="21"
               height="21"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                  d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8a4 4 0 0 0 0 8m10-3v6m3-3h-6"></path>
        </button>
      </div>
      <div class="clients-tabs" role="tablist" aria-label="Раздел клиентов">
        <button type="button"
                class="${activeTab === "personal" ? "active" : ""}"
                data-action="set-clients-tab"
                data-tab="personal"
                role="tab"
                aria-selected="${activeTab === "personal"}">
          Персональные
        </button>
        <button type="button"
                class="${activeTab === "support" ? "active" : ""}"
                data-action="set-clients-tab"
                data-tab="support"
                role="tab"
                aria-selected="${activeTab === "support"}">
          Ведение
        </button>
      </div>
      <div class="clients-tab-content">
  `;

  if (activeTab === "personal") {
    html += `<div class="client-list">`;

    if (names.length === 0) {
    html += `<div class="text-gray">Нет данных</div>`;
    } else {
    const groupByName = sharedClientGroupMap();

    names.forEach((name, index) => {
      const group = groupByName.get(name);
      const previousGroup = index > 0 ? groupByName.get(names[index - 1]) : null;
      const nextGroup =
        index < names.length - 1 ? groupByName.get(names[index + 1]) : null;

      if (group && previousGroup?.main !== group.main) {
        html += `
          <div class="client-group" data-group-main="${escapeHtml(group.main)}">
            <div class="client-group-label">Группа</div>`;
      }

      const hasPlaceholder = packages.some(
        (p) => p.placeholder && p.clientName === name
      );
      const pkgList = packages.filter(
        (p) =>
          !p.monthlySupport &&
          !p.placeholder &&
          (p.clientName === name ||
            (Array.isArray(p.clientNames) && p.clientNames.includes(name)))
      );

      const activePkg = pkgList.find((p) => (p.used || 0) < p.size);
      const isSecondaryInShared = Boolean(group && group.main !== name);
      const expanded = !!state.expandedClients[name];
      const progress = activePkg ? ((activePkg.used || 0) / activePkg.size) * 100 : 0;
      const statusText = activePkg
        ? `${activePkg.used || 0}/${activePkg.size}`
        : hasPlaceholder && pkgList.length === 0
          ? "0 тренировок"
          : "✓ завершено";

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
              <span class="client-name-text">${escapeHtml(name)}</span>
              ${
                activePkg
                  ? `
                    <span class="client-inline-progress">
                      <span class="client-progress-bar client-inline-progress-bar">
                        <span class="client-progress-fill" style="width:${progress}%"></span>
                      </span>
                    </span>`
                  : ""
              }
              <span class="client-status">
                ${statusText}
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

      if (group && nextGroup?.main !== group.main) {
        html += `</div>`; // .client-group
      }
    });
    }

    html += `</div>`;
  } else {
    html += `
      <section class="monthly-support-section monthly-support-tab">
        <div class="monthly-support-list">
          ${
            monthlyEntries.length === 0
              ? `<div class="monthly-support-empty">Нет клиентов</div>`
              : monthlyEntries
                  .map((entry) => {
                    const billing = supportBillingCycle(entry);
                    return `
                      <div class="monthly-support-item client-card"
                           data-support-id="${escapeHtml(entry.id)}">
                        <div class="client-card-header-wrap">
                          <div class="client-swipe-actions">
                            <button class="monthly-support-remove"
                                    data-action="remove-monthly-support"
                                    data-id="${escapeHtml(entry.id)}"
                                    data-client="${escapeHtml(entry.name)}"
                                    aria-label="Удалить из месячного ведения">
                              <svg xmlns="http://www.w3.org/2000/svg"
                                   width="19"
                                   height="19"
                                   viewBox="0 0 24 24"
                                   aria-hidden="true">
                                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                              </svg>
                            </button>
                          </div>
                          <div class="client-card-header monthly-support-card-header"
                               data-action="open-support-details"
                               data-id="${escapeHtml(entry.id)}"
                               role="button"
                               tabindex="0">
                            <div class="monthly-support-person">
                              <div class="monthly-support-heading">
                                <span class="monthly-support-name">${escapeHtml(entry.name)}</span>
                                <span class="monthly-support-days">
                                  ${escapeHtml(supportCountdownText(billing.daysUntil))}
                                </span>
                              </div>
                              <div class="monthly-support-progress-row">
                                <span class="client-progress-bar monthly-support-progress-bar">
                                  <span class="client-progress-fill"
                                        style="width:${billing.progress}%"></span>
                                </span>
                              </div>
                              <span class="monthly-support-date">
                                Следующая оплата ${escapeHtml(formatSupportStart(billing.nextPaymentISO))}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>`;
                  })
                  .join("")
          }
        </div>
      </section>`;
  }

  html += `
      </div>
    </div>`;
  return html;
}

function openSupportDetails(id) {
  const entry = monthlySupportEntries().find((item) => item.id === id);
  if (!entry) {
    showToast("Не удалось открыть данные ведения.", "error");
    return;
  }

  state.supportDetailsOpen = true;
  state.supportDetailsId = id;
  state.supportStartCalendarOpen = false;
  state.supportStartCalendarMonthISO = monthStartISOFor(
    entry.startISO || currentLocalDateISO()
  );
  state.supportStartPending = false;
  state.supportShiftDays = "";
  state.supportShiftPending = false;
  render();
}

function closeSupportDetails() {
  if (state.supportShiftPending || state.supportStartPending) return;
  state.supportDetailsOpen = false;
  state.supportDetailsId = null;
  state.supportStartCalendarOpen = false;
  state.supportStartPending = false;
  state.supportShiftDays = "";
  render();
}

function renderSupportStartCalendar(entry) {
  const monthStart = parseISO(
    state.supportStartCalendarMonthISO ||
      monthStartISOFor(entry.startISO || currentLocalDateISO())
  );
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const todayISO = currentLocalDateISO();
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(monthStart);

  const dayCells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      return `<span class="package-calendar-empty"></span>`;
    }

    const dateISO = format(new Date(year, month, day), "yyyy-MM-dd");
    const selected = dateISO === entry.startISO;
    const today = dateISO === todayISO;
    return `
      <button type="button"
              class="package-calendar-day ${selected ? "selected" : ""} ${today ? "today" : ""}"
              data-action="select-support-start-date"
              data-date="${dateISO}"
              aria-label="${escapeHtml(formatSupportStart(dateISO))}">
        ${day}
      </button>`;
  }).join("");

  return `
    <div class="package-calendar support-start-calendar">
      <div class="package-calendar-header">
        <button type="button"
                data-action="support-start-calendar-prev"
                aria-label="Предыдущий месяц">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="16"
               height="16"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 18-6-6 6-6"></path>
          </svg>
        </button>
        <strong>${escapeHtml(monthLabel)}</strong>
        <button type="button"
                data-action="support-start-calendar-next"
                aria-label="Следующий месяц">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="16"
               height="16"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </div>
      <div class="package-calendar-weekdays">
        ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
          .map((day) => `<span>${day}</span>`)
          .join("")}
      </div>
      <div class="package-calendar-grid">${dayCells}</div>
    </div>`;
}

function toggleSupportStartCalendar() {
  if (state.supportStartPending || state.supportShiftPending) return;
  const entry = monthlySupportEntries().find(
    (item) => item.id === state.supportDetailsId
  );
  if (!entry) return;

  if (!state.supportStartCalendarOpen) {
    state.supportStartCalendarMonthISO = monthStartISOFor(
      entry.startISO || currentLocalDateISO()
    );
  }
  state.supportStartCalendarOpen = !state.supportStartCalendarOpen;
  render();
}

function moveSupportStartCalendar(monthDelta) {
  if (state.supportStartPending) return;
  const current = parseISO(
    state.supportStartCalendarMonthISO || currentMonthStartISO()
  );
  const next = new Date(
    current.getFullYear(),
    current.getMonth() + monthDelta,
    1
  );
  state.supportStartCalendarMonthISO = format(next, "yyyy-MM-dd");
  render();
}

async function selectSupportStartDate(dateISO) {
  if (state.supportStartPending || !isValidDateISO(dateISO)) return;
  const entry = monthlySupportEntries().find(
    (item) => item.id === state.supportDetailsId
  );
  if (!entry) {
    showToast("Данные ведения не найдены.", "error");
    return;
  }

  state.supportStartPending = true;
  state.supportStartCalendarOpen = false;
  render();
  try {
    await updateDoc(doc(db, "packages", entry.id), {
      supportStartISO: dateISO,
      supportPaymentAnchorISO: deleteField(),
      supportNextPaymentISO: deleteField()
    });
    state.supportStartCalendarMonthISO = monthStartISOFor(dateISO);
    showToast(`Начало ведения: ${formatSupportStart(dateISO)}.`, "success");
  } catch (err) {
    console.error("Ошибка изменения даты начала ведения:", err);
    state.supportStartCalendarOpen = true;
    showToast("Не удалось изменить дату начала ведения.", "error");
  } finally {
    state.supportStartPending = false;
    render();
  }
}

function renderSupportDetailsModal() {
  const entry = monthlySupportEntries().find(
    (item) => item.id === state.supportDetailsId
  );
  if (!entry) return "";

  const billing = supportBillingCycle(entry);
  const shiftDays = Number(state.supportShiftDays);
  const supportBusy = state.supportStartPending || state.supportShiftPending;
  const canShift =
    !supportBusy &&
    Number.isInteger(shiftDays) &&
    shiftDays >= 1 &&
    shiftDays <= 365;

  return `
    <div class="modal-overlay support-details-overlay" data-action="overlay-click">
      <div class="modal support-details-modal">
        <h3>Ведение</h3>
        <div class="support-details-client">${escapeHtml(entry.name)}</div>
        <div class="support-details-info">
          <div class="support-details-info-row">
            <span>Начало ведения</span>
            <button type="button"
                    class="support-start-date-button ${state.supportStartCalendarOpen ? "open" : ""}"
                    data-action="toggle-support-start-calendar"
                    aria-expanded="${state.supportStartCalendarOpen}"
                    ${supportBusy ? "disabled" : ""}>
              <span>${state.supportStartPending
                ? "Сохраняем..."
                : escapeHtml(formatSupportStart(entry.startISO))}</span>
              <svg xmlns="http://www.w3.org/2000/svg"
                   width="15"
                   height="15"
                   viewBox="0 0 24 24"
                   aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 2v3m10-3v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m2.5 9h.01m4.49 0h.01m4.49 0h.01M7.5 17h.01m4.49 0h.01m4.49 0h.01"></path>
              </svg>
            </button>
          </div>
          ${state.supportStartCalendarOpen ? renderSupportStartCalendar(entry) : ""}
          <div class="support-details-info-row">
            <span>Следующая оплата</span>
            <strong>${escapeHtml(formatSupportStart(billing.nextPaymentISO))}</strong>
          </div>
        </div>

        <div class="support-details-progress">
          <div class="support-details-progress-heading">
            <span>До оплаты</span>
            <strong>${escapeHtml(supportCountdownText(billing.daysUntil))}</strong>
          </div>
          <span class="client-progress-bar support-details-progress-bar">
            <span class="client-progress-fill"
                  style="width:${billing.progress}%"></span>
          </span>
        </div>

        <div class="support-shift-section">
          <div class="support-shift-title">Сместить оплату</div>
          <label class="support-shift-label" for="support-shift-days">
            Перенести вперёд на
          </label>
          <div class="support-shift-input-wrap">
            <input id="support-shift-days"
                   type="number"
                   min="1"
                   max="365"
                   step="1"
                   inputmode="numeric"
                   placeholder="0"
                   value="${escapeHtml(state.supportShiftDays)}"
                   data-bind="supportShiftDays"
                   ${supportBusy ? "disabled" : ""}>
            <span>дней</span>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-gray"
                  data-action="close-support-details"
                  ${supportBusy ? "disabled" : ""}>
            Закрыть
          </button>
          <button class="btn-blue"
                  data-action="shift-support-payment"
                  ${canShift ? "" : "disabled"}>
            ${state.supportShiftPending ? "Сохраняем..." : "Сместить"}
          </button>
        </div>
      </div>
    </div>`;
}

async function shiftSupportPayment() {
  if (state.supportShiftPending) return;

  const entry = monthlySupportEntries().find(
    (item) => item.id === state.supportDetailsId
  );
  const shiftDays = Number(state.supportShiftDays);
  if (!entry) {
    showToast("Данные ведения не найдены.", "error");
    return;
  }
  if (!Number.isInteger(shiftDays) || shiftDays < 1 || shiftDays > 365) {
    showToast("Укажите количество дней от 1 до 365.", "error");
    return;
  }

  const billing = supportBillingCycle(entry);
  const shiftedDateISO = format(
    addDays(parseISO(billing.nextPaymentISO), shiftDays),
    "yyyy-MM-dd"
  );

  state.supportShiftPending = true;
  render();
  try {
    await updateDoc(doc(db, "packages", entry.id), {
      supportPaymentAnchorISO: billing.periodStartISO,
      supportNextPaymentISO: shiftedDateISO
    });
    state.supportShiftDays = "";
    showToast(
      `Следующая оплата: ${formatSupportStart(shiftedDateISO)}.`,
      "success"
    );
  } catch (err) {
    console.error("Ошибка переноса оплаты:", err);
    showToast("Не удалось перенести оплату.", "error");
  } finally {
    state.supportShiftPending = false;
    render();
  }
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
  const columns = visibleTimeColumns();
  const startMinute = state.modalHour * 60;
  const timeText = columns
    .map((column) => formatColumnTime(startMinute, column.settings))
    .join(" / ");

  return `
    <div class="modal-overlay" data-action="overlay-click">
      <div class="modal">
        <h3>Добавить запись</h3>
        <p>${escapeHtml(d)} — ${timeText}</p>
        <select data-bind="modalClient">
          <option value="">Выберите клиента</option>
          ${activeClients()
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
    showToast("Выберите клиента.", "error");
    return;
  }

  // Находим все пакеты клиента
  let pkgList = packages.filter(
    (p) =>
      !p.monthlySupport &&
      !p.placeholder &&
      (p.clientName === name ||
        (Array.isArray(p.clientNames) && p.clientNames.includes(name)))
  );
  if (pkgList.length === 0) {
    showToast("У клиента нет доступных пакетов.", "error");
    return;
  }

  // Если есть общий пакет — используем группу имён
  const sharedPkg = pkgList.find(
    (p) => Array.isArray(p.clientNames) && p.clientNames.length > 1
  );
  if (sharedPkg) {
    const sharedNames = [...sharedPkg.clientNames].sort();
    pkgList = packages.filter((p) => {
      if (p.monthlySupport) return false;
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
    showToast("У клиента нет доступных пакетов.", "error");
    return;
  }

  const dateISO = state.modalDateISO;
  const hour = state.modalHour;

  // Проверяем, что слот не занят
  const exists = bookings.some(
    (b) => b.dateISO === dateISO && bookingBaseHour(b) === hour
  );
  if (exists) {
    showToast("На это время уже есть запись.", "error");
    return;
  }

  // Добавляем новую бронь в Firestore
  await addDoc(collection(db, "bookings"), {
    clientName: name,
    dateISO,
    hour,
    utcMinute: zoneToZoneMinute(
      hour * 60,
      timeSettings.yellow.zoneId,
      BOOKING_REFERENCE_ZONE_ID
    ),
    timeZoneId: timeSettings.yellow.zoneId,
    packageId: targetPkg.id
  });

  // Теперь пересчитываем номера тренировок пакета
  await reindexPackageSessions(targetPkg.id);
  state.modalOpen = false;
  render();
}

function clockText(minute) {
  const normalized = normalizeMinuteOfDay(minute);
  const hour = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function relativeDayText(minute) {
  const dayOffset = Math.floor(minute / DAY_MINUTES);
  if (dayOffset === 0) return "";
  if (dayOffset === 1) return " (+1 день)";
  if (dayOffset === -1) return " (-1 день)";
  return ` (${dayOffset > 0 ? "+" : ""}${dayOffset} дня)`;
}

function bookingTimeZoneSummary(baseHour) {
  return visibleTimeColumns()
    .map((column) => {
      const minute = baseToColumnMinute(baseHour * 60, column.settings);
      return `${shortZoneLabel(column.settings)} ${clockText(minute)}${relativeDayText(minute)}`;
    })
    .join(" · ");
}

function bookingMoveHours() {
  return [...new Set([...scheduleHours(), Number(state.bookingMoveHour)])]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function openBookingDetails(id) {
  const booking = bookings.find((item) => item.id === id);
  if (!booking) {
    showToast("Запись не найдена.", "error");
    return;
  }

  state.bookingDetailsOpen = true;
  state.bookingDetailsId = id;
  state.bookingMoveDateISO = booking.dateISO;
  state.bookingMoveHour = bookingBaseHour(booking);
  state.bookingMoveCalendarMonthISO = monthStartISOFor(booking.dateISO);
  state.bookingMoveCalendarOpen = false;
  state.bookingMoveTimeOpen = false;
  state.selectedBookingId = null;
  render();
}

function closeBookingDetails() {
  state.bookingDetailsOpen = false;
  state.bookingDetailsId = null;
  state.bookingMoveCalendarOpen = false;
  state.bookingMoveTimeOpen = false;
  render();
}

function renderBookingMoveCalendar() {
  const monthStart = parseISO(
    state.bookingMoveCalendarMonthISO ||
      monthStartISOFor(state.bookingMoveDateISO)
  );
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const todayISO = currentLocalDateISO();
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(monthStart);

  const dayCells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      return `<span class="package-calendar-empty"></span>`;
    }

    const dateISO = format(new Date(year, month, day), "yyyy-MM-dd");
    const selected = dateISO === state.bookingMoveDateISO;
    const today = dateISO === todayISO;
    return `
      <button type="button"
              class="package-calendar-day ${selected ? "selected" : ""} ${today ? "today" : ""}"
              data-action="select-booking-move-date"
              data-date="${dateISO}"
              aria-label="${escapeHtml(formatSupportStart(dateISO))}">
        ${day}
      </button>`;
  }).join("");

  return `
    <div class="package-calendar booking-move-calendar">
      <div class="package-calendar-header">
        <button type="button"
                data-action="booking-move-calendar-prev"
                aria-label="Предыдущий месяц">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="16"
               height="16"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 18-6-6 6-6"></path>
          </svg>
        </button>
        <strong>${escapeHtml(monthLabel)}</strong>
        <button type="button"
                data-action="booking-move-calendar-next"
                aria-label="Следующий месяц">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="16"
               height="16"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </div>
      <div class="package-calendar-weekdays">
        ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
          .map((day) => `<span>${day}</span>`)
          .join("")}
      </div>
      <div class="package-calendar-grid">${dayCells}</div>
    </div>`;
}

function renderBookingMoveTimeSelector() {
  const selectedHour = Number(state.bookingMoveHour);

  return `
    <div class="booking-move-time-select">
      <button type="button"
              class="booking-move-time-field ${state.bookingMoveTimeOpen ? "open" : ""}"
              data-action="toggle-booking-move-time"
              aria-haspopup="listbox"
              aria-expanded="${state.bookingMoveTimeOpen}">
        <span class="booking-move-time-main">${clockText(selectedHour * 60)}</span>
        <span class="booking-move-time-detail">
          ${escapeHtml(bookingTimeZoneSummary(selectedHour))}
        </span>
      </button>
      ${
        state.bookingMoveTimeOpen
          ? `
            <div class="booking-move-time-options" role="listbox">
              ${bookingMoveHours()
                .map(
                  (hour) => `
                    <button type="button"
                            class="booking-move-time-option ${hour === selectedHour ? "active" : ""}"
                            data-action="select-booking-move-hour"
                            data-hour="${hour}"
                            role="option"
                            aria-selected="${hour === selectedHour}">
                      <span class="booking-move-time-main">${clockText(hour * 60)}</span>
                      <span class="booking-move-time-detail">
                        ${escapeHtml(bookingTimeZoneSummary(hour))}
                      </span>
                    </button>`
                )
                .join("")}
            </div>`
          : ""
      }
    </div>`;
}

function renderBookingDetailsModal() {
  const booking = bookings.find((item) => item.id === state.bookingDetailsId);
  if (!booking) return "";

  const packageData = packages.find((item) => item.id === booking.packageId);
  const currentHour = bookingBaseHour(booking);
  const sessionText = packageData
    ? booking.sessionNumber
      ? `${booking.sessionNumber} из ${packageData.size}`
      : `Пакет на ${packageData.size}`
    : booking.sessionNumber
      ? `Тренировка ${booking.sessionNumber}`
      : "Без пакета";
  const hasChanges =
    booking.dateISO !== state.bookingMoveDateISO ||
    currentHour !== Number(state.bookingMoveHour);

  return `
    <div class="modal-overlay booking-details-overlay" data-action="overlay-click">
      <div class="modal booking-details-modal">
        <h3>Запись</h3>
        <div class="booking-details-client">${escapeHtml(booking.clientName)}</div>
        <div class="booking-details-info">
          <div class="booking-details-info-row">
            <span>Дата</span>
            <strong>${escapeHtml(formatSupportStart(booking.dateISO))}</strong>
          </div>
          <div class="booking-details-info-row">
            <span>Время</span>
            <strong>${escapeHtml(bookingTimeZoneSummary(currentHour))}</strong>
          </div>
          <div class="booking-details-info-row">
            <span>Пакет</span>
            <strong>${escapeHtml(sessionText)}</strong>
          </div>
        </div>

        <div class="booking-move-section">
          <div class="booking-move-title">Перенести запись</div>
          <div class="booking-move-field">
            <span class="booking-move-label">Новая дата</span>
            <button type="button"
                    class="booking-move-date-field ${state.bookingMoveCalendarOpen ? "open" : ""}"
                    data-action="toggle-booking-move-calendar"
                    aria-expanded="${state.bookingMoveCalendarOpen}">
              <span>${escapeHtml(formatDateField(state.bookingMoveDateISO))}</span>
              <svg xmlns="http://www.w3.org/2000/svg"
                   width="17"
                   height="17"
                   viewBox="0 0 24 24"
                   aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 2v3m10-3v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m2.5 9h.01m4.49 0h.01m4.49 0h.01M7.5 17h.01m4.49 0h.01m4.49 0h.01"></path>
              </svg>
            </button>
            ${state.bookingMoveCalendarOpen ? renderBookingMoveCalendar() : ""}
          </div>
          <div class="booking-move-field">
            <span class="booking-move-label">Новое время</span>
            ${renderBookingMoveTimeSelector()}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-gray" data-action="close-booking-details">Закрыть</button>
          <button class="btn-blue"
                  data-action="save-booking-move"
                  ${hasChanges ? "" : "disabled"}>
            Перенести
          </button>
        </div>
      </div>
    </div>`;
}

function toggleBookingMoveCalendar() {
  state.bookingMoveCalendarOpen = !state.bookingMoveCalendarOpen;
  state.bookingMoveTimeOpen = false;
  render();
}

function moveBookingMoveCalendar(monthDelta) {
  const current = parseISO(
    state.bookingMoveCalendarMonthISO || monthStartISOFor(state.bookingMoveDateISO)
  );
  const next = new Date(current.getFullYear(), current.getMonth() + monthDelta, 1);
  state.bookingMoveCalendarMonthISO = format(next, "yyyy-MM-dd");
  render();
}

function selectBookingMoveDate(dateISO) {
  state.bookingMoveDateISO = dateISO;
  state.bookingMoveCalendarMonthISO = monthStartISOFor(dateISO);
  state.bookingMoveCalendarOpen = false;
  render();
}

function toggleBookingMoveTime() {
  state.bookingMoveTimeOpen = !state.bookingMoveTimeOpen;
  state.bookingMoveCalendarOpen = false;
  render();
}

function selectBookingMoveHour(hour) {
  if (!Number.isFinite(hour)) return;
  state.bookingMoveHour = hour;
  state.bookingMoveTimeOpen = false;
  render();
}

async function saveBookingMove() {
  const booking = bookings.find((item) => item.id === state.bookingDetailsId);
  if (!booking) {
    showToast("Запись не найдена.", "error");
    closeBookingDetails();
    return;
  }

  const dateISO = state.bookingMoveDateISO;
  const hour = Number(state.bookingMoveHour);
  if (!dateISO || !Number.isFinite(hour)) {
    showToast("Выберите дату и время.", "error");
    return;
  }

  const slotIsBusy = bookings.some(
    (item) =>
      item.id !== booking.id &&
      item.dateISO === dateISO &&
      bookingBaseHour(item) === hour
  );
  if (slotIsBusy) {
    showToast("На это время уже есть запись.", "error");
    return;
  }

  try {
    await updateDoc(doc(db, "bookings", booking.id), {
      dateISO,
      hour,
      utcMinute: zoneToZoneMinute(
        hour * 60,
        timeSettings.yellow.zoneId,
        BOOKING_REFERENCE_ZONE_ID
      ),
      timeZoneId: timeSettings.yellow.zoneId
    });

    if (booking.packageId) {
      const packageRef = doc(db, "packages", booking.packageId);
      const packageSnap = await getDoc(packageRef);
      if (packageSnap.exists()) {
        await reindexPackageSessions(booking.packageId);
      }
    }

    state.anchorDate = parseISO(dateISO);
    state.bookingDetailsOpen = false;
    state.bookingDetailsId = null;
    state.bookingMoveCalendarOpen = false;
    state.bookingMoveTimeOpen = false;
    render();
    showToast("Запись перенесена.", "success");
  } catch (err) {
    console.error("Ошибка переноса записи:", err);
    showToast("Не удалось перенести запись.", "error");
  }
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
// ---------- Добавляем модалку для удаления ПАКЕТА ----------
function openConfirmDeletePackage(client, pid) {
  state.confirm = {
    open: true,
    type: "package",
    itemId: pid,
    title: `Удалить пакет клиента - ${client} ?`,

    message: `При удалении пакета записи останутся`
  };
  render();
}
// ---------- Добавляем модалку для удаления КЛИЕНТА----------
function openConfirmDeleteClient(client) {
  state.confirm = {
    open: true,
    type: "client",
    itemId: client,
    title: `Удалить клиента ${client}?`,
    message: "Выберите, что сделать с записями клиента.",
    deleteMode: "delete-all",
    dropdownOpen: false,
    pending: false
  };
  render();
}

function openConfirmDeleteMonthly(id, client) {
  state.confirm = {
    open: true,
    type: "monthly",
    itemId: id,
    title: `Удалить ${client} из месячного ведения?`,
    message: "Обычные пакеты и записи клиента останутся."
  };
  render();
}




function renderClientDeleteModeSelector() {
  const mode = state.confirm.deleteMode === "keep-bookings"
    ? "keep-bookings"
    : "delete-all";
  const keepBookings = mode === "keep-bookings";

  return `
    <div class="client-delete-choice">
      <span class="client-delete-choice-label">Вариант удаления</span>
      <button type="button"
              class="client-delete-mode-field ${state.confirm.dropdownOpen ? "open" : ""}"
              data-action="toggle-client-delete-mode"
              aria-haspopup="listbox"
              aria-expanded="${Boolean(state.confirm.dropdownOpen)}"
              ${state.confirm.pending ? "disabled" : ""}>
        <span class="client-delete-mode-main">
          ${keepBookings ? "Оставить записи" : "Удалить всё"}
        </span>
        <span class="client-delete-mode-detail">
          ${keepBookings ? "Удалить клиента и пакеты" : "Клиента, пакеты и записи"}
        </span>
      </button>
      ${
        state.confirm.dropdownOpen
          ? `
            <div class="client-delete-mode-options" role="listbox">
              <button type="button"
                      class="client-delete-mode-option ${!keepBookings ? "active" : ""}"
                      data-action="select-client-delete-mode"
                      data-mode="delete-all"
                      role="option"
                      aria-selected="${!keepBookings}"
                      ${state.confirm.pending ? "disabled" : ""}>
                <span class="client-delete-mode-main">Удалить всё</span>
                <span class="client-delete-mode-detail">Клиента, пакеты и записи</span>
              </button>
              <button type="button"
                      class="client-delete-mode-option ${keepBookings ? "active" : ""}"
                      data-action="select-client-delete-mode"
                      data-mode="keep-bookings"
                      role="option"
                      aria-selected="${keepBookings}"
                      ${state.confirm.pending ? "disabled" : ""}>
                <span class="client-delete-mode-main">Оставить записи</span>
                <span class="client-delete-mode-detail">Удалить клиента и пакеты</span>
              </button>
            </div>`
          : ""
      }
    </div>`;
}

function renderConfirmModal() {
  const isClientDelete = state.confirm.type === "client";
  const isPending = Boolean(state.confirm.pending);

  return `
    <div class="modal-overlay" data-action="overlay-click">
      <div class="modal ${isClientDelete ? "client-delete-confirm" : ""}" data-role="confirm-modal">
        <h3>${escapeHtml(state.confirm.title || "Подтверждение")}</h3>
        <p class="modal-subtext">${escapeHtml(state.confirm.message || "")}</p>
        ${isClientDelete ? renderClientDeleteModeSelector() : ""}

        <div class="modal-actions">
          <button class="btn-gray"
                  data-action="confirm-cancel"
                  ${isPending ? "disabled" : ""}>
            Отмена
          </button>
          <button class="btn-red"
                  data-action="confirm-ok"
                  data-id="${state.confirm.itemId || state.confirm.bookingId || ''}"
                  aria-busy="${isPending}"
                  ${isPending ? "disabled" : ""}>
            ${isPending ? "Удаляем..." : "Удалить"}
          </button>
        </div>
      </div>
    </div>
  `;
}





async function handleConfirmOk(e) {
  if (state.confirm.pending) return;

  const id = state.confirm.itemId || state.confirm.bookingId;
  const type = state.confirm.type;
  const clientDeleteMode = state.confirm.deleteMode === "keep-bookings"
    ? "keep-bookings"
    : "delete-all";

  console.log("🔥 confirm-ok:", type, id);

  if (!id || !type) {
    console.warn("❌ confirm: нет id или типа", state.confirm);
    state.confirm = {
      open: false,
      title: "",
      message: "",
      type: null,
      bookingId: null,
      itemId: null,
      deleteMode: "delete-all",
      dropdownOpen: false,
      pending: false
    };
    render();
    return;
  }

  state.confirm.pending = true;
  state.confirm.dropdownOpen = false;
  render();

  try {
    switch (type) {
      case "booking":
        await deleteBookingAndReindex(id);
        break;

      case "package":
        await requestRemovePackageForce(id);
        break;

      case "client":
        await requestRemoveClientForce(id, clientDeleteMode);
        showToast(
          clientDeleteMode === "keep-bookings"
            ? "Клиент и пакеты удалены. Записи сохранены."
            : "Клиент, пакеты и записи удалены.",
          "success"
        );
        break;

      case "monthly":
        await deleteDoc(doc(db, "packages", id));
        break;
    }

    state.confirm = {
      open: false,
      title: "",
      message: "",
      type: null,
      bookingId: null,
      itemId: null,
      deleteMode: "delete-all",
      dropdownOpen: false,
      pending: false
    };
    render();
  } catch (err) {
    console.error("❌ Ошибка:", err);
    state.confirm.pending = false;
    render();
    showToast("Ошибка удаления.", "error");
  }
}


// Мини-обёртки для удаления
async function requestRemovePackageForce(pid) {
  await deleteDoc(doc(db, "packages", pid));
}

async function requestRemoveClientForce(client, deleteMode = "delete-all") {
  // удаление пакетов
  const pkgList = packages.filter(p =>
    p.clientName === client ||
    (Array.isArray(p.clientNames) && p.clientNames.includes(client))
  );
  await Promise.all(
    pkgList.map((p) => deleteDoc(doc(db, "packages", p.id)))
  );

  if (deleteMode === "keep-bookings") return;

  // удаление всех бронирований
  const qb = query(collection(db, "bookings"), where("clientName", "==", client));
  const snap = await getDocs(qb);
  await Promise.all(
    snap.docs.map((bookingDoc) =>
      deleteDoc(doc(db, "bookings", bookingDoc.id))
    )
  );
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
    showToast("Ошибка удаления записи.", "error");
    return;
  }

  // 2. Если у брони нет packageId — просто выходим
  if (!b.packageId) {
    console.log("ℹ️ У брони нет packageId — пересчёт пакета пропускаем");
    return;
  }

  const packageRef = doc(db, "packages", b.packageId);
  const packageSnap = await getDoc(packageRef);

  // 3. Если пакет уже удалён → пересчёт НЕ делаем
  if (!packageSnap.exists()) {
    console.warn("⚠ Пакет уже удалён, пересчёт пропускаем:", b.packageId);
    return;
  }

  // 4. Пересчитываем оставшиеся тренировки пакета
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
          bookingSortValue(a) - bookingSortValue(c)
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
    await updateDoc(packageRef, {
      used: remaining.length
    });

    console.log("✅ Пересчёт пакета завершён");
  } catch (err) {
    console.error("❌ Ошибка пересчёта пакета:", err);
    // не падаем — запись уже удалена
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
        a.dateISO.localeCompare(b.dateISO) || bookingSortValue(a) - bookingSortValue(b)
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
  const todayISO = currentLocalDateISO();
  const group = sharedClientGroups().find((item) =>
    item.members.includes(prefill)
  );

  state.packageModalOpen = true;
  state.packageClient = group?.main || prefill || "";
  state.packageMainLocked = Boolean(group);
  state.packageSize = 10;
  state.packageSizeDropdownOpen = false;
  state.packageMembers = group
    ? group.members
        .filter((name) => name !== group.main)
        .slice(0, 2)
        .map((name) => ({
          value: name,
          editing: false,
          existingGroup: true
        }))
    : [];
  state.packageMemberPickerOpen = null;
  state.packageMonthly = false;
  state.packageStartISO = todayISO;
  state.packageCalendarMonthISO = monthStartISOFor(todayISO);
  state.packageCalendarOpen = false;
  render();
}

function renderPackageModal() {
  const canAddMember = canAddPackageMember();

  return `
    <div class="modal-overlay package-modal-overlay" data-role="overlay">
      <div class="modal package-modal">
        <h3>Добавить клиента</h3>
        <div class="package-primary-row">
          <input type="text"
                 data-bind="packageClient"
                 placeholder="Имя основного клиента"
                 value="${escapeHtml(state.packageClient)}"
                 ${state.packageMainLocked ? "readonly" : ""} />
          <button type="button"
                  class="add-group-member-button"
                  data-action="add-package-member"
                  ${canAddMember ? "" : "hidden"}>
            <svg xmlns="http://www.w3.org/2000/svg"
                 width="15"
                 height="15"
                 viewBox="0 0 24 24"
                 aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8a4 4 0 0 0 0 8m10-3v6m3-3h-6"></path>
            </svg>
            <span>В группу</span>
          </button>
        </div>
        ${renderPackageMemberFields()}
        ${renderPackageSizeSelector()}
        <label class="monthly-support-toggle">
          <input class="monthly-support-checkbox"
                 type="checkbox"
                 data-action="toggle-package-monthly"
                 ${state.packageMonthly ? "checked" : ""}>
          <span>Помесячное ведение</span>
        </label>
        ${
          state.packageMonthly
            ? `
              <div class="monthly-start-field">
                <span class="monthly-start-label">Начало ведения</span>
                <button type="button"
                        class="monthly-date-button ${state.packageCalendarOpen ? "open" : ""}"
                        data-action="toggle-package-calendar"
                        aria-expanded="${state.packageCalendarOpen}">
                  <span>${escapeHtml(formatDateField(state.packageStartISO))}</span>
                  <svg xmlns="http://www.w3.org/2000/svg"
                       width="17"
                       height="17"
                       viewBox="0 0 24 24"
                       aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 2v3m10-3v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m2.5 9h.01m4.49 0h.01m4.49 0h.01M7.5 17h.01m4.49 0h.01m4.49 0h.01"></path>
                  </svg>
                </button>
                ${state.packageCalendarOpen ? renderPackageCalendar() : ""}
              </div>`
            : ""
        }
        <div class="modal-actions">
          <button class="btn-blue" data-action="save-package">Сохранить</button>
          <button class="btn-gray" data-action="close-package-modal">Отмена</button>
        </div>
      </div>
    </div>
  `;
}

function packageSizeLabel(size) {
  return Number(size) === 1 ? "1 тренировка" : `${Number(size)} тренировок`;
}

function renderPackageSizeSelector() {
  const sizes = [1, 5, 10, 20];

  return `
    <div class="package-size-select">
      <button type="button"
              class="package-size-field ${state.packageSizeDropdownOpen ? "open" : ""}"
              data-action="toggle-package-size-dropdown"
              aria-haspopup="listbox"
              aria-expanded="${state.packageSizeDropdownOpen}">
        ${escapeHtml(packageSizeLabel(state.packageSize))}
      </button>
      ${
        state.packageSizeDropdownOpen
          ? `
            <div class="package-size-options" role="listbox">
              ${sizes
                .map(
                  (size) => `
                    <button type="button"
                            class="${state.packageSize === size ? "active" : ""}"
                            data-action="select-package-size"
                            data-size="${size}"
                            role="option"
                            aria-selected="${state.packageSize === size}">
                      ${escapeHtml(packageSizeLabel(size))}
                    </button>`
                )
                .join("")}
            </div>`
          : ""
      }
    </div>`;
}

function togglePackageSizeDropdown() {
  state.packageSizeDropdownOpen = !state.packageSizeDropdownOpen;
  state.packageMemberPickerOpen = null;
  state.packageCalendarOpen = false;
  render();
}

function selectPackageSize(size) {
  const allowedSizes = [1, 5, 10, 20];
  const selectedSize = Number(size);
  if (!allowedSizes.includes(selectedSize)) return;
  state.packageSize = selectedSize;
  state.packageSizeDropdownOpen = false;
  render();
}

function renderPackageMemberFields() {
  if (state.packageMonthly || state.packageMembers.length === 0) return "";

  const availableNames = availablePackageMemberNames();

  return `
    <div class="package-member-fields">
      ${state.packageMembers
        .map((member, index) => {
          const pickerOpen = state.packageMemberPickerOpen === index;
          return `
            <div class="package-member-row">
              <div class="package-member-input-wrap ${member.existingGroup ? "existing-member" : ""} ${member.editing ? "editing-member" : ""}">
                <input type="text"
                       class="package-member-input"
                       data-bind="packageMember"
                       data-index="${index}"
                       placeholder="Участник ${index + 2}"
                       value="${escapeHtml(member.value)}"
                       ${
                         member.editing
                           ? ""
                           : member.existingGroup
                             ? "readonly"
                             : `readonly data-action="open-package-member-picker"`
                       }>
                ${
                  pickerOpen
                    ? `
                      <div class="package-member-picker">
                        <div class="package-member-options">
                          ${
                            availableNames.length === 0
                              ? `<div class="package-member-empty">Нет свободных клиентов</div>`
                              : availableNames
                                  .map(
                                    (name) => `
                                      <button type="button"
                                              data-action="choose-package-member"
                                              data-index="${index}"
                                              data-client="${escapeHtml(name)}">
                                        ${escapeHtml(name)}
                                      </button>`
                                  )
                                  .join("")
                          }
                        </div>
                        <button type="button"
                                class="package-member-new"
                                data-action="new-package-member"
                                data-index="${index}">
                          <svg xmlns="http://www.w3.org/2000/svg"
                               width="15"
                               height="15"
                               viewBox="0 0 24 24"
                               aria-hidden="true">
                            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"></path>
                          </svg>
                          <span>Новый клиент</span>
                        </button>
                      </div>`
                    : ""
                }
              </div>
              <button type="button"
                      class="package-member-remove"
                      data-action="remove-package-member"
                      data-index="${index}"
                      aria-label="Удалить участника из группы">
                <svg xmlns="http://www.w3.org/2000/svg"
                     width="16"
                     height="16"
                     viewBox="0 0 24 24"
                     aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6 6 18M6 6l12 12"></path>
                </svg>
              </button>
            </div>`;
        })
        .join("")}
    </div>`;
}

function availablePackageMemberNames() {
  const selected = new Set(
    [state.packageClient, ...state.packageMembers.map((member) => member.value)]
      .map((name) => String(name || "").trim().toLocaleLowerCase("ru-RU"))
      .filter(Boolean)
  );
  const groupedClients = sharedClientGroupMap();

  return clientNames().filter((name) => {
    const normalized = name.trim().toLocaleLowerCase("ru-RU");
    return !selected.has(normalized) && !groupedClients.has(name);
  });
}

function canAddPackageMember() {
  return (
    !state.packageMonthly &&
    state.packageClient.trim().length >= 3 &&
    state.packageMembers.length < 2 &&
    state.packageMembers.every((member) => member.value.trim() !== "")
  );
}

function addPackageMember() {
  if (!canAddPackageMember()) return;

  state.packageSizeDropdownOpen = false;
  state.packageMembers.push({
    value: "",
    editing: false,
    existingGroup: false
  });
  state.packageMemberPickerOpen = null;
  render();
}

function openPackageMemberPicker(index) {
  if (!state.packageMembers[index]) return;
  state.packageSizeDropdownOpen = false;
  state.packageMembers[index].editing = false;
  state.packageMemberPickerOpen = index;
  render();
}

function choosePackageMember(index, name) {
  const member = state.packageMembers[index];
  if (!member || !name) return;
  member.value = name;
  member.editing = false;
  member.existingGroup = false;
  state.packageMemberPickerOpen = null;
  render();
}

function beginNewPackageMember(index) {
  const member = state.packageMembers[index];
  if (!member) return;
  member.value = "";
  member.editing = true;
  member.existingGroup = false;
  state.packageMemberPickerOpen = null;
  render();

  requestAnimationFrame(() => {
    const input = document.querySelector(
      `[data-bind="packageMember"][data-index="${index}"]`
    );
    input?.focus();
  });
}

async function removePackageMember(index) {
  const member = state.packageMembers[index];
  if (!member) return;

  if (member.existingGroup && member.value) {
    try {
      await detachClientFromGroup(state.packageClient, member.value);
      showToast(`${member.value} удалён из группы.`, "success");
    } catch (err) {
      console.error("Ошибка удаления участника из группы:", err);
      showToast("Не удалось удалить участника из группы.", "error");
      return;
    }
  }

  state.packageMembers.splice(index, 1);
  state.packageMemberPickerOpen = null;
  render();
}

async function detachClientFromGroup(mainName, memberName) {
  const groupPackages = packages.filter(
    (p) =>
      !p.monthlySupport &&
      Array.isArray(p.clientNames) &&
      p.clientNames.includes(mainName) &&
      p.clientNames.includes(memberName)
  );
  const groupPackageIds = new Set(groupPackages.map((p) => p.id));

  await Promise.all(
    groupPackages.map((p) => {
      const remainingNames = p.clientNames.filter((name) => name !== memberName);
      const update =
        remainingNames.length === 1
          ? {
              clientName: remainingNames[0],
              clientNames: deleteField()
            }
          : { clientNames: remainingNames };
      return updateDoc(doc(db, "packages", p.id), update);
    })
  );

  const memberBookings = bookings.filter(
    (booking) =>
      groupPackageIds.has(booking.packageId) && booking.clientName === memberName
  );
  await Promise.all(
    memberBookings.map((booking) =>
      updateDoc(doc(db, "bookings", booking.id), { clientName: mainName })
    )
  );

  const hasOtherPackage = packages.some(
    (p) =>
      !p.monthlySupport &&
      !groupPackageIds.has(p.id) &&
      (p.clientName === memberName ||
        (Array.isArray(p.clientNames) && p.clientNames.includes(memberName)))
  );

  if (!hasOtherPackage) {
    await addDoc(collection(db, "packages"), {
      clientName: memberName,
      placeholder: true,
      size: 0,
      used: 0,
      addedISO: currentLocalDateISO()
    });
  }
}

async function removeClientPlaceholders(names) {
  const normalizedNames = new Set(
    names.map((name) => name.trim().toLocaleLowerCase("ru-RU"))
  );
  const placeholders = packages.filter(
    (p) =>
      p.placeholder &&
      p.clientName &&
      normalizedNames.has(p.clientName.trim().toLocaleLowerCase("ru-RU"))
  );
  await Promise.all(
    placeholders.map((p) => deleteDoc(doc(db, "packages", p.id)))
  );
}

function renderPackageCalendar() {
  const monthStart = parseISO(
    state.packageCalendarMonthISO || monthStartISOFor(state.packageStartISO)
  );
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const todayISO = currentLocalDateISO();
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(monthStart);

  const dayCells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      return `<span class="package-calendar-empty"></span>`;
    }

    const dateISO = format(new Date(year, month, day), "yyyy-MM-dd");
    const selected = dateISO === state.packageStartISO;
    const today = dateISO === todayISO;
    return `
      <button type="button"
              class="package-calendar-day ${selected ? "selected" : ""} ${today ? "today" : ""}"
              data-action="select-package-start-date"
              data-date="${dateISO}"
              aria-label="${escapeHtml(formatSupportStart(dateISO))}">
        ${day}
      </button>`;
  }).join("");

  return `
    <div class="package-calendar">
      <div class="package-calendar-header">
        <button type="button"
                data-action="package-calendar-prev"
                aria-label="Предыдущий месяц">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="16"
               height="16"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 18-6-6 6-6"></path>
          </svg>
        </button>
        <strong>${escapeHtml(monthLabel)}</strong>
        <button type="button"
                data-action="package-calendar-next"
                aria-label="Следующий месяц">
          <svg xmlns="http://www.w3.org/2000/svg"
               width="16"
               height="16"
               viewBox="0 0 24 24"
               aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </div>
      <div class="package-calendar-weekdays">
        ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
          .map((day) => `<span>${day}</span>`)
          .join("")}
      </div>
      <div class="package-calendar-grid">${dayCells}</div>
    </div>`;
}

function togglePackageMonthly(checked) {
  state.packageMonthly = Boolean(checked);
  state.packageSizeDropdownOpen = false;
  if (state.packageMonthly) {
    state.packageMemberPickerOpen = null;
  }
  state.packageCalendarOpen = false;
  render();
}

function togglePackageCalendar() {
  state.packageSizeDropdownOpen = false;
  state.packageCalendarOpen = !state.packageCalendarOpen;
  render();
}

function movePackageCalendar(monthDelta) {
  const current = parseISO(state.packageCalendarMonthISO || currentMonthStartISO());
  const next = new Date(current.getFullYear(), current.getMonth() + monthDelta, 1);
  state.packageCalendarMonthISO = format(next, "yyyy-MM-dd");
  render();
}

function selectPackageStartDate(dateISO) {
  state.packageStartISO = dateISO;
  state.packageCalendarMonthISO = monthStartISOFor(dateISO);
  state.packageCalendarOpen = false;
  render();
}

async function savePackage() {
  const raw = (state.packageClient || "").trim();
  if (!raw) {
    showToast("Введите имя клиента.", "error");
    return;
  }

  if (raw.includes(",")) {
    showToast("Добавляйте участников кнопкой «В группу».", "error");
    return;
  }

  const memberNames = state.packageMembers.map((member) => member.value.trim());
  if (!state.packageMonthly && memberNames.some((name) => name === "")) {
    showToast("Выберите или введите имя участника.", "error");
    return;
  }

  const names = state.packageMonthly ? [raw] : [raw, ...memberNames];
  const normalizedNames = names.map((name) =>
    name.toLocaleLowerCase("ru-RU")
  );
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    showToast("Имена участников не должны повторяться.", "error");
    return;
  }

  const addedISO = currentLocalDateISO();

  try {
    if (state.packageMonthly) {
      if (!state.packageStartISO) {
        showToast("Укажите дату начала ведения.", "error");
        return;
      }

      const duplicateNames = names.filter((name) =>
        packages.some((p) => p.monthlySupport && p.clientName === name)
      );
      if (duplicateNames.length > 0) {
        showToast(`${duplicateNames.join(", ")} уже есть в месячном ведении.`, "error");
        return;
      }

      await Promise.all(
        names.map((name) =>
          addDoc(collection(db, "packages"), {
            clientName: name,
            monthlySupport: true,
            supportStartISO: state.packageStartISO,
            addedISO
          })
        )
      );
    } else {
      const data = {
        size: Number(state.packageSize || 10),
        used: 0,
        addedISO
      };

      if (names.length === 1) {
        data.clientName = names[0];
      } else {
        data.clientNames = names;
      }

      await addDoc(collection(db, "packages"), data);
      await removeClientPlaceholders(names);
    }
  } catch (err) {
    console.error("Ошибка сохранения клиента:", err);
    showToast("Не удалось сохранить. Проверьте подключение.", "error");
    return;
  }

  state.packageModalOpen = false;
  state.packageMembers = [];
  state.packageMemberPickerOpen = null;
  state.packageSizeDropdownOpen = false;
  state.packageCalendarOpen = false;
  render();
  showToast(
    state.packageMonthly ? "Добавлено в месячное ведение." : "Пакет добавлен.",
    "success"
  );
}

// ---------- Удаление пакета ----------
async function requestRemovePackage(clientName, packageId) {
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg || (pkg.used || 0) < pkg.size) {
    showToast("Нельзя удалить незавершённый пакет.", "error");
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
    showToast("Нельзя удалить клиента, пока есть незавершённые пакеты.", "error");
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

  // лёгкая вибрация при выборе пункта меню
  hapticTap();

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  currentPage = btn.dataset.page;
  render();
});

// --- Исправляем всплытие кликов внутри модалки ---
document.body.addEventListener("click", (e) => {
  // Останавливаем всплытие только если клик был именно по контенту модалки, а не по кнопкам
  const modalInner = e.target.closest(".modal");
  const isButton = e.target.closest("[data-action]");
  const memberPicker = e.target.closest(".package-member-picker");
  const memberField = e.target.closest(
    '[data-action="open-package-member-picker"]'
  );

  if (
    modalInner &&
    state.packageModalOpen &&
    state.packageMemberPickerOpen !== null &&
    !memberPicker &&
    !memberField
  ) {
    state.packageMemberPickerOpen = null;

    if (!isButton) {
      e.stopPropagation();
      render();
      return;
    }
  }

  if (modalInner && !isButton) {
    e.stopPropagation();
  }
});

document.addEventListener("touchend", (e) => {
  const button = e.target.closest(".client-delete-btn");
  if (!button) return;

  e.preventDefault();
  e.stopPropagation();
  suppressClientDeleteClickUntil = Date.now() + 800;
  openConfirmDeleteClient(button.dataset.client);
  void haptic("rigid");
}, { passive: false });



document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;

  const action = el.dataset.action;
  window._lastClickEvent = e;
  console.log("🔥 CLICK:", action);

  switch (action) {

    // ----- CANCEL -----
    case "confirm-cancel":
      if (state.confirm.pending) break;
      await haptic("rigid");
      state.confirm = {
        open: false,
        title: "",
        message: "",
        type: null,
        bookingId: null,
        itemId: null,
        deleteMode: "delete-all",
        dropdownOpen: false,
        pending: false
      };
      render();
      break;

    case "toggle-client-delete-mode":
      await haptic("soft");
      state.confirm.dropdownOpen = !state.confirm.dropdownOpen;
      render();
      break;

    case "select-client-delete-mode":
      await haptic("soft");
      state.confirm.deleteMode = el.dataset.mode === "keep-bookings"
        ? "keep-bookings"
        : "delete-all";
      state.confirm.dropdownOpen = false;
      render();
      break;

    // ----- DELETE CONFIRMED -----
    case "confirm-ok":
      void haptic("rigid");
      await handleConfirmOk(e);
      break;

    // ----- SWIPE WEEK soft -----
    case "prev-week":
      await haptic("soft");
      state.anchorDate = subWeeks(state.anchorDate, 1);
      closeAllTransient();
      render();
      break;

    case "next-week":
      await haptic("soft");
      state.anchorDate = addWeeks(state.anchorDate, 1);
      closeAllTransient();
      render();
      break;

    // ----- TODAY rigid -----
    case "today":
      await haptic("rigid");
      state.anchorDate = new Date();
      closeAllTransient();
      render();
      break;

    // ----- CLOSE MODAL -----
    case "close-add-booking":
      await haptic("rigid");
      state.modalOpen = false;
      render();
      break;

    // ----- SAVE BOOKING rigid -----
    case "save-booking":
      await haptic("rigid");
      await addBooking();
      break;

    case "open-booking-details":
      if (Date.now() < suppressBookingTapUntil) break;
      await haptic("soft");
      openBookingDetails(el.dataset.id);
      break;

    case "close-booking-details":
      await haptic("rigid");
      closeBookingDetails();
      break;

    case "toggle-booking-move-calendar":
      await haptic("soft");
      toggleBookingMoveCalendar();
      break;

    case "booking-move-calendar-prev":
      await haptic("soft");
      moveBookingMoveCalendar(-1);
      break;

    case "booking-move-calendar-next":
      await haptic("soft");
      moveBookingMoveCalendar(1);
      break;

    case "select-booking-move-date":
      await haptic("soft");
      selectBookingMoveDate(el.dataset.date);
      break;

    case "toggle-booking-move-time":
      await haptic("soft");
      toggleBookingMoveTime();
      break;

    case "select-booking-move-hour":
      await haptic("soft");
      selectBookingMoveHour(Number(el.dataset.hour));
      break;

    case "save-booking-move":
      await haptic("rigid");
      await saveBookingMove();
      break;

    case "open-time-settings":
      await haptic("soft");
      openTimeSettingsModal(el.dataset.column);
      break;

    case "select-time-zone":
      await haptic("soft");
      selectTimeZone(el.dataset.zoneId);
      break;

    case "toggle-hour-dropdown":
      await haptic("soft");
      toggleHourDropdown(el.dataset.field);
      break;

    case "select-work-hour":
      await haptic("soft");
      selectWorkHour(el.dataset.field, Number(el.dataset.minute));
      break;

    case "close-time-settings":
      await haptic("rigid");
      state.timeSettingsModalOpen = false;
      state.timeSettingsDraft = null;
      state.timeDropdownOpen = null;
      render();
      break;

    case "save-time-settings":
      await haptic("rigid");
      saveTimeSettings();
      break;

    // ----- DELETE BOOKING -----
    case "confirm-delete-booking":
      await haptic("rigid");
      openConfirmDeleteBooking(el.dataset.id);
      break;

    case "set-clients-tab":
      state.clientsTab = el.dataset.tab === "support" ? "support" : "personal";
      void haptic("soft");
      render();
      break;

    case "open-support-details":
      await haptic("soft");
      openSupportDetails(el.dataset.id);
      break;

    case "close-support-details":
      await haptic("rigid");
      closeSupportDetails();
      break;

    case "shift-support-payment":
      void haptic("rigid");
      await shiftSupportPayment();
      break;

    case "toggle-support-start-calendar":
      await haptic("soft");
      toggleSupportStartCalendar();
      break;

    case "support-start-calendar-prev":
      await haptic("soft");
      moveSupportStartCalendar(-1);
      break;

    case "support-start-calendar-next":
      await haptic("soft");
      moveSupportStartCalendar(1);
      break;

    case "select-support-start-date":
      await haptic("soft");
      await selectSupportStartDate(el.dataset.date);
      break;

    // ----- OPEN PACKAGE MODAL rigid -----
    case "open-package-modal-main":
      await haptic("rigid");
      openPackageModal("");
      break;

    case "open-package-modal-client":
      await haptic("rigid");
      openPackageModal(el.dataset.client || "");
      break;

    case "add-package-member":
      await haptic("soft");
      addPackageMember();
      break;

    case "open-package-member-picker":
      await haptic("soft");
      openPackageMemberPicker(Number(el.dataset.index));
      break;

    case "choose-package-member":
      await haptic("soft");
      choosePackageMember(Number(el.dataset.index), el.dataset.client);
      break;

    case "new-package-member":
      await haptic("soft");
      beginNewPackageMember(Number(el.dataset.index));
      break;

    case "remove-package-member":
      await haptic("rigid");
      await removePackageMember(Number(el.dataset.index));
      break;

    case "toggle-package-size-dropdown":
      await haptic("soft");
      togglePackageSizeDropdown();
      break;

    case "select-package-size":
      await haptic("soft");
      selectPackageSize(Number(el.dataset.size));
      break;

    case "toggle-package-monthly":
      await haptic("soft");
      togglePackageMonthly(el.checked);
      break;

    case "toggle-package-calendar":
      await haptic("soft");
      togglePackageCalendar();
      break;

    case "package-calendar-prev":
      await haptic("soft");
      movePackageCalendar(-1);
      break;

    case "package-calendar-next":
      await haptic("soft");
      movePackageCalendar(1);
      break;

    case "select-package-start-date":
      await haptic("soft");
      selectPackageStartDate(el.dataset.date);
      break;

    // ----- CLOSE PACKAGE MODAL rigid -----
    case "close-package-modal":
      await haptic("rigid");
      state.packageModalOpen = false;
      state.packageMembers = [];
      state.packageMemberPickerOpen = null;
      state.packageSizeDropdownOpen = false;
      state.packageCalendarOpen = false;
      render();
      break;

    // ----- SAVE PACKAGE rigid -----
    case "save-package":
      await haptic("rigid");
      await savePackage();
      break;

    // ----- EXPAND CLIENT soft -----
    case "toggle-client-expand":
      await haptic("soft");
      toggleClientExpand(el.dataset.client);
      break;

    // ----- EXPAND PACKAGE soft -----
    case "toggle-package-expand":
      await haptic("soft");
      togglePackageExpand(el.dataset.pid);
      break;

    // ----- REMOVE PACKAGE rigid -----
    case "remove-package":
      await haptic("rigid");
      openConfirmDeletePackage(el.dataset.client, el.dataset.pid);
      break;

    // ----- REMOVE CLIENT rigid -----
    case "remove-client":
      if (Date.now() < suppressClientDeleteClickUntil) break;
      openConfirmDeleteClient(el.dataset.client);
      void haptic("rigid");
      break;

    case "remove-monthly-support":
      await haptic("rigid");
      openConfirmDeleteMonthly(el.dataset.id, el.dataset.client);
      break;

    // ----- COPY soft -----
    case "copy-sessions": {
      await haptic("soft");
      const text = el.dataset.text || "";
      try {
        await navigator.clipboard.writeText(text);

        el.classList.add("copied");
        setTimeout(() => el.classList.remove("copied"), 600);

        showToast("Скопировано!", "success");
      } catch (err) {
        showToast("Не удалось скопировать.", "error");
      }
      break;
    }

  }
});

// Совместимость для старого вызова — чтобы кнопка меню снова работала
async function hapticTap() {
  return haptic("soft"); // или "rigid", если хочешь щелчок
}



  // безопасное закрытие модалок при клике в фон
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    if (
      state.packageModalOpen &&
      state.packageMemberPickerOpen !== null
    ) {
      state.packageMemberPickerOpen = null;
      render();
      return;
    }

    state.modalOpen = false;
    state.packageModalOpen = false;
    state.packageMembers = [];
    state.packageMemberPickerOpen = null;
    state.packageSizeDropdownOpen = false;
    state.packageCalendarOpen = false;
    state.timeSettingsModalOpen = false;
    state.timeSettingsDraft = null;
    state.bookingDetailsOpen = false;
    state.bookingDetailsId = null;
    state.bookingMoveCalendarOpen = false;
    state.bookingMoveTimeOpen = false;
    state.supportDetailsOpen = false;
    state.supportDetailsId = null;
    state.supportStartCalendarOpen = false;
    state.supportStartCalendarMonthISO = currentMonthStartISO();
    state.supportStartPending = false;
    state.supportShiftDays = "";
    state.supportShiftPending = false;
    state.confirm.open = false;
    render();
  }
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
let toastTimer = null;

function showToast(message, type = "info") {
  let toast = document.querySelector(".toast-message");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast-message";
    document.body.appendChild(toast);
  }

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast-message toast-${type}`;

  requestAnimationFrame(() => toast.classList.add("visible"));
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2600);
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
        showToast("Вибрация Haptics сработала.", "success");
      } else if ('vibrate' in navigator) {
        navigator.vibrate(100);
        showToast("Вибрация браузера сработала.", "success");
      } else {
        showToast("Вибрация недоступна.", "error");
      }
    } catch (err) {
      showToast(`Ошибка Haptics: ${err}`, "error");
    }
  });
});




// === вибрация ===

async function haptic(style = "light") {
  try {
    if (window.Capacitor?.Plugins?.Haptics) {
      await window.Capacitor.Plugins.Haptics.impact({ style });
    } else if ("vibrate" in navigator) {
      navigator.vibrate(20);
    }
  } catch (err) {
    console.warn("Haptics error:", err);
  }
}




// === Плавающая кнопка с анимирующимися SVG ===

function togglePage() {
  currentPage = (currentPage === "calendar") ? "clients" : "calendar";

  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`[data-page='${currentPage}']`)?.classList.add("active");

  render();
}





document.addEventListener('DOMContentLoaded', () => {

  const pluginAnim = lottie.loadAnimation({
    container: document.getElementById('plugin-icon'),
    renderer: 'svg',
    loop: false,
    autoplay: false,
    path: './icon-animations/plugin.json'
  });

  pluginAnim.setSpeed(4);

  const pluginBtn = document.getElementById('fab-toggle');
  let isPlaying = false;

 pluginBtn.addEventListener('click', () => {
   if (isPlaying) return;
   isPlaying = true;

   // просто запускаем, не ждём
   hapticTap();

   // Запускаем анимацию FAB
   pluginAnim.goToAndPlay(0, true);

   pluginAnim.addEventListener('complete', () => {
     isPlaying = false;
     pluginAnim.pause();
   });

   // Переключаем страницу
   togglePage();
 });

});


