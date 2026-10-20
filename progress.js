// Progress tab: weekly trends for calories, workout minutes and weight.
// Relies on the data and helpers defined in script.js.
const RANGE_KEY = "fitnessTracker.range";
const SVG_NS = "http://www.w3.org/2000/svg";

let rangeWeeks = 12;
try { rangeWeeks = Number(localStorage.getItem(RANGE_KEY)) || 12; } catch (e) { /* ignore */ }

function weekSummaries(n) {
  const thisMonday = getMonday(new Date());
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(thisMonday, -7 * i);
    const w = { start, label: formatShort(start), eaten: 0, burned: 0, logged: 0, minutes: 0, workouts: 0, weight: null };
    for (let d = 0; d < 7; d++) {
      const key = toKey(addDays(start, d));
      const t = dayTotals(key);
      w.eaten += t.eaten;
      w.burned += t.burned;
      w.minutes += t.minutes;
      w.workouts += t.workouts;
      if (t.logged) w.logged++;
      if (data.weights[key] != null) w.weight = data.weights[key];
    }
    w.avgEaten = w.logged ? Math.round(w.eaten / w.logged) : null;
    w.avgBurned = w.logged ? Math.round(w.burned / w.logged) : null;
    weeks.push(w);
  }
  return weeks;
}

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (parent) parent.appendChild(el);
  return el;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [1, 2, 2.5, 5, 10].find(s => s * mag >= v);
  return step * mag;
}

// Bar with rounded top corners, anchored flat on the baseline
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function emptyChart(container, text) {
  container.innerHTML = `<p class="chart-empty">${escapeHtml(text)}</p>`;
}

