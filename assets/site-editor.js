/* ═══════════════════════════════════════════════
   Site Editor — HTML/CSS/JS editor for offline bundles
   ═══════════════════════════════════════════════ */

const SITE_STORAGE_KEY = "builder_site_drafts";
const SITE_SESSION_KEY = "builder_site_current";

let currentSite = null;
let openFiles = [];
let activeFile = null;
let cmEditor = null;
let modalMode = null;

// ─── Init ───
document.addEventListener("DOMContentLoaded", () => {
  initCodeMirror();
  loadCurrentSession();
  renderFileTree();
  updateSiteLabel();

  if (!currentSite) {
    const sites = loadAllSites();
    if (sites.length > 0) {
      currentSite = sites[sites.length - 1];
      saveCurrentSession();
      renderFileTree();
      updateSiteLabel();
      setTimeout(() => openFile("index.html"), 150);
    } else {
      setTimeout(() => openTemplateModal(), 300);
    }
  } else {
    if (currentSite.files && currentSite.files["index.html"] !== undefined) {
      setTimeout(() => openFile("index.html"), 150);
    }
  }

  window.addEventListener("beforeunload", (e) => {
    if (openFiles.some(f => f.dirty)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveSite();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      createNewFile();
    }
  });
});

// ─── CodeMirror ───
function initCodeMirror() {
  const textarea = document.getElementById("codeArea");
  cmEditor = CodeMirror.fromTextArea(textarea, {
    lineNumbers: true,
    theme: "material-darker",
    mode: "htmlmixed",
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    lineWrapping: true,
    viewportMargin: 20,
  });

  cmEditor.on("change", () => {
    if (activeFile) {
      const file = openFiles.find(f => f.path === activeFile);
      if (file) {
        file.content = cmEditor.getValue();
        file.dirty = true;
        renderTabs();
      }
    }
  });

  cmEditor.on("cursorActivity", () => {
    const pos = cmEditor.getCursor();
    document.getElementById("cursorPos").textContent =
      `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
  });
}

// ─── Session ───
function loadAllSites() {
  try {
    const raw = localStorage.getItem(SITE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveAllSites(sites) {
  localStorage.setItem(SITE_STORAGE_KEY, JSON.stringify(sites));
}

function saveCurrentSession() {
  if (currentSite) {
    localStorage.setItem(SITE_SESSION_KEY, currentSite.id);
  }
}

function loadCurrentSession() {
  const sites = loadAllSites();
  if (sites.length === 0) return;
  const id = localStorage.getItem(SITE_SESSION_KEY);
  if (id) {
    const found = sites.find(s => s.id === id);
    if (found) { currentSite = found; return; }
  }
  currentSite = sites[sites.length - 1];
}

// ─── File Tree ───
function renderFileTree() {
  const tree = document.getElementById("fileTree");
  if (!currentSite) { tree.innerHTML = ""; return; }

  const files = Object.keys(currentSite.files || {}).sort();
  if (files.length === 0) { tree.innerHTML = ""; return; }

  const folders = {};
  const rootFiles = [];

  for (const path of files) {
    const parts = path.split("/");
    if (parts.length === 1) rootFiles.push(path);
    else {
      const folder = parts[0];
      if (!folders[folder]) folders[folder] = [];
      folders[folder].push(path);
    }
  }

  let html = "";

  for (const path of rootFiles) html += renderFileItem(path);

  for (const folder of Object.keys(folders).sort()) {
    html += `<div class="file-folder">📁 ${escapeHtml(folder)}</div>`;
    for (const path of folders[folder].sort()) html += renderFileItem(path);
  }

  tree.innerHTML = html;

  tree.querySelectorAll(".file-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".file-delete")) return;
      openFile(el.dataset.path);
    });
  });
  tree.querySelectorAll(".file-delete").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFile(el.dataset.path);
    });
  });
}

function renderFileItem(path) {
  const isActive = path === activeFile ? "active" : "";
  const icon = getFileIcon(path);
  const fileName = path.split("/").pop();
  return `
    <div class="file-item ${isActive}" data-path="${escapeHtml(path)}">
      <span class="file-icon">${icon}</span>
      <span class="file-name">${escapeHtml(fileName)}</span>
      <button class="file-delete" data-path="${escapeHtml(path)}" title="Delete">✕</button>
    </div>`;
}

function getFileIcon(path) {
  if (path.endsWith(".html") || path.endsWith(".htm")) return "🌐";
  if (path.endsWith(".css")) return "🎨";
  if (path.endsWith(".js")) return "⚡";
  if (path.endsWith(".json")) return "🟡";
  if (path.endsWith(".md")) return "📝";
  if (/\.(png|jpe?g|svg|gif|webp)$/i.test(path)) return "🖼️";
  if (/\.(woff2?|ttf|otf)$/i.test(path)) return "🔤";
  return "📄";
}

// ─── Open file ───
function openFile(path) {
  if (!currentSite) return;
  let file = openFiles.find(f => f.path === path);
  if (!file) {
    file = {
      path,
      content: currentSite.files[path] || "",
      dirty: false,
    };
    openFiles.push(file);
  }
  activeFile = path;
  cmEditor.setValue(file.content);
  cmEditor.clearHistory();
  setEditorMode(path);

  document.getElementById("filePathLabel").textContent = path;
  document.getElementById("editorEmpty").classList.add("hidden");

  renderTabs();
  renderFileTree();
}

function setEditorMode(path) {
  let mode = "text/plain";
  if (path.endsWith(".html") || path.endsWith(".htm")) mode = "htmlmixed";
  else if (path.endsWith(".css")) mode = "text/css";
  else if (path.endsWith(".js")) mode = "text/javascript";
  else if (path.endsWith(".json")) mode = "application/json";
  else if (path.endsWith(".xml")) mode = "application/xml";
  cmEditor.setOption("mode", mode);
}

// ─── Tabs ───
function renderTabs() {
  const tabs = document.getElementById("editorTabs");
  tabs.innerHTML = openFiles.map(f => `
    <div class="editor-tab ${f.path === activeFile ? "active" : ""}" data-path="${escapeHtml(f.path)}">
      <span>${escapeHtml(f.path.split("/").pop())}${f.dirty ? " ●" : ""}</span>
      <span class="tab-close" data-close="${escapeHtml(f.path)}">✕</span>
    </div>`).join("");

  tabs.querySelectorAll(".editor-tab").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".tab-close")) return;
      openFile(el.dataset.path);
    });
  });
  tabs.querySelectorAll(".tab-close").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(el.dataset.close);
    });
  });
}

function closeTab(path) {
  const idx = openFiles.findIndex(f => f.path === path);
  if (idx === -1) return;
  const file = openFiles[idx];
  if (file.dirty && !confirm(`"${path}" has unsaved changes. Close anyway?`)) return;
  openFiles.splice(idx, 1);

  if (activeFile === path) {
    if (openFiles.length > 0) openFile(openFiles[openFiles.length - 1].path);
    else {
      activeFile = null;
      cmEditor.setValue("");
      document.getElementById("filePathLabel").textContent = "—";
      document.getElementById("editorEmpty").classList.remove("hidden");
    }
  }
  renderTabs();
  renderFileTree();
}

// ─── Create file/folder ───
function createNewFile() {
  if (!currentSite) {
    createNewSite(() => createNewFile());
    return;
  }
  modalMode = "file";
  showModal("New File", "index.html", "Use / for subfolders (e.g. css/style.css)");
}

function createNewFolder() {
  if (!currentSite) {
    createNewSite(() => createNewFolder());
    return;
  }
  modalMode = "folder";
  showModal("New Folder", "css", "Folder name only");
}

function showModal(title, placeholder, hint) {
  document.getElementById("modalTitle").textContent = title;
  const input = document.getElementById("modalInput");
  input.value = "";
  input.placeholder = placeholder;
  document.getElementById("modalHint").textContent = hint;
  document.getElementById("modalBackdrop").classList.add("show");
  setTimeout(() => input.focus(), 100);
}

function closeModal(e) {
  if (e && e.target !== document.getElementById("modalBackdrop")) return;
  document.getElementById("modalBackdrop").classList.remove("show");
  modalMode = null;
}

function confirmModal() {
  const value = document.getElementById("modalInput").value.trim();
  if (!value) return;

  if (modalMode === "file") {
    if (currentSite.files[value] !== undefined) {
      showToast("File already exists");
      return;
    }
    currentSite.files[value] = "";
    persistSite();
    renderFileTree();
    closeModal();
    setTimeout(() => openFile(value), 100);
    showToast("✅ Created: " + value);
  } else if (modalMode === "folder") {
    const path = value.replace(/\/+$/, "") + "/.gitkeep";
    if (currentSite.files[path] !== undefined) {
      showToast("Folder already exists");
      return;
    }
    currentSite.files[path] = "";
    persistSite();
    renderFileTree();
    closeModal();
    showToast("📁 Created: " + value);
  }
}

document.addEventListener("keydown", (e) => {
  if (document.getElementById("modalBackdrop").classList.contains("show")) {
    if (e.key === "Enter") confirmModal();
    if (e.key === "Escape") closeModal();
  }
});

// ─── Delete ───
function deleteFile(path) {
  if (!currentSite) return;
  if (!confirm(`Delete "${path}"?`)) return;
  delete currentSite.files[path];

  const idx = openFiles.findIndex(f => f.path === path);
  if (idx !== -1) {
    openFiles.splice(idx, 1);
    if (activeFile === path) {
      activeFile = null;
      if (openFiles.length > 0) openFile(openFiles[openFiles.length - 1].path);
      else {
        cmEditor.setValue("");
        document.getElementById("filePathLabel").textContent = "—";
        document.getElementById("editorEmpty").classList.remove("hidden");
      }
    }
  }
  persistSite();
  renderFileTree();
  renderTabs();
  showToast("🗑️ Deleted: " + path);
}

// ─── Site management ───
function createNewSite(callback) {
  const name = prompt("Site name:", "my-site");
  if (!name) return;
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  currentSite = {
    id: safeName + "-" + Date.now(),
    name: safeName,
    files: {},
    createdAt: Date.now(),
  };

  persistSite();
  updateSiteLabel();
  renderFileTree();
  showToast("✅ New site: " + safeName);
  if (callback) setTimeout(callback, 100);
}

function updateSiteLabel() {
  document.getElementById("moduleNameLabel").textContent =
    currentSite ? currentSite.name : "my-site";
}

function persistSite() {
  if (!currentSite) return;
  for (const file of openFiles) {
    currentSite.files[file.path] = file.content;
    file.dirty = false;
  }
  const sites = loadAllSites();
  const idx = sites.findIndex(s => s.id === currentSite.id);
  if (idx === -1) sites.push(currentSite);
  else sites[idx] = currentSite;
  saveAllSites(sites);
  saveCurrentSession();
  renderTabs();
}

function saveSite() {
  if (!currentSite) { showToast("No site to save"); return; }
  if (Object.keys(currentSite.files).filter(p => !p.endsWith(".gitkeep")).length === 0) {
    showToast("⚠️ Add some files first");
    return;
  }
  persistSite();
  showToast("💾 Saved: " + currentSite.name);
}

// ─── Preview ───
function previewSite() {
  if (!currentSite) { showToast("No site"); return; }
  persistSite();

  const indexHtml = currentSite.files["index.html"];
  if (!indexHtml) {
    showToast("⚠️ No index.html found");
    return;
  }

  let html = indexHtml;

  html = html.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (match, path) => {
    const cleanPath = path.replace(/^\.\//, "");
    const css = currentSite.files[cleanPath];
    return css ? `<style>\n${css}\n</style>` : match;
  });

  html = html.replace(/<script[^>]+src=["']([^"']+\.js)["'][^>]*><\/script>/gi, (match, path) => {
    const cleanPath = path.replace(/^\.\//, "");
    const js = currentSite.files[cleanPath];
    return js ? `<script>\n${js}\n</script>` : match;
  });

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

// ─── Templates ───
function openTemplateModal() {
  document.getElementById("templateBackdrop").classList.add("show");
}

function closeTemplateModal(e) {
  if (e && e.target !== document.getElementById("templateBackdrop")) return;
  document.getElementById("templateBackdrop").classList.remove("show");
}

function loadTemplate(type) {
  const name = prompt("Site name:", "my-site");
  if (!name) return;
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  currentSite = {
    id: safeName + "-" + Date.now(),
    name: safeName,
    files: getTemplateFiles(type),
    createdAt: Date.now(),
  };

  persistSite();
  updateSiteLabel();
  renderFileTree();
  closeTemplateModal();
  setTimeout(() => openFile("index.html"), 200);
  showToast("✅ Template: " + safeName);
}

function getTemplateFiles(type) {
  const blank = {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>My App</title>
</head>
<body>
<h1>Hello!</h1>
</body>
</html>
`,
  };

  const minimal = {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>My App</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>
<h1>Hello from Offline App 👋</h1>
<button id="btn">Click me</button>
<p id="output"></p>
<script src="app.js"></script>
</body>
</html>
`,
    "style.css": `* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, sans-serif;
  background: #0a0d14;
  color: #e6ecf5;
  padding: 40px 20px;
  text-align: center;
  min-height: 100vh;
}
h1 { font-size: 24px; margin-bottom: 24px; }
button {
  padding: 12px 24px;
  background: #1f6feb;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
}
button:active { background: #63a1ff; }
p { margin-top: 20px; color: #8b97ab; }
`,
    "app.js": `document.getElementById("btn").addEventListener("click", () => {
  const out = document.getElementById("output");
  out.textContent = "Clicked at " + new Date().toLocaleTimeString();
});
console.log("App initialized");
`,
  };

  const landing = {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>My App</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>
<header class="hero">
  <div class="logo">📱</div>
  <h1>Welcome to My App</h1>
  <p>A beautiful offline-first experience</p>
  <button class="cta">Get Started</button>
</header>
<section class="cards">
  <div class="card"><div class="icon">⚡</div><h3>Fast</h3><p>Optimized for speed</p></div>
  <div class="card"><div class="icon">🔒</div><h3>Secure</h3><p>Your data is safe</p></div>
  <div class="card"><div class="icon">📴</div><h3>Offline</h3><p>Works without internet</p></div>
</section>
<footer>Made with ❤️</footer>
<script src="app.js"></script>
</body>
</html>
`,
    "style.css": `* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, sans-serif;
  background: #0a0d14;
  color: #e6ecf5;
  min-height: 100vh;
}
.hero {
  text-align: center;
  padding: 60px 20px 40px;
}
.logo { font-size: 64px; margin-bottom: 20px; }
.hero h1 { font-size: 32px; margin-bottom: 12px; }
.hero p { color: #8b97ab; margin-bottom: 24px; }
.cta {
  padding: 14px 32px;
  background: #1f6feb;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}
.cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding: 20px;
  max-width: 500px;
  margin: 0 auto;
}
@media (min-width: 640px) {
  .cards { grid-template-columns: repeat(3, 1fr); }
}
.card {
  background: #141b2b;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  padding: 24px;
  text-align: center;
}
.card .icon { font-size: 32px; margin-bottom: 12px; }
.card h3 { font-size: 16px; margin-bottom: 6px; }
.card p { color: #8b97ab; font-size: 13px; }
footer {
  text-align: center;
  padding: 40px 20px;
  color: #8b97ab;
  font-size: 12px;
}
`,
    "app.js": `document.querySelector(".cta").addEventListener("click", () => {
  alert("Welcome! 🎉");
});
`,
  };

  const dark = {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<meta name="theme-color" content="#1f6feb" />
<title>My App</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>
<header class="app-header">
  <div class="brand">
    <div class="logo">📱</div>
    <span>My App</span>
  </div>
  <div class="status" id="status">● Online</div>
</header>
<main class="content">
  <h1>Welcome 👋</h1>
  <p>Your offline-first mobile app.</p>
  <div class="grid">
    <button class="tile" onclick="toast('Feature 1')"><span>⚡</span>Fast</button>
    <button class="tile" onclick="toast('Feature 2')"><span>🔒</span>Secure</button>
    <button class="tile" onclick="toast('Feature 3')"><span>📴</span>Offline</button>
    <button class="tile" onclick="toast('Feature 4')"><span>🎨</span>Theme</button>
  </div>
</main>
<div id="toast" class="toast"></div>
<script src="app.js"></script>
</body>
</html>
`,
    "style.css": `* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body {
  font-family: -apple-system, sans-serif;
  background: #0a0d14;
  color: #e6ecf5;
  min-height: 100vh;
}
.app-header {
  position: sticky; top: 0;
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px;
  background: rgba(10,13,20,0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
.logo { font-size: 22px; }
.status { font-size: 12px; color: #3ecf8e; }
.content { padding: 24px 20px; }
h1 { font-size: 28px; margin-bottom: 8px; }
p { color: #8b97ab; margin-bottom: 24px; }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.tile {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 24px 12px;
  background: #141b2b;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  color: #e6ecf5;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tile span { font-size: 28px; }
.tile:active { background: #1a2336; transform: scale(0.97); }
.toast {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: #141b2b;
  color: #e6ecf5;
  padding: 12px 20px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  opacity: 0; pointer-events: none;
  transition: all 0.25s;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
`,
    "app.js": `function updateStatus() {
  const el = document.getElementById("status");
  el.textContent = navigator.onLine ? "● Online" : "● Offline";
}
window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);
updateStatus();

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}
`,
  };

  return {
    blank,
    minimal,
    landing,
    dark,
  }[type] || blank;
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD SITE AS ZIP
// ═══════════════════════════════════════════════════════════════
async function downloadZip() {
  if (!currentSite) {
    showToast("No site to download");
    return;
  }

  persistSite();

  const files = currentSite.files || {};
  const fileKeys = Object.keys(files).filter(p => !p.endsWith(".gitkeep"));

  if (fileKeys.length === 0) {
    showToast("⚠️ Site is empty — add some files first");
    return;
  }

  if (!files["index.html"]) {
    const proceed = confirm(
      "⚠️ This site has no index.html file.\n\n" +
      "Without index.html at root, the offline bundle won't work.\n\n" +
      "Download anyway?"
    );
    if (!proceed) return;
  }

  try {
    showToast("⏳ Building ZIP…");

    const zip = new JSZip();
    for (const path of fileKeys) {
      zip.file(path, files[path] || "");
    }

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSite.name || "site"}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const sizeKB = Math.round(blob.size / 1024);
    showToast(`✅ Downloaded: ${currentSite.name}.zip (${sizeKB} KB)`);
  } catch (err) {
    console.error("ZIP download failed:", err);
    showToast("✗ Failed: " + err.message);
  }
}

// ─── Toast ───
let toastTimer = null;
function showToast(message, duration = 2000) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

// ─── Utils ───
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  }[c] || c));
}

// ─── Expose globals for inline onclick ───
window.downloadZip = downloadZip;
window.previewSite = previewSite;
window.saveSite = saveSite;
window.createNewFile = createNewFile;
window.createNewFolder = createNewFolder;
window.openTemplateModal = openTemplateModal;
window.closeTemplateModal = closeTemplateModal;
window.closeModal = closeModal;
window.confirmModal = confirmModal;
window.loadTemplate = loadTemplate;
