// Barcode scanner: scan a packaged food, look it up in Open Food Facts (free)
// and pre-fill the meal form with the calories for the amount eaten.
const PONYFILL_URL = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/es/ponyfill.js";
const LOOKUP_URL = "https://world.openfoodfacts.org/api/v2/product/";
const FIELDS = "product_name,brands,nutriments,serving_size,serving_quantity,product_quantity,product_quantity_unit";
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

const form = document.getElementById("mealForm");
const dialog = document.getElementById("barcodeDialog");
const video = document.getElementById("barcodeVideo");
const scanArea = document.getElementById("scanArea");
const statusEl = document.getElementById("barcodeStatus");
const productEl = document.getElementById("barcodeProduct");
const manualForm = document.getElementById("barcodeManual");
const barcodePhoto = document.getElementById("barcodePhoto");

let detectorPromise = null;
let stream = null;
let scanTimer = null;
let product = null; // { name, kcalPer100, serving, packageSize, unit }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("photo-error", isError);
}

// Use the browser's built-in detector when it has one (Android Chrome),
// otherwise load the WebAssembly version (iPhone Safari)
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          if (FORMATS.every(f => supported.includes(f))) {
            return new window.BarcodeDetector({ formats: FORMATS });
          }
        } catch (e) { /* fall through to the ponyfill */ }
      }
      const { BarcodeDetector } = await import(PONYFILL_URL);
      return new BarcodeDetector({ formats: FORMATS });
    })();
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

async function startCamera() {
  scanArea.hidden = false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    scanArea.hidden = true;
    setStatus("Live camera isn't available here. Take a photo of the barcode or type its number.");
    return;
  }
  setStatus("Starting camera…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (!dialog.open) return stopCamera(); // closed while waiting for permission
    video.srcObject = stream;
    await video.play();
    const detector = await getDetector();
    setStatus("Point the camera at the barcode.");
    scanLoop(detector);
  } catch (err) {
    stopCamera();
    scanArea.hidden = true;
    setStatus(
      err && err.name === "NotAllowedError"
        ? "Camera access was blocked. Take a photo of the barcode or type its number instead."
        : "Couldn't start the camera. Take a photo of the barcode or type its number instead.",
      true
    );
  }
}

function scanLoop(detector) {
  scanTimer = setTimeout(async () => {
    if (!stream) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        if (codes.length && stream) {
          if (navigator.vibrate) navigator.vibrate(80);
          stopCamera();
          scanArea.hidden = true;
          lookup(codes[0].rawValue);
          return;
        }
      }
    } catch (e) { /* keep trying on the next frame */ }
    scanLoop(detector);
  }, 250);
}