function makeTooltip(container) {
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  container.appendChild(tip);
  return (html, x) => {
    if (html == null) { tip.hidden = true; return; }
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, x - w / 2), container.clientWidth - w)}px`;
  };
}

function yAxis(svg, max, top, bottom, left, right, format) {
  [0, 0.5, 1].forEach(f => {
    const y = bottom - (bottom - top) * f;
    svgEl("line", { x1: left, x2: right, y1: y, y2: y, class: f === 0 ? "axis-base" : "grid" }, svg);
    svgEl("text", { x: left - 6, y: y + 4, class: "axis-label", "text-anchor": "end" }, svg).textContent = format(max * f);
  });
}

const compact = v => (v >= 1000 ? `${round1(v / 1000)}k` : String(Math.round(v)));

function barChart(container, { labels, series, goal, tipFor }) {
  container.innerHTML = "";
  const W = container.clientWidth || 320;
  const H = 190;
  const pad = { l: 38, r: 8, t: 12, b: 24 };
  const plotW = W - pad.l - pad.r;
  const bottom = H - pad.b;
  const values = series.flatMap(s => s.values.filter(v => v != null));
  const max = niceMax(Math.max(goal || 0, ...values, 1));
  const y = v => bottom - ((bottom - pad.t) * v) / max;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" }, container);
  yAxis(svg, max, pad.t, bottom, pad.l, W - pad.r, compact);

  const n = labels.length;
  const gw = plotW / n;
  const gap = 2;
  const bw = Math.max(2, Math.min(16, (gw * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = bw * series.length + gap * (series.length - 1);
  const band = svgEl("rect", { y: pad.t, height: bottom - pad.t, width: gw, class: "hover-band", visibility: "hidden" }, svg);

  labels.forEach((label, i) => {
    const x0 = pad.l + gw * i + (gw - groupW) / 2;
    series.forEach((s, j) => {
      const v = s.values[i];
      if (!v) return;
      svgEl("path", { d: barPath(x0 + j * (bw + gap), y(v), bw, bottom - y(v)), class: s.cls }, svg);
    });
  });

  // Label every few weeks so the dates never collide
  const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 46)));
  labels.forEach((label, i) => {
    if ((n - 1 - i) % every) return;
    svgEl("text", { x: pad.l + gw * (i + 0.5), y: H - 6, class: "axis-label", "text-anchor": "middle" }, svg).textContent = label;
  });

  if (goal) {
    svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal), class: "goal-rule" }, svg);
  }

  const showTip = makeTooltip(container);
  const pick = e => {
    const rect = svg.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - pad.l) / gw);
    if (i < 0 || i >= n) { band.setAttribute("visibility", "hidden"); showTip(null); return; }
    band.setAttribute("x", pad.l + gw * i);
    band.setAttribute("visibility", "visible");
    showTip(tipFor(i), pad.l + gw * (i + 0.5));
  };
  svg.addEventListener("pointermove", pick);
  svg.addEventListener("pointerdown", pick);
  svg.addEventListener("pointerleave", () => { band.setAttribute("visibility", "hidden"); showTip(null); });
}

function weightChart(container, start) {
  const startKey = toKey(start);
  const points = Object.keys(data.weights).sort()
    .filter(k => k >= startKey)
    .map(k => ({ key: k, date: fromKey(k), value: toUnit(data.weights[k]) }));
  if (!points.length) {
    emptyChart(container, "Log your weight on the Today tab to see your trend here.");
    return;
  }
  container.innerHTML = "";
  const W = container.clientWidth || 320;
  const H = 190;
  const pad = { l: 38, r: 12, t: 12, b: 24 };
  const bottom = H - pad.b;
  const t0 = start.getTime();
  const t1 = Math.max(Date.now(), t0 + 86400000);
  const x = d => pad.l + ((W - pad.l - pad.r) * (d.getTime() - t0)) / (t1 - t0);
  const vals = points.map(p => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const spread = Math.max(hi - lo, 2);
  lo = Math.floor(lo - spread * 0.25);
  hi = Math.ceil(hi + spread * 0.25);
  const y = v => bottom - ((bottom - pad.t) * (v - lo)) / (hi - lo);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" }, container);
  [0, 0.5, 1].forEach(f => {
    const v = lo + (hi - lo) * f;
    svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: f === 0 ? "axis-base" : "grid" }, svg);
    svgEl("text", { x: pad.l - 6, y: y(v) + 4, class: "axis-label", "text-anchor": "end" }, svg).textContent = round1(v);
  });
  [start, new Date(t1)].forEach((d, i) => {
    svgEl("text", { x: x(d), y: H - 6, class: "axis-label", "text-anchor": i ? "end" : "start" }, svg).textContent = formatShort(d);
  });

  if (points.length > 1) {
    svgEl("path", { d: points.map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.value)}`).join(""), class: "weight-line" }, svg);
  }
  const cross = svgEl("line", { y1: pad.t, y2: bottom, class: "crosshair", visibility: "hidden" }, svg);
  const dots = points.map(p => svgEl("circle", { cx: x(p.date), cy: y(p.value), r: 4, class: "weight-dot" }, svg));

  const showTip = makeTooltip(container);
  const pick = e => {
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i; });
    const p = points[best];
    cross.setAttribute("x1", x(p.date));
    cross.setAttribute("x2", x(p.date));
    cross.setAttribute("visibility", "visible");
    dots.forEach((d, i) => d.setAttribute("r", i === best ? 6 : 4));
    showTip(`<strong>${round1(p.value)} ${data.unit}</strong><span>${formatShort(p.date)}</span>`, x(p.date));
  };
  svg.addEventListener("pointermove", pick);
  svg.addEventListener("pointerdown", pick);
  svg.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dots.forEach(d => d.setAttribute("r", 4));
    showTip(null);
  });
}

