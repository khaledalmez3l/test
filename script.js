const STORAGE_KEY = "fitnessTracker";
const THEME_KEY = "fitnessTracker.theme";
const TAB_KEY = "fitnessTracker.tab";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LB_PER_KG = 2.20462;

// Data shape:
// { goal, workoutGoal, waterGoal, unit: "kg"|"lb",
//   days: { "YYYY-MM-DD": { workouts: [{name,type,minutes,calories}],
//                           meals: [{name,meal,calories,protein?,carbs?,fat?}], water } },
//   weights: { "YYYY-MM-DD": kg } }
const DEFAULTS = { goal: 2000, workoutGoal: 4, waterGoal: 8, unit: "kg" };

let data = load();
let weekStart = getMonday(new Date());
let selectedDate = toKey(new Date());
let editing = null; // { list: "workouts"|"meals", index }

function normalize(saved) {
  const d = Object.assign({}, DEFAULTS, saved);
  d.days = d.days && typeof d.days === "object" ? d.days : {};
  d.weights = d.weights && typeof d.weights === "object" ? d.weights : {};
  return d;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.days) return normalize(saved);
  } catch (e) { /* ignore and start fresh */ }
  return normalize({});
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

function peekDay(key) {
  return data.days[key] || { workouts: [], meals: [] };
}

function sumOf(list, field) {
  return list.reduce((s, x) => s + (Number(x[field]) || 0), 0);
}

function dayTotals(key) {
  const day = peekDay(key);
  return {
    eaten: sumOf(day.meals, "calories"),
    burned: sumOf(day.workouts, "calories"),
    minutes: sumOf(day.workouts, "minutes"),
    workouts: day.workouts.length,
    protein: sumOf(day.meals, "protein"),
    carbs: sumOf(day.meals, "carbs"),
    fat: sumOf(day.meals, "fat"),
    hasMacros: day.meals.some(m => m.protein != null || m.carbs != null || m.fat != null),
    logged: day.meals.length + day.workouts.length > 0,
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---- Weight helpers (stored in kg, shown in the chosen unit) ----
function toUnit(kg) {
  return data.unit === "lb" ? kg * LB_PER_KG : kg;
}

function fromUnit(value) {
  return data.unit === "lb" ? value / LB_PER_KG : value;
}

function formatWeight(kg) {
  return `${round1(toUnit(kg))} ${data.unit}`;
}

// Most recent weight on or before a date (falls back to the latest ever)
function weightOn(key) {
  const keys = Object.keys(data.weights).sort();
  if (!keys.length) return null;
  const before = keys.filter(k => k <= key);
  return data.weights[before.length ? before[before.length - 1] : keys[keys.length - 1]];
}

// ---- Toast ----
const toastEl = document.getElementById("toast");
let toastTimer;
function toast(message, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = escapeHtml(message);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => { action.run(); toastEl.hidden = true; });
    toastEl.appendChild(btn);
  }
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 6000 : 3000);
}

// ---- Streaks ----
// Consecutive days meeting a condition, ending today (or yesterday if today isn't done yet)
function streak(test) {
  let d = new Date();
  if (!test(toKey(d))) d = addDays(d, -1);
  let n = 0;
  while (test(toKey(d)) && n < 3650) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// ---- Rendering ----
function render() {
  renderSummary();
  renderWeek();
  renderDay();
  renderWaterWeight();
  renderQuick();
  if (typeof renderProgress === "function" && currentTab === "progress") renderProgress();
}

function renderSummary() {
  const keys = DAY_NAMES.map((_, i) => toKey(addDays(weekStart, i)));
  const sum = keys.map(dayTotals).reduce(
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

  const goal = data.workoutGoal;
  document.getElementById("workoutGoalLabel").textContent = goal ? ` / ${goal}` : "";
  const pct = goal ? Math.min(100, (sum.workouts / goal) * 100) : 0;
  const bar = document.getElementById("workoutGoalBar");
  bar.style.width = `${pct}%`;
  bar.classList.toggle("done", goal > 0 && sum.workouts >= goal);
  bar.parentElement.setAttribute("aria-valuenow", sum.workouts);
  bar.parentElement.setAttribute("aria-valuemax", goal);

  const workoutStreak = streak(k => peekDay(k).workouts.length > 0);
  const logStreak = streak(k => peekDay(k).meals.length > 0);
  document.getElementById("streakValue").textContent = `🔥 ${workoutStreak}`;
  document.getElementById("streakNote").textContent =
    `day${workoutStreak === 1 ? "" : "s"} working out · ${logStreak} day${logStreak === 1 ? "" : "s"} logging meals`;
}

function renderWeek() {
  const weekEnd = addDays(weekStart, 6);
  document.getElementById("weekLabel").textContent =
    `${formatShort(weekStart)} – ${formatShort(weekEnd)}`;

  const keys = DAY_NAMES.map((_, i) => toKey(addDays(weekStart, i)));
  const totals = keys.map(dayTotals);

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
      cancelEdit();
      render();
    });
    grid.appendChild(btn);
  });
}

