const STORAGE_KEY = "fitnessTracker";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Data shape: { goal: number, days: { "YYYY-MM-DD": { workouts: [], meals: [] } } }
let data = load();
let weekStart = getMonday(new Date());
let selectedDate = toKey(new Date());

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.days) return saved;
  } catch (e) { /* ignore and start fresh */ }
  return { goal: 2000, days: {} };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { /* storage unavailable; data lives for this session only */ }
}

// ---- Date helpers ----
function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatShort(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getDay(key) {
  if (!data.days[key]) data.days[key] = { workouts: [], meals: [] };
  return data.days[key];
}

function dayTotals(key) {
  const day = data.days[key] || { workouts: [], meals: [] };
  return {
    eaten: day.meals.reduce((s, m) => s + m.calories, 0),
    burned: day.workouts.reduce((s, w) => s + w.calories, 0),
    minutes: day.workouts.reduce((s, w) => s + w.minutes, 0),
    workouts: day.workouts.length,
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Rendering ----
function render() {
  renderWeek();
  renderDay();
}

function renderWeek() {
  const weekEnd = addDays(weekStart, 6);
  document.getElementById("weekLabel").textContent =
    `${formatShort(weekStart)} – ${formatShort(weekEnd)}`;

  const keys = DAY_NAMES.map((_, i) => toKey(addDays(weekStart, i)));
  const totals = keys.map(dayTotals);

  const sum = totals.reduce(
    (acc, t) => ({
      eaten: acc.eaten + t.eaten,
      burned: acc.burned + t.burned,
      minutes: acc.minutes + t.minutes,
      workouts: acc.workouts + t.workouts,
    }),
    { eaten: 0, burned: 0, minutes: 0, workouts: 0 }
  );
  document.getElementById("sumEaten").textContent = sum.eaten.toLocaleString();
  document.getElementById("sumBurned").textContent = sum.burned.toLocaleString();
  document.getElementById("sumMinutes").textContent = sum.minutes.toLocaleString();
  document.getElementById("sumWorkouts").textContent = sum.workouts;

  // Scale bars against the largest value this week (or the goal)
  const max = Math.max(data.goal, ...totals.map(t => Math.max(t.eaten, t.burned)), 1);
  const todayKey = toKey(new Date());

  const grid = document.getElementById("weekGrid");
  grid.innerHTML = "";
  keys.forEach((key, i) => {
    const t = totals[i];
    const btn = document.createElement("button");
    btn.className = "day";
    if (key === selectedDate) btn.classList.add("selected");
    if (key === todayKey) btn.classList.add("today");
    btn.innerHTML = `
      <span class="day-label">${DAY_NAMES[i]}</span>
      <span class="day-date">${formatShort(fromKey(key))}</span>
      <div class="bars">
        <div class="goal-marker" style="bottom:${(data.goal / max) * 100}%"></div>
        <div class="bar eaten" style="height:${(t.eaten / max) * 100}%" title="Eaten: ${t.eaten} kcal"></div>
        <div class="bar burned" style="height:${(t.burned / max) * 100}%" title="Burned: ${t.burned} kcal"></div>
      </div>
      <div class="day-nums">${t.eaten} / ${t.burned}</div>
      <span class="day-badge ${t.workouts ? "" : "empty"}">${t.workouts}<span class="badge-word"> workout${t.workouts === 1 ? "" : "s"}</span></span>
    `;
    btn.addEventListener("click", () => {
      selectedDate = key;
      render();
    });
    grid.appendChild(btn);
  });
}

function renderDay() {
  const date = fromKey(selectedDate);
  const label = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  document.querySelectorAll(".day-name").forEach(el => (el.textContent = label));

  const day = data.days[selectedDate] || { workouts: [], meals: [] };

  const workoutList = document.getElementById("workoutList");
  workoutList.innerHTML = day.workouts.length
    ? day.workouts.map((w, i) => `
        <li>
          <div class="info">
            <div class="title">${escapeHtml(w.name)}</div>
            <div class="meta">${escapeHtml(w.type)} · ${w.minutes} min</div>
          </div>
          <span class="kcal">−${w.calories} kcal</span>
          <button class="delete-btn" data-list="workouts" data-index="${i}" aria-label="Delete">&times;</button>
        </li>`).join("")
    : `<li class="empty-msg">No workouts logged.</li>`;

  const mealList = document.getElementById("mealList");
  mealList.innerHTML = day.meals.length
    ? day.meals.map((m, i) => `
        <li>
          <div class="info">
            <div class="title">${escapeHtml(m.name)}</div>
            <div class="meta">${escapeHtml(m.meal)}</div>
          </div>
          <span class="kcal">${m.calories} kcal</span>
          <button class="delete-btn" data-list="meals" data-index="${i}" aria-label="Delete">&times;</button>
        </li>`).join("")
    : `<li class="empty-msg">No meals logged.</li>`;

  const t = dayTotals(selectedDate);
  const net = t.eaten - t.burned;
  const diff = net - data.goal;
  const status = diff > 0
    ? `<span class="over">${diff} over goal</span>`
    : `<span class="under">${-diff} under goal</span>`;
  document.getElementById("dayTotal").innerHTML =
    `Eaten ${t.eaten} − burned ${t.burned} = net ${net} kcal · ${status}`;
}

// ---- Events ----
document.getElementById("workoutForm").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  getDay(selectedDate).workouts.push({
    name: f.name.value.trim(),
    type: f.type.value,
    minutes: Number(f.minutes.value) || 0,
    calories: Number(f.calories.value) || 0,
  });
  save();
  f.reset();
  f.name.focus();
  render();
});

document.getElementById("mealForm").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  getDay(selectedDate).meals.push({
    name: f.name.value.trim(),
    meal: f.meal.value,
    calories: Number(f.calories.value) || 0,
  });
  save();
  f.reset();
  f.name.focus();
  render();
});

document.querySelector(".day-panels").addEventListener("click", e => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  getDay(selectedDate)[btn.dataset.list].splice(Number(btn.dataset.index), 1);
  save();
  render();
});

const goalInput = document.getElementById("goalInput");
goalInput.value = data.goal;
goalInput.addEventListener("change", () => {
  data.goal = Math.max(0, Number(goalInput.value) || 0);
  save();
  render();
});

function shiftWeek(n) {
  const selectedOffset = Math.round((fromKey(selectedDate) - weekStart) / 86400000);
  weekStart = addDays(weekStart, n * 7);
  selectedDate = toKey(addDays(weekStart, Math.min(Math.max(selectedOffset, 0), 6)));
  render();
}

document.getElementById("prevWeek").addEventListener("click", () => shiftWeek(-1));
document.getElementById("nextWeek").addEventListener("click", () => shiftWeek(1));
document.getElementById("thisWeek").addEventListener("click", () => {
  weekStart = getMonday(new Date());
  selectedDate = toKey(new Date());
  render();
});

render();

// Offline support / installable app
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