function stopCamera() {
  clearTimeout(scanTimer);
  scanTimer = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

async function lookup(code) {
  code = String(code).replace(/\D/g, "");
  if (!code) return;
  product = null;
  productEl.hidden = true;
  setStatus(`Looking up ${code}…`);
  try {
    const res = await fetch(`${LOOKUP_URL}${code}.json?fields=${FIELDS}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 1 || !data.product) {
      setStatus(`Barcode ${code} isn't in the Open Food Facts database. Enter the calories by hand.`, true);
      return;
    }
    const p = data.product;
    const n = p.nutriments || {};
    let kcalPer100 = n["energy-kcal_100g"];
    if (kcalPer100 == null && n.energy_100g != null) kcalPer100 = n.energy_100g / 4.184; // kJ → kcal
    const name = [p.brands && p.brands.split(",")[0].trim(), p.product_name].filter(Boolean).join(" ") || `Product ${code}`;
    if (kcalPer100 == null) {
      setStatus(`Found “${name}”, but it has no calorie information. Enter the calories by hand.`, true);
      return;
    }
    const per100 = k => (n[k] == null || n[k] === "" ? null : Number(n[k]));
    product = {
      name,
      kcalPer100: Number(kcalPer100),
      proteinPer100: per100("proteins_100g"),
      carbsPer100: per100("carbohydrates_100g"),
      fatPer100: per100("fat_100g"),
      serving: Number(p.serving_quantity) || null,
      servingLabel: p.serving_size || "",
      packageSize: Number(p.product_quantity) || null,
      unit: /ml|l/i.test(p.product_quantity_unit || p.serving_size || "") ? "ml" : "g",
    };
    setStatus("");
    showProduct();
  } catch (err) {
    setStatus(navigator.onLine
      ? "Couldn't reach the food database. Please try again."
      : "You're offline. Barcode lookups need an internet connection.", true);
  }
}

function macroLine(p) {
  const parts = [["P", p.proteinPer100], ["C", p.carbsPer100], ["F", p.fatPer100]]
    .filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}g`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function showProduct() {
  const p = product;
  const presets = [];
  if (p.serving) presets.push([`1 serving (${p.serving} ${p.unit})`, p.serving]);
  presets.push([`100 ${p.unit}`, 100]);
  if (p.packageSize && p.packageSize !== 100) presets.push([`Whole pack (${p.packageSize} ${p.unit})`, p.packageSize]);

  productEl.hidden = false;
  productEl.innerHTML = `
    <div class="title">${escapeHtml(p.name)}</div>
    <div class="meta">${Math.round(p.kcalPer100)} kcal per 100 ${p.unit}${macroLine(p)}</div>
    <div class="preset-row">
      ${presets.map(([label, amt]) => `<button type="button" class="text-btn preset" data-amount="${amt}">${escapeHtml(label)}</button>`).join("")}
    </div>
    <label class="amount-row">
      Amount eaten
      <input type="number" id="barcodeAmount" min="0" step="any" value="${p.serving || 100}">
      <span>${p.unit}</span>
    </label>
    <div class="barcode-total" id="barcodeTotal"></div>
    <div class="dialog-actions">
      <button type="button" class="text-btn" id="barcodeAgain">Scan another</button>
      <button type="button" class="primary-btn" id="barcodeUse">Use this</button>
    </div>`;
  updateTotal();
}

function amountEaten() {
  return Math.max(0, Number(document.getElementById("barcodeAmount").value) || 0);
}

function updateTotal() {
  const kcal = Math.round((product.kcalPer100 * amountEaten()) / 100);
  document.getElementById("barcodeTotal").textContent = `${kcal} kcal`;
  return kcal;
}

productEl.addEventListener("input", e => {
  if (e.target.id === "barcodeAmount") updateTotal();
});

productEl.addEventListener("click", e => {
  const preset = e.target.closest(".preset");
  if (preset) {
    document.getElementById("barcodeAmount").value = preset.dataset.amount;
    updateTotal();
  } else if (e.target.id === "barcodeAgain") {
    productEl.hidden = true;
    startCamera();
  } else if (e.target.id === "barcodeUse") {
    form.name.value = `${product.name} (${amountEaten()} ${product.unit})`;
    form.calories.value = updateTotal();
    const scale = amountEaten() / 100;
    [["protein", "proteinPer100"], ["carbs", "carbsPer100"], ["fat", "fatPer100"]].forEach(([field, key]) => {
      form[field].value = product[key] == null ? "" : Math.round(product[key] * scale * 10) / 10;
    });
    dialog.close();
  }
});

manualForm.addEventListener("submit", e => {
  e.preventDefault();
  stopCamera();
  scanArea.hidden = true;
  lookup(manualForm.code.value);
  manualForm.reset();
});

// Fallback: decode a still photo of the barcode
barcodePhoto.addEventListener("change", async () => {
  const file = barcodePhoto.files[0];
  barcodePhoto.value = "";
  if (!file) return;
  stopCamera();
  scanArea.hidden = true;
  setStatus("Reading barcode…");
  try {
    const [detector, bitmap] = await Promise.all([getDetector(), createImageBitmap(file)]);
    const codes = await detector.detect(bitmap);
    if (codes.length) lookup(codes[0].rawValue);
    else setStatus("No barcode found in that photo. Try again closer, or type the number.", true);
  } catch (err) {
    setStatus("Couldn't read that photo. Try again or type the number.", true);
  }
});

document.getElementById("barcodeBtn").addEventListener("click", () => {
  product = null;
  productEl.hidden = true;
  dialog.showModal();
  startCamera();
});

document.getElementById("barcodeClose").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", stopCamera);