function macroText(m) {
  const parts = [];
  if (m.protein != null) parts.push(`P ${round1(m.protein)}g`);
  if (m.carbs != null) parts.push(`C ${round1(m.carbs)}g`);
  if (m.fat != null) parts.push(`F ${round1(m.fat)}g`);
  return parts.join(" · ");
}

function renderDay() {
  const date = fromKey(selectedDate);
  const label = date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  document.querySelectorAll(".day-name").forEach(el => (el.textContent = label));

  const day = peekDay(selectedDate);
  const isEditing = (list, i) => editing && editing.list === list && editing.index === i;

  document.getElementById("workoutList").innerHTML = day.workouts.length
    ? day.workouts.map((w, i) => `
        <li class="${isEditing("workouts", i) ? "editing" : ""}">
          <button type="button" class="info edit-target" data-list="workouts" data-index="${i}" aria-label="Edit ${escapeHtml(w.name)}">
            <span class="title">${escapeHtml(w.name)}</span>
            <span class="meta">${escapeHtml(w.type)} · ${w.minutes} min</span>
          </button>
          <span class="kcal">−${w.calories} kcal</span>
          <button class="delete-btn" data-list="workouts" data-index="${i}" aria-label="Delete">&times;</button>
        </li>`).join("")
    : `<li class="empty-msg">No workouts logged.</li>`;

  document.getElementById("mealList").innerHTML = day.meals.length
    ? day.meals.map((m, i) => {
        const macros = macroText(m);
        return `
        <li class="${isEditing("meals", i) ? "editing" : ""}">
          <button type="button" class="info edit-target" data-list="meals" data-index="${i}" aria-label="Edit ${escapeHtml(m.name)}">
            <span class="title">${escapeHtml(m.name)}</span>
            <span class="meta">${escapeHtml(m.meal)}${macros ? ` · ${macros}` : ""}</span>
          </button>
          <span class="kcal">${m.calories} kcal</span>
          <button class="delete-btn" data-list="meals" data-index="${i}" aria-label="Delete">&times;</button>
        </li>`;
      }).join("")
    : `<li class="empty-msg">No meals logged.</li>`;

  const t = dayTotals(selectedDate);
  const net = t.eaten - t.burned;
  const diff = net - data.goal;
  const status = diff > 0
    ? `<span class="over">${diff} over goal</span>`
    : `<span class="under">${-diff} under goal</span>`;
  const macros = t.hasMacros
    ? `<div class="macro-total">Protein ${round1(t.protein)}g · Carbs ${round1(t.carbs)}g · Fat ${round1(t.fat)}g</div>`
    : "";
  document.getElementById("dayTotal").innerHTML =
    `Eaten ${t.eaten} − burned ${t.burned} = net ${net} kcal · ${status}${macros}`;
}