function renderStats(weeks, start) {
  const logged = weeks.reduce((s, w) => s + w.logged, 0);
  const eaten = weeks.reduce((s, w) => s + w.eaten, 0);
  const workouts = weeks.reduce((s, w) => s + w.workouts, 0);
  const minutes = weeks.reduce((s, w) => s + w.minutes, 0);

  let protein = 0;
  let proteinDays = 0;
  for (let d = new Date(start); d <= new Date(); d = addDays(d, 1)) {
    const t = dayTotals(toKey(d));
    if (t.hasMacros) { protein += t.protein; proteinDays++; }
  }

  const startKey = toKey(start);
  const wKeys = Object.keys(data.weights).sort().filter(k => k >= startKey);
  let weightChange = "–";
  if (wKeys.length > 1) {
    const delta = round1(toUnit(data.weights[wKeys[wKeys.length - 1]]) - toUnit(data.weights[wKeys[0]]));
    weightChange = `${delta > 0 ? "+" : ""}${delta} ${data.unit}`;
  }

  const tile = (label, value, note) => `
    <div class="stat">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
      ${note ? `<span class="meta">${note}</span>` : ""}
    </div>`;
  document.getElementById("progressStats").innerHTML =
    tile("Avg calories / day", logged ? Math.round(eaten / logged).toLocaleString() : "–", `goal ${data.goal.toLocaleString()}`) +
    tile("Workouts", workouts, `${round1(workouts / weeks.length)} per week`) +
    tile("Workout time", `${round1(minutes / 60)} h`, `${Math.round(minutes / weeks.length)} min per week`) +
    tile("Weight change", weightChange, wKeys.length ? `${wKeys.length} weigh-in${wKeys.length === 1 ? "" : "s"}` : "no weigh-ins") +
    tile("Avg protein / day", proteinDays ? `${Math.round(protein / proteinDays)} g` : "–", proteinDays ? `${proteinDays} day${proteinDays === 1 ? "" : "s"} with macros` : "add protein to meals");
}

function renderTable(weeks) {
  const cell = v => (v == null ? "–" : v.toLocaleString());
  document.getElementById("progressTable").innerHTML = `
    <table>
      <thead><tr><th>Week of</th><th>Avg eaten</th><th>Avg burned</th><th>Workout min</th><th>Workouts</th><th>Weight</th></tr></thead>
      <tbody>${weeks.slice().reverse().map(w => `
        <tr><td>${w.label}</td><td>${cell(w.avgEaten)}</td><td>${cell(w.avgBurned)}</td>
        <td>${w.minutes.toLocaleString()}</td><td>${w.workouts}</td>
        <td>${w.weight == null ? "–" : `${round1(toUnit(w.weight))} ${data.unit}`}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function renderProgress() {
  document.querySelectorAll(".range-btn").forEach(b =>
    b.classList.toggle("active", Number(b.dataset.weeks) === rangeWeeks));
  const weeks = weekSummaries(rangeWeeks);
  const start = weeks[0].start;
  renderStats(weeks, start);

  const labels = weeks.map(w => w.label);
  const calChart = document.getElementById("calChart");
  if (weeks.some(w => w.logged)) {
    barChart(calChart, {
      labels,
      goal: data.goal,
      series: [
        { cls: "c-eaten", values: weeks.map(w => w.avgEaten) },
        { cls: "c-burned", values: weeks.map(w => w.avgBurned) },
      ],
      tipFor: i => {
        const w = weeks[i];
        return w.logged
          ? `<strong>Week of ${w.label}</strong><span><i class="swatch eaten"></i>Eaten ${w.avgEaten.toLocaleString()} kcal/day</span>` +
            `<span><i class="swatch burned"></i>Burned ${w.avgBurned.toLocaleString()} kcal/day</span><span>${w.logged} day${w.logged === 1 ? "" : "s"} logged</span>`
          : `<strong>Week of ${w.label}</strong><span>Nothing logged</span>`;
      },
    });
  } else {
    emptyChart(calChart, "No meals or workouts logged in this period yet.");
  }

  const minChart = document.getElementById("minChart");
  if (weeks.some(w => w.minutes)) {
    barChart(minChart, {
      labels,
      series: [{ cls: "c-minutes", values: weeks.map(w => w.minutes) }],
      tipFor: i => `<strong>Week of ${weeks[i].label}</strong><span>${weeks[i].minutes} min · ${weeks[i].workouts} workout${weeks[i].workouts === 1 ? "" : "s"}</span>`,
    });
  } else {
    emptyChart(minChart, "No workouts logged in this period yet.");
  }

  weightChart(document.getElementById("weightChart"), start);
  renderTable(weeks);
}

document.querySelectorAll(".range-btn").forEach(b => b.addEventListener("click", () => {
  rangeWeeks = Number(b.dataset.weeks);
  try { localStorage.setItem(RANGE_KEY, rangeWeeks); } catch (e) { /* ignore */ }
  renderProgress();
}));

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (currentTab === "progress") renderProgress(); }, 150);
});
