/* ═══════════════════════════════════════════════
   Code Editor — Logic
   ═══════════════════════════════════════════════ */

// ─── State ───
const EDITOR_STORAGE_KEY = "builder_editor_modules";
const EDITOR_SESSION_KEY = "builder_editor_current";

let currentModule = null;  // { id, name, files: { path: content }, createdAt }
let openFiles = [];         // [{ path, content, dirty }]
let activeFile = null;      // path string
let cmEditor = null;        // CodeMirror instance
let modalMode = null;       // "file" | "folder"
let modalParentDir = "";    // parent dir for new file

// ─── Load modules from localStorage ───
function loadAllModules() {
  try {
    const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveAllModules(modules) {
  localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(modules));
}

// ─── Init ───
document.addEventListener("DOMContentLoaded", () => {
  initCodeMirror();
  loadCurrentSession();
  renderFileTree();
  updateModuleLabel();

  if (!currentModule) {
    const modules = loadAllModules();
    if (modules.length > 0) {
      currentModule = modules[modules.length - 1];
      saveCurrentSession();
      renderFileTree();
      updateModuleLabel();
    } else {
      setTimeout(() => openTemplateModal(), 300);
    }
  }

  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveModule();
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
    mode: "text/x-kotlin",
    indentUnit: 4,
    tabSize: 4,
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

// ─── Session persistence ───
function saveCurrentSession() {
  if (currentModule) {
    localStorage.setItem(EDITOR_SESSION_KEY, currentModule.id);
  }
}

function loadCurrentSession() {
  const modules = loadAllModules();
  if (modules.length === 0) return;

  const sessionId = localStorage.getItem(EDITOR_SESSION_KEY);
  if (sessionId) {
    const found = modules.find(m => m.id === sessionId);
    if (found) {
      currentModule = found;
      return;
    }
  }
  currentModule = modules[0];
}

// ─── File Tree ───
function renderFileTree() {
  const tree = document.getElementById("fileTree");

  if (!currentModule) {
    tree.innerHTML = "";
    return;
  }

  const files = Object.keys(currentModule.files || {}).sort();
  if (files.length === 0) {
    tree.innerHTML = "";
    return;
  }

  const folders = {};
  const rootFiles = [];

  for (const path of files) {
    const parts = path.split("/");
    if (parts.length === 1) {
      rootFiles.push(path);
    } else {
      const folder = parts[0];
      if (!folders[folder]) folders[folder] = [];
      folders[folder].push(path);
    }
  }

  let html = "";

  for (const path of rootFiles) {
    html += renderFileItem(path);
  }

  for (const folder of Object.keys(folders).sort()) {
    html += `<div class="file-folder">📁 ${escapeHtml(folder)}</div>`;
    for (const path of folders[folder].sort()) {
      html += renderFileItem(path);
    }
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
    </div>
  `;
}

function getFileIcon(path) {
  if (path.endsWith(".kt")) return "🟣";
  if (path.endsWith(".java")) return "🟠";
  if (path.endsWith(".xml")) return "🔵";
  if (path.endsWith(".json")) return "🟡";
  if (path.endsWith(".gradle")) return "🟢";
  if (path.endsWith(".png") || path.endsWith(".jpg")) return "🖼️";
  return "📄";
}

// ─── Open file ───
function openFile(path) {
  if (!currentModule) return;

  let file = openFiles.find(f => f.path === path);
  if (!file) {
    file = {
      path,
      content: currentModule.files[path] || "",
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

// ─── Close tab ───
function closeTab(path) {
  const idx = openFiles.findIndex(f => f.path === path);
  if (idx === -1) return;

  const file = openFiles[idx];
  if (file.dirty) {
    if (!confirm(`"${path}" has unsaved changes. Close anyway?`)) return;
  }

  openFiles.splice(idx, 1);

  if (activeFile === path) {
    if (openFiles.length > 0) {
      openFile(openFiles[openFiles.length - 1].path);
    } else {
      activeFile = null;
      cmEditor.setValue("");
      document.getElementById("filePathLabel").textContent = "—";
      document.getElementById("editorEmpty").classList.remove("hidden");
    }
  }

  renderTabs();
  renderFileTree();
}

// ─── Tabs ───
function renderTabs() {
  const tabs = document.getElementById("editorTabs");
  tabs.innerHTML = openFiles.map(f => `
    <div class="editor-tab ${f.path === activeFile ? "active" : ""}" data-path="${escapeHtml(f.path)}">
      <span>${escapeHtml(f.path.split("/").pop())}${f.dirty ? " ●" : ""}</span>
      <span class="tab-close" data-close="${escapeHtml(f.path)}">✕</span>
    </div>
  `).join("");

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

// ─── Editor mode (syntax highlight) ───
function setEditorMode(path) {
  let mode = "text/plain";
  if (path.endsWith(".kt") || path.endsWith(".java")) mode = "text/x-kotlin";
  else if (path.endsWith(".xml")) mode = "application/xml";
  else if (path.endsWith(".json")) mode = "application/json";
  else if (path.endsWith(".gradle")) mode = "text/x-groovy";
  else if (path.endsWith(".js")) mode = "text/javascript";

  cmEditor.setOption("mode", mode);
}

// ─── Create file ───
function createNewFile() {
  if (!currentModule) {
    createNewModule(() => createNewFile());
    return;
  }
  modalMode = "file";
  modalParentDir = "";
  showModal("New File", "filename.kt", "Use / for subfolders (e.g. layout/main.xml)");
}

function createNewFolder() {
  if (!currentModule) {
    createNewModule(() => createNewFolder());
    return;
  }
  modalMode = "folder";
  showModal("New Folder", "folder-name", "Folder name only (no slashes)");
}

// ─── Modal ───
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
    const path = value;
    if (currentModule.files[path] !== undefined) {
      showToast("File already exists");
      return;
    }
    currentModule.files[path] = "";
    persistModule();
    renderFileTree();
    closeModal();
    setTimeout(() => openFile(path), 100);
    showToast("✅ File created: " + path);
  } else if (modalMode === "folder") {
    const path = value.replace(/\/+$/, "") + "/.gitkeep";
    if (currentModule.files[path] !== undefined) {
      showToast("Folder already exists");
      return;
    }
    currentModule.files[path] = "";
    persistModule();
    renderFileTree();
    closeModal();
    showToast("📁 Folder created: " + value);
  }
}

document.addEventListener("keydown", (e) => {
  if (document.getElementById("modalBackdrop").classList.contains("show")) {
    if (e.key === "Enter") confirmModal();
    if (e.key === "Escape") closeModal();
  }
});

// ─── Delete file ───
function deleteFile(path) {
  if (!currentModule) return;
  if (!confirm(`Delete "${path}"?`)) return;

  delete currentModule.files[path];

  const idx = openFiles.findIndex(f => f.path === path);
  if (idx !== -1) {
    openFiles.splice(idx, 1);
    if (activeFile === path) {
      activeFile = null;
      if (openFiles.length > 0) {
        openFile(openFiles[openFiles.length - 1].path);
      } else {
        cmEditor.setValue("");
        document.getElementById("filePathLabel").textContent = "—";
        document.getElementById("editorEmpty").classList.remove("hidden");
      }
    }
  }

  persistModule();
  renderFileTree();
  renderTabs();
  showToast("🗑️ Deleted: " + path);
}

// ─── Module management ───
function createNewModule(callback) {
  const name = prompt("Module name (lowercase, hyphens ok):", "my-module");
  if (!name) return;

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  currentModule = {
    id: safeName + "-" + Date.now(),
    name: safeName,
    files: {},
    createdAt: Date.now(),
  };

  persistModule();
  updateModuleLabel();
  renderFileTree();

  showToast("✅ New module: " + safeName);
  if (callback) setTimeout(callback, 100);
}

function renameModule() {
  if (!currentModule) {
    createNewModule();
    return;
  }
  const name = prompt("Rename module:", currentModule.name);
  if (!name) return;
  currentModule.name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  persistModule();
  updateModuleLabel();
  showToast("✏️ Renamed to: " + currentModule.name);
}

function updateModuleLabel() {
  document.getElementById("moduleNameLabel").textContent =
    currentModule ? currentModule.name : "untitled-module";
}

function persistModule() {
  if (!currentModule) return;

  for (const file of openFiles) {
    currentModule.files[file.path] = file.content;
    file.dirty = false;
  }

  const modules = loadAllModules();
  const idx = modules.findIndex(m => m.id === currentModule.id);
  if (idx === -1) {
    modules.push(currentModule);
  } else {
    modules[idx] = currentModule;
  }
  saveAllModules(modules);
  saveCurrentSession();
  renderTabs();
}

function hasUnsavedChanges() {
  return openFiles.some(f => f.dirty);
}

function saveModule() {
  if (!currentModule) {
    showToast("No module to save");
    return;
  }

  if (Object.keys(currentModule.files).length === 0) {
    showToast("⚠️ Module is empty — add some files first");
    return;
  }

  persistModule();
  showToast("💾 Module saved: " + currentModule.name);
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
  const name = prompt("Module name:", "my-module");
  if (!name) return;

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const id = safeName + "-" + Date.now();

  currentModule = {
    id,
    name: safeName,
    files: getTemplateFiles(type, safeName),
    createdAt: Date.now(),
  };

  persistModule();
  updateModuleLabel();
  renderFileTree();
  closeTemplateModal();

  const firstFile = Object.keys(currentModule.files)[0];
  if (firstFile) setTimeout(() => openFile(firstFile), 200);

  showToast("✅ Template loaded: " + safeName);
}

function getTemplateFiles(type, name) {
  const moduleJson = JSON.stringify({
    name: name,
    version: "1.0.0",
    author: "admin@letssecuredo.com",
    description: "Custom module: " + name,
    isMain: false,
    minSdk: 21,
  }, null, 2);

  const blank = {
    "module.json": moduleJson,
  };

  const helper = {
    "module.json": moduleJson,
    "Helper.kt": `package {PACKAGE_NAME}

object Helper {
    fun hello(): String {
        return "Hello from ${name}!"
    }
}
`,
    "deps.gradle": `// No dependencies needed
`,
  };

  const activity = {
    "module.json": moduleJson,
    "MainActivity.kt": `package {PACKAGE_NAME}

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import android.widget.TextView

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<TextView>(R.id.tvTitle).text = "${name}"
    }
}
`,
    "layout/activity_main.xml": `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:padding="24dp"
    android:background="#0a0d14">

    <TextView
        android:id="@+id/tvTitle"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:textColor="#e6ecf5"
        android:textSize="20sp"
        android:text="${name}" />

</LinearLayout>
`,
    "manifest.xml": `<activity
    android:name=".MainActivity"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
</activity>
`,
    "deps.gradle": `// Add dependencies here
`,
  };

  const full = {
    ...activity,
    "drawable/bg.xml": `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#1f6feb" />
    <corners android:radius="8dp" />
</shape>
`,
    "README.md": `# ${name}

Custom module for Let-S APK Builder.

## Structure
- \`module.json\` — metadata
- \`*.kt\` — Kotlin sources (use {PACKAGE_NAME} placeholder)
- \`layout/*.xml\` — UI layouts
- \`deps.gradle\` — extra Gradle dependencies
- \`manifest.xml\` — manifest additions
`,
  };

  switch (type) {
    case "helper": return helper;
    case "activity": return activity;
    case "full": return full;
    default: return blank;
  }
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD AS ZIP
// ═══════════════════════════════════════════════════════════════
async function downloadZip() {
  if (!currentModule) {
    showToast("No module to download");
    return;
  }

  // Persist open files first
  persistModule();

  const files = currentModule.files || {};
  const fileKeys = Object.keys(files).filter(p => !p.endsWith(".gitkeep"));

  if (fileKeys.length === 0) {
    showToast("⚠️ Module is empty — add some files first");
    return;
  }

  // Check for module.json (required)
  if (!files["module.json"]) {
    const proceed = confirm(
      "⚠️ This module has no module.json file.\n\n" +
      "Without module.json, the module won't work in the builder.\n\n" +
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
    a.download = `${currentModule.name || "module"}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const sizeKB = Math.round(blob.size / 1024);
    showToast(`✅ Downloaded: ${currentModule.name}.zip (${sizeKB} KB)`);
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
window.renameModule = renameModule;
window.saveModule = saveModule;
window.createNewFile = createNewFile;
window.createNewFolder = createNewFolder;
window.openTemplateModal = openTemplateModal;
window.closeTemplateModal = closeTemplateModal;
window.closeModal = closeModal;
window.confirmModal = confirmModal;
window.loadTemplate = loadTemplate;