function renderWaterWeight() {
  const water = peekDay(selectedDate).water || 0;
  const goal = data.waterGoal;
  const shown = Math.max(goal, water);
  document.getElementById("glasses").innerHTML = Array.from({ length: shown }, (_, i) =>
    `<span class="glass ${i < water ? "full" : ""}" aria-hidden="true"></span>`).join("");
  document.getElementById("waterLabel").textContent =
    `${water} of ${goal} glasses${water >= goal ? " · goal reached 🎉" : ""}`;

  const unitLabel = document.getElementById("weightUnitLabel");
  unitLabel.textContent = data.unit;
  const input = document.getElementById("weightInput");
  const todays = data.weights[selectedDate];
  if (document.activeElement !== input) input.value = todays != null ? round1(toUnit(todays)) : "";
  document.getElementById("weightClear").hidden = todays == null;

  const note = document.getElementById("weightNote");
  const latest = weightOn(selectedDate);
  if (latest == null) {
    note.textContent = "Log your weight to track progress and get better calorie-burn estimates.";
    return;
  }
  const weekAgo = Object.keys(data.weights).sort().filter(k => k <= toKey(addDays(fromKey(selectedDate), -7))).pop();
  let change = "";
  if (weekAgo) {
    const delta = round1(toUnit(latest) - toUnit(data.weights[weekAgo]));
    change = ` · ${delta > 0 ? "+" : ""}${delta} ${data.unit} vs a week before`;
  }
  note.textContent = todays != null
    ? `Saved for this day${change}`
    : `Latest: ${formatWeight(latest)}${change}`;
}

// ---- Quick add: your most-used entries, one tap to add again ----
function frequentEntries(list, keyOf) {
  const seen = new Map();
  Object.keys(data.days).sort().forEach(date => {
    peekDay(date)[list].forEach(entry => {
      const k = keyOf(entry);
      const prev = seen.get(k);
      seen.set(k, { entry, count: (prev ? prev.count : 0) + 1, last: date });
    });
  });
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1))
    .slice(0, 6)
    .map(x => x.entry);
}

function renderQuick() {
  // One chip per food/exercise, using the most recent values you logged for it
  const workouts = frequentEntries("workouts", w => w.name.trim().toLowerCase());
  const meals = frequentEntries("meals", m => m.name.trim().toLowerCase());
  const chips = (list, items, text) => items.length
    ? `<span class="quick-label">Quick add</span>` + items.map((item, i) =>
        `<button type="button" class="chip" data-quick="${list}" data-index="${i}">+ ${escapeHtml(text(item))}</button>`).join("")
    : "";
  const qw = document.getElementById("quickWorkouts");
  const qm = document.getElementById("quickMeals");
  qw.innerHTML = chips("workouts", workouts, w => `${w.name} ${w.minutes}m`);
  qm.innerHTML = chips("meals", meals, m => `${m.name} ${m.calories}`);
  qw._items = workouts;
  qm._items = meals;
}

document.querySelectorAll(".quick").forEach(box => {
  box.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const entry = Object.assign({}, box._items[Number(chip.dataset.index)]);
    if (chip.dataset.quick === "meals") entry.meal = document.getElementById("mealForm").meal.value || entry.meal;
    const list = getDay(selectedDate)[chip.dataset.quick];
    list.push(entry);
    save();
    render();
    toast(`Added ${entry.name}`, {
      label: "Undo",
      run: () => { list.splice(list.indexOf(entry), 1); save(); render(); },
    });
  });
});

// ---- Copy previous day ----
document.querySelectorAll("[data-copy]").forEach(btn => {
  btn.addEventListener("click", () => {
    const list = btn.dataset.copy;
    const prevKey = toKey(addDays(fromKey(selectedDate), -1));
    const items = peekDay(prevKey)[list];
    const what = list === "meals" ? "meals" : "workouts";
    if (!items.length) {
      toast(`No ${what} logged on ${formatShort(fromKey(prevKey))}.`);
      return;
    }
    const target = getDay(selectedDate)[list];
    const copies = items.map(x => Object.assign({}, x));
    target.push(...copies);
    save();
    render();
    toast(`Copied ${copies.length} ${what} from ${formatShort(fromKey(prevKey))}`, {
      label: "Undo",
      run: () => { copies.forEach(c => target.splice(target.indexOf(c), 1)); save(); render(); },
    });
  });
});

