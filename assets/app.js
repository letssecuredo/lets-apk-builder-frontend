/* Let-S APK Builder — frontend API client + helpers */
const API_BASE = (window.API_BASE || "https://lets-apk-builder.onrender.com").replace(/\/+$/, "");

// ═══════════════════════════════════════════════════════════════
// ADMIN AUTH
// ═══════════════════════════════════════════════════════════════
const adminAuth = {
  getToken() {
    return localStorage.getItem("admin_token");
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem("admin_user") || "null");
    } catch {
      return null;
    }
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  logout() {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
  },

  authHeaders() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
};

// ═══════════════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════════════
const api = {
  async createBuild(payload) {
    const res = await fetch(`${API_BASE}/api/build`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...adminAuth.authHeaders(),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
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

  async listCommonModules() {
    const res = await fetch(`${API_BASE}/api/common-modules?_=${Date.now()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed to load modules`);
    return data.modules || [];
  },

  downloadUrl(id) {
    return `${API_BASE}/api/download/${id}`;
  },
};

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════
function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] || c));
}

// ═══════════════════════════════════════════════════════════════
// ICON PROCESSOR
// ═══════════════════════════════════════════════════════════════
const ICON_TARGET_SIZE = 512;
const ICON_MAX_BYTES = 500 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Cannot decode image"));
    };
    img.src = url;
  });
}

async function iconToPngBase64(img, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, size, size);

  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;

  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  const blob = await new Promise((r) => canvas.toBlob(r, "image/png", 0.92));
  if (!blob) throw new Error("Canvas failed");

  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  return { dataUrl, bytes: blob.size };
}

async function processIcon(file) {
  const img = await loadImage(file);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const candidates = [ICON_TARGET_SIZE, 384, 256, 192, 128];

  let last = null;
  for (const size of candidates) {
    const result = await iconToPngBase64(img, size);
    last = result;
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
  throw new Error(`Icon too large (${Math.round(last.bytes / 1024)} KB)`);
}

// ═══════════════════════════════════════════════════════════════
// NAVBAR — auto update admin link
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  const navLink = document.getElementById("adminNavLink");
  if (!navLink) return;

  if (adminAuth.isLoggedIn()) {
    const user = adminAuth.getUser();
    navLink.textContent = "Admin ✓";
    navLink.href = "build.html";
    navLink.title = `Logged in as ${user?.email || "admin"}`;

    navLink.addEventListener("click", (e) => {
      if (confirm("Log out of admin?")) {
        e.preventDefault();
        adminAuth.logout();
        location.href = "index.html";
      }
    });
  }
});
