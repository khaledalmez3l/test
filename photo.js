// Photo calorie estimate: send a meal photo to Claude and pre-fill the meal form.
// The API key is entered by the user and only stored in this browser.
const KEY_STORAGE = "fitnessTracker.apiKey";
const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
const MAX_SIDE = 1024; // downscale photos to keep requests small and cheap

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short name for the whole meal, e.g. 'Chicken salad with bread'" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          food: { type: "string" },
          portion: { type: "string", description: "Estimated portion, e.g. '150 g' or '1 cup'" },
          calories: { type: "integer" },
        },
        required: ["food", "portion", "calories"],
        additionalProperties: false,
      },
    },
    total_calories: { type: "integer" },
    is_food: { type: "boolean", description: "false if the photo does not show food or drink" },
  },
  required: ["name", "items", "total_calories", "is_food"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "You estimate calories from photos of meals for a personal food log. " +
  "Identify each food or drink visible, estimate its portion size from visual cues " +
  "(plate size, utensils, hands, packaging), and give a realistic calorie estimate for each, " +
  "including likely hidden calories such as cooking oil, butter, dressings and sauces. " +
  "Round calories to the nearest 10. If the photo shows no food or drink, set is_food to false " +
  "and return an empty items list with total_calories 0.";

const form = document.getElementById("mealForm");
const photoInput = document.getElementById("photoInput");
const result = document.getElementById("photoResult");
const keyInput = document.getElementById("apiKeyInput");
const keyStatus = document.getElementById("apiKeyStatus");

function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (e) { return ""; }
}

function setKey(value) {
  try {
    if (value) localStorage.setItem(KEY_STORAGE, value);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (e) { /* storage unavailable */ }
  showKeyStatus();
}

function showKeyStatus() {
  const key = getKey();
  keyStatus.textContent = key ? `Saved (…${key.slice(-4)})` : "No key saved";
  keyInput.value = "";
}

document.getElementById("apiKeyForm").addEventListener("submit", e => {
  e.preventDefault();
  setKey(keyInput.value.trim());
});
document.getElementById("apiKeyClear").addEventListener("click", () => setKey(""));
showKeyStatus();

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Load the photo, shrink it and return base64 JPEG (also converts iPhone HEIC photos)
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function estimateCalories(base64, apiKey) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: "Estimate the calories in this meal." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude couldn't analyze this photo.");
  if (response.stop_reason === "max_tokens") throw new Error("The response was cut off. Please try again.");
  const text = response.content.find(b => b.type === "text");
  if (!text) throw new Error("No estimate came back. Please try again.");
  return JSON.parse(text.text);
}

function friendlyError(err) {
  const status = err && err.status;
  if (status === 401) return "Your API key was rejected. Check it in “Photo estimates” settings below.";
  if (status === 429) return "Too many requests right now. Wait a moment and try again.";
  if (status === 400 && /credit/i.test(err.message)) return "Your Anthropic account is out of credits.";
  if (!navigator.onLine) return "You're offline. Photo estimates need an internet connection.";
  return err && err.message ? err.message : "Something went wrong. Please try again.";
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  photoInput.value = ""; // allow choosing the same photo again
  if (!file) return;

  const apiKey = getKey();
  if (!apiKey) {
    result.hidden = false;
    result.innerHTML = `<p class="photo-error">Add your Anthropic API key in “Photo estimates” settings below first.</p>`;
    document.getElementById("apiKeySettings").open = true;
    keyInput.focus();
    return;
  }

  result.hidden = false;
  result.innerHTML = `<p class="photo-status"><span class="spinner"></span>Analyzing photo…</p>`;

  try {
    const { dataUrl, base64 } = await prepareImage(file);
    result.innerHTML = `
      <img class="photo-thumb" src="${dataUrl}" alt="">
      <p class="photo-status"><span class="spinner"></span>Estimating calories…</p>`;

    const est = await estimateCalories(base64, apiKey);
    if (!est.is_food) {
      result.innerHTML = `
        <img class="photo-thumb" src="${dataUrl}" alt="">
        <p class="photo-error">I couldn't find any food in that photo. Try another one.</p>`;
      return;
    }

    form.name.value = est.name;
    form.calories.value = est.total_calories;
    result.innerHTML = `
      <img class="photo-thumb" src="${dataUrl}" alt="">
      <div class="photo-breakdown">
        <div class="title">${escapeHtml(est.name)} · ~${est.total_calories} kcal</div>
        <ul>${est.items.map(i =>
          `<li>${escapeHtml(i.food)} <span class="meta">(${escapeHtml(i.portion)})</span> — ${i.calories} kcal</li>`
        ).join("")}</ul>
        <p class="meta">Approximate. Adjust the numbers above if needed, then tap Add.</p>
      </div>`;
  } catch (err) {
    result.innerHTML = `<p class="photo-error">${escapeHtml(friendlyError(err))}</p>`;
  }
});

// Hide the estimate once the meal has been added
form.addEventListener("submit", () => {
  result.hidden = true;
  result.innerHTML = "";
});