// ---- Calories-burned estimate (MET × kg × hours) ----
const METS = [
  ["Running", 9.8], ["Jogging", 7], ["Walking", 3.5], ["Brisk walking", 4.3], ["Hiking", 6],
  ["Cycling", 7.5], ["Stationary bike", 6.8], ["Swimming", 7], ["Rowing", 7], ["Elliptical", 5],
  ["Stair climbing", 8.8], ["Jump rope", 11], ["HIIT", 8], ["CrossFit", 8], ["Boxing", 7.8],
  ["Weight lifting", 5], ["Bodyweight training", 4], ["Yoga", 2.5], ["Pilates", 3],
  ["Stretching", 2.3], ["Dancing", 5.5], ["Basketball", 6.5], ["Football", 7], ["Soccer", 7],
  ["Tennis", 7.3], ["Padel", 6], ["Volleyball", 4], ["Climbing", 8], ["Martial arts", 10],
];
const TYPE_METS = { Cardio: 7, Strength: 5, Flexibility: 2.5, Sports: 6.5, Other: 4 };
const TYPE_OF = {
  "Weight lifting": "Strength", "Bodyweight training": "Strength", "CrossFit": "Strength",
  "Yoga": "Flexibility", "Pilates": "Flexibility", "Stretching": "Flexibility",
  "Basketball": "Sports", "Football": "Sports", "Soccer": "Sports", "Tennis": "Sports",
  "Padel": "Sports", "Volleyball": "Sports", "Martial arts": "Sports", "Climbing": "Sports",
};

document.getElementById("exerciseList").innerHTML =
  METS.map(([name]) => `<option value="${name}">`).join("");

const workoutForm = document.getElementById("workoutForm");
const burnHint = document.getElementById("burnHint");

function estimateBurn() {
  const f = workoutForm;
  const minutes = Number(f.minutes.value);
  const name = f.name.value.trim().toLowerCase();
  if (!minutes || f.calories.dataset.manual === "1") {
    if (!minutes) burnHint.textContent = "";
    return;
  }
  const match = METS.find(([n]) => name && (name === n.toLowerCase() || name.includes(n.toLowerCase())));
  const met = match ? match[1] : TYPE_METS[f.type.value];
  const logged = weightOn(selectedDate);
  const kg = logged || 70;
  f.calories.value = Math.round((met * kg * minutes) / 60 / 5) * 5;
  burnHint.textContent = `≈ Estimated from ${match ? match[0].toLowerCase() : f.type.value.toLowerCase()} and ` +
    (logged ? `your weight (${formatWeight(logged)}).` : "an average 70 kg body weight — log your weight for a better estimate.") +
    " Change it if your watch says otherwise.";
}

workoutForm.name.addEventListener("input", () => {
  const match = METS.find(([n]) => n.toLowerCase() === workoutForm.name.value.trim().toLowerCase());
  if (match) workoutForm.type.value = TYPE_OF[match[0]] || "Cardio";
  estimateBurn();
});
workoutForm.type.addEventListener("change", estimateBurn);
workoutForm.minutes.addEventListener("input", estimateBurn);
workoutForm.calories.addEventListener("input", () => {
  workoutForm.calories.dataset.manual = workoutForm.calories.value ? "1" : "";
  if (workoutForm.calories.dataset.manual) burnHint.textContent = "";
});

// ---- Add / edit entries ----
const mealForm = document.getElementById("mealForm");
const numOrNull = v => (v === "" || v == null ? null : Math.max(0, Number(v)) || 0);

function resetForm(f) {
  f.reset();
  delete f.calories.dataset.manual;
  f.querySelector(".primary-btn").textContent = "Add";
  f.querySelector(".cancel-edit").hidden = true;
  if (f === workoutForm) burnHint.textContent = "";
}

function cancelEdit() {
  if (!editing) return;
  resetForm(editing.list === "workouts" ? workoutForm : mealForm);
  editing = null;
}

function startEdit(list, index) {
  cancelEdit();
  const entry = peekDay(selectedDate)[list][index];
  if (!entry) return;
  editing = { list, index };
  const f = list === "workouts" ? workoutForm : mealForm;
  f.name.value = entry.name;
  f.calories.value = entry.calories;
  f.calories.dataset.manual = "1";
  if (list === "workouts") {
    f.type.value = entry.type;
    f.minutes.value = entry.minutes;
  } else {
    f.meal.value = entry.meal;
    f.protein.value = entry.protein ?? "";
    f.carbs.value = entry.carbs ?? "";
    f.fat.value = entry.fat ?? "";
  }
  f.querySelector(".primary-btn").textContent = "Save";
  f.querySelector(".cancel-edit").hidden = false;
  renderDay();
  f.scrollIntoView({ behavior: "smooth", block: "center" });
  f.name.focus({ preventScroll: true });
}

