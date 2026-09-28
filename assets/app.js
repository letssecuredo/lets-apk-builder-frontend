/* Let-S APK Builder — frontend API client */
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
    const res = await fetch(`${API_BASE}/api/build/${id}`);
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

function iconPreview(inputEl, imgEl) {
  inputEl.addEventListener("change", async () => {
    const file = inputEl.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert("Icon must be ≤ 500 KB");
      inputEl.value = "";
      return;
    }
    const b64 = await fileToBase64(file);
    imgEl.src = b64;
    imgEl.style.display = "block";
    imgEl.dataset.base64 = b64;
  });
}
