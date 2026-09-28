/* Let-S APK Builder — frontend API client + icon processor */
const API_BASE = (window.API_BASE || "https://lets-apk-builder.onrender.com").replace(/\/+$/, "");

const api = {
  async createBuild(payload) {
    const res = await fetch(`${API_BASE}/api/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },

  async getBuild(id) {
    const res = await fetch(`${API_BASE}/api/build/${id}?_=${Date.now()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },

  async listBuilds(limit = 20) {
    const res = await fetch(`${API_BASE}/api/builds?limit=${limit}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data.builds || [];
  },

  downloadUrl(id) { return `${API_BASE}/api/download/${id}`; },
};

/* ---------- UI helpers ---------- */
function qs(name) { return new URLSearchParams(location.search).get(name); }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════════════════════════════
   ICON PROCESSOR
   - Any image (PNG/JPG/WEBP/GIF) → 512×512 PNG
   - Center-crop to square
   - 8-bit RGBA PNG (AAPT2-safe)
   - Auto-compress until ≤500 KB
   ══════════════════════════════════════════════════════════════════ */

const ICON_TARGET_SIZE = 512;         // px (square)
const ICON_MAX_BYTES = 500 * 1024;    // 500 KB

/**
 * Load a File into an HTMLImageElement.
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image. Is it a valid image file?"));
    };
    img.src = url;
  });
}

/**
 * Draw image on a square canvas with center-crop, return base64 PNG.
 * Uses iterative quality (via canvas.toBlob quality) to stay under max bytes.
 */
async function iconToPngBase64(img, size, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Enable high-quality scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Fill with transparent background
  ctx.clearRect(0, 0, size, size);

  // Center-crop source to square
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;

  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  // Prefer toBlob to control quality (PNG ignores quality param but keeps API consistency)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", quality));
  if (!blob) throw new Error("Canvas toBlob failed");

  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  return { dataUrl, bytes: blob.size };
}

/**
 * Process an icon file and return:
 *   { base64: "data:image/png;base64,...", bytes, width, height, originalBytes }
 *
 * Steps:
 *   1. Decode any image (PNG/JPG/WebP/GIF/etc)
 *   2. If < 512 or > 512, scale with center-crop
 *   3. Re-encode as PNG (8-bit RGBA)
 *   4. If PNG > 500 KB, downscale target size (512 → 384 → 256 → 192)
 *   5. Return the best result
 */
async function processIcon(file) {
  const img = await loadImage(file);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;

  // Try progressively smaller canvas sizes to fit the byte budget
  const candidates = [ICON_TARGET_SIZE, 384, 256, 192, 128];

  let lastResult = null;
  for (const size of candidates) {
    const result = await iconToPngBase64(img, size, 0.92);
    lastResult = result;
    if (result.bytes <= ICON_MAX_BYTES) {
      return {
        base64: result.dataUrl,
        bytes: result.bytes,
        width: size,
        height: size,
        originalBytes: file.size,
        originalWidth: sw,
        originalHeight: sh,
      };
    }
  }

  throw new Error(
    `Icon too large even after compression (${Math.round(lastResult.bytes / 1024)} KB). ` +
    `Try a simpler image.`
  );
}

/**
 * Attach to a file input. On change:
 *   - processes the icon
 *   - shows preview + status text
 *   - stores base64 in imgEl.dataset.base64
 */
function iconPreview(inputEl, imgEl, statusEl) {
  inputEl.addEventListener("change", async () => {
    const file = inputEl.files?.[0];
    if (!file) {
      imgEl.style.display = "none";
      imgEl.dataset.base64 = "";
      if (statusEl) statusEl.textContent = "";
      return;
    }

    // Basic sanity check
    if (!file.type.startsWith("image/")) {
      showIconError("Please select an image file (PNG, JPG, WebP…)");
      inputEl.value = "";
      return;
    }

    if (statusEl) statusEl.textContent = "Processing…";

    try {
      const result = await processIcon(file);

      imgEl.src = result.base64;
      imgEl.style.display = "block";
      imgEl.dataset.base64 = result.base64;
      imgEl.dataset.width = String(result.width);
      imgEl.dataset.height = String(result.height);

      if (statusEl) {
        const srcKB = Math.round(result.originalBytes / 1024);
        const outKB = Math.round(result.bytes / 1024);
        statusEl.textContent =
          `✓ Ready — ${result.width}×${result.height} PNG, ${outKB} KB ` +
          `(from ${result.originalWidth}×${result.originalHeight} ${srcKB} KB)`;
        statusEl.style.color = "var(--success)";
      }
    } catch (err) {
      showIconError(err.message);
      inputEl.value = "";
      imgEl.style.display = "none";
      imgEl.dataset.base64 = "";
      if (statusEl) statusEl.textContent = "";
    }
  });

  function showIconError(msg) {
    if (statusEl) {
      statusEl.textContent = "✗ " + msg;
      statusEl.style.color = "var(--danger)";
    } else {
      alert(msg);
    }
  }
}