function submitEntry(list, entry, f) {
  const items = getDay(selectedDate)[list];
  if (editing && editing.list === list) {
    items[editing.index] = entry;
    editing = null;
  } else {
    items.push(entry);
  }
  save();
  resetForm(f);
  render();
}

workoutForm.addEventListener("submit", e => {
  e.preventDefault();
  const f = workoutForm;
  submitEntry("workouts", {
    name: f.name.value.trim(),
    type: f.type.value,
    minutes: Number(f.minutes.value) || 0,
    calories: Number(f.calories.value) || 0,
  }, f);
});

mealForm.addEventListener("submit", e => {
  e.preventDefault();
  const f = mealForm;
  const entry = {
    name: f.name.value.trim(),
    meal: f.meal.value,
    calories: Number(f.calories.value) || 0,
  };
  ["protein", "carbs", "fat"].forEach(k => {
    const v = numOrNull(f[k].value);
    if (v != null) entry[k] = v;
  });
  submitEntry("meals", entry, f);
});

document.querySelectorAll(".cancel-edit").forEach(btn =>
  btn.addEventListener("click", () => { cancelEdit(); renderDay(); }));

document.querySelector(".day-panels").addEventListener("click", e => {
  const del = e.target.closest(".delete-btn");
  if (del) {
    const list = getDay(selectedDate)[del.dataset.list];
    const index = Number(del.dataset.index);
    const [removed] = list.splice(index, 1);
    if (editing && editing.list === del.dataset.list) cancelEdit();
    save();
    render();
    toast(`Deleted ${removed.name}`, {
      label: "Undo",
      run: () => { list.splice(index, 0, removed); save(); render(); },
    });
    return;
  }
  const target = e.target.closest(".edit-target");
  if (target) startEdit(target.dataset.list, Number(target.dataset.index));
});

// ---- Water ----
function changeWater(delta) {
  const day = getDay(selectedDate);
  day.water = Math.max(0, (day.water || 0) + delta);
  save();
  renderWaterWeight();
}
document.getElementById("waterPlus").addEventListener("click", () => changeWater(1));
document.getElementById("waterMinus").addEventListener("click", () => changeWater(-1));

// ---- Weight ----
document.getElementById("weightForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("weightInput");
  const value = Number(input.value);
  if (!value) return;
  data.weights[selectedDate] = Math.round(fromUnit(value) * 100) / 100;
  save();
  input.blur();
  render();
  toast(`Weight saved: ${formatWeight(data.weights[selectedDate])}`);
});
document.getElementById("weightClear").addEventListener("click", () => {
  delete data.weights[selectedDate];
  save();
  render();
});

// ---- Week navigation ----
function shiftWeek(n) {
  const selectedOffset = Math.round((fromKey(selectedDate) - weekStart) / 86400000);
  weekStart = addDays(weekStart, n * 7);
  selectedDate = toKey(addDays(weekStart, Math.min(Math.max(selectedOffset, 0), 6)));
  cancelEdit();
  render();
}

document.getElementById("prevWeek").addEventListener("click", () => shiftWeek(-1));
document.getElementById("nextWeek").addEventListener("click", () => shiftWeek(1));
document.getElementById("thisWeek").addEventListener("click", () => {
  weekStart = getMonday(new Date());
  selectedDate = toKey(new Date());
  cancelEdit();
  render();
});

// ---- Tabs ----
let currentTab = "today";
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(el => (el.hidden = el.id !== `tab-${tab}`));
  document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("[data-only-tab]").forEach(el => (el.hidden = el.dataset.onlyTab !== tab));
  try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* ignore */ }
  if (tab === "progress" && typeof renderProgress === "function") renderProgress();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabbar button").forEach(b =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));

// ---- Settings ----
const SETTING_FIELDS = { goalInput: "goal", workoutGoalInput: "workoutGoal", waterGoalInput: "waterGoal", unitSelect: "unit" };

function showSettings() {
  Object.entries(SETTING_FIELDS).forEach(([id, field]) => (document.getElementById(id).value = data[field]));
}

function bindSetting(id, field, parse) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => {
    const v = parse(el.value);
    if (v == null) { el.value = data[field]; return; }
    data[field] = v;
    el.value = v;
    save();
    render();
  });
}
const intIn = (min, max) => v => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== "" ? Math.min(max, Math.max(min, n)) : null;
};
bindSetting("goalInput", "goal", intIn(0, 20000));
bindSetting("workoutGoalInput", "workoutGoal", intIn(0, 14));
bindSetting("waterGoalInput", "waterGoal", intIn(1, 30));
bindSetting("unitSelect", "unit", v => (v === "lb" ? "lb" : "kg"));
showSettings();

// ---- Daily reminder: a repeating Calendar event with an alert ----
function saveFile(name, type, text) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file] }).catch(err => {
      if (err && err.name === "AbortError") return;
      download(file);
    });
  }
  download(file);
  return Promise.resolve();
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

document.getElementById("reminderBtn").addEventListener("click", () => {
  const [h, m] = (document.getElementById("reminderTime").value || "20:00").split(":");
  const start = toKey(new Date()).replace(/-/g, "") + `T${h}${m}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const appUrl = location.href.split("#")[0];
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Weekly Fitness Tracker//EN",
    "BEGIN:VEVENT",
    `UID:fitness-reminder-${Date.now()}@fitness-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    "DURATION:PT5M",
    "RRULE:FREQ=DAILY",
    "SUMMARY:Log your meals & workouts",
    `URL:${appUrl}`,
    `DESCRIPTION:Open the Fitness app: ${appUrl}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Log your meals & workouts",
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  saveFile("fitness-reminder.ics", "text/calendar", ics);
});

// ---- Backup ----
const backupStatus = document.getElementById("backupStatus");

document.getElementById("exportBtn").addEventListener("click", () => {
  const backup = { app: "weekly-fitness-tracker", version: 2, exportedAt: new Date().toISOString(), data };
  const name = `fitness-backup-${toKey(new Date())}.json`;
  saveFile(name, "application/json", JSON.stringify(backup, null, 2)).then(() => {
    backupStatus.textContent = `Backup created: ${name}`;
  });
});

document.getElementById("importInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed && parsed.data ? parsed.data : parsed;
    if (!incoming || typeof incoming.days !== "object") throw new Error("not a backup");
    const days = Object.keys(incoming.days).length;
    const when = parsed.exportedAt ? ` from ${new Date(parsed.exportedAt).toLocaleDateString()}` : "";
    if (!confirm(`Restore backup${when} with ${days} logged day${days === 1 ? "" : "s"}? This replaces the data currently in the app.`)) return;
    data = normalize(incoming);
    save();
    showSettings();
    render();
    backupStatus.textContent = `Restored ${days} day${days === 1 ? "" : "s"} of data.`;
  } catch (err) {
    backupStatus.textContent = "That file isn't a Fitness Tracker backup.";
  }
});

// ---- Theme: Auto (follow phone) → Light → Dark ----
const THEMES = { auto: "◐ Auto", light: "☀️ Light", dark: "🌙 Dark" };
const themeBtn = document.getElementById("themeBtn");
const themeColor = document.querySelector('meta[name="theme-color"]');

function applyTheme(theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  themeBtn.textContent = THEMES[theme];
  themeBtn.setAttribute("aria-label", `Theme: ${theme}. Tap to change.`);
  themeColor.content = getComputedStyle(document.body).backgroundColor;
  if (currentTab === "progress" && typeof renderProgress === "function") renderProgress();
}

let theme = "auto";
try { theme = localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { /* ignore */ }
if (!THEMES[theme]) theme = "auto";

themeBtn.addEventListener("click", () => {
  const order = Object.keys(THEMES);
  theme = order[(order.indexOf(theme) + 1) % order.length];
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  applyTheme(theme);
});

// Keep the browser bar colour right when the phone switches in Auto mode
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(theme));

// ---- Start ----
// The photo calorie estimate feature was removed; delete any API key it saved
try { localStorage.removeItem("fitnessTracker.apiKey"); } catch (e) { /* ignore */ }
applyTheme(theme);
render();
let savedTab = "today";
try { savedTab = localStorage.getItem(TAB_KEY) || "today"; } catch (e) { /* ignore */ }
// progress.js loads after this file, so open a saved Progress tab once everything is ready
window.addEventListener("DOMContentLoaded", () => showTab(["today", "progress", "settings"].includes(savedTab) ? savedTab : "today"));

// Offline support / installable app
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
