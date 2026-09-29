/* ═══════════════════════════════════════════════════════════════
   Code Editor — 7 Features + File Click Fix
   1. Import/Export JSON
   2. Version History
   3. File Search
   4. File Duplicate
   5. Unsaved Warning
   6. File Move
   7. Code Format
   ═══════════════════════════════════════════════════════════════ */

const PROJECTS_KEY = "builder_editor_modules";
const CURRENT_PROJECT_KEY = "builder_editor_current";
const HISTORY_KEY = "builder_editor_history";
const MAX_HISTORY = 20;

let allProjects = [];
let currentProject = null;
let openFiles = [];
let activeFile = null;
let cmEditor = null;
let modalMode = null;
let templateSelection = "blank";
let projectMenuTarget = null;
let projectSearchQuery = "";
let fileSearchQuery = "";
let renameTarget = null;
let moveTarget = null;
let activeFolder = "";
let historyCache = {};
let saveStatusTimer = null;

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  loadAllProjects();
  loadHistory();
  initCodeMirror();
  restoreLastProject();
  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();

  if (!currentProject) {
    setTimeout(() => createNewProject(), 300);
  } else if (currentProject.files && currentProject.files["module.json"] !== undefined) {
    setTimeout(() => openFile("module.json"), 150);
  }

  window.addEventListener("beforeunload", (e) => {
    if (openFiles.some(f => f.dirty)) {
      persistCurrentProject();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveProject();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n" && !e.shiftKey) {
      e.preventDefault();
      createNewFile();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "N" || e.key === "n")) {
      e.preventDefault();
      createNewProject();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      document.getElementById("fileSearch").focus();
    }
  });

  // Auto-save every 30s + auto-snapshot every 5 min
  setInterval(() => {
    if (currentProject && openFiles.some(f => f.dirty)) {
      persistCurrentProject();
    }
  }, 30000);

  setInterval(() => {
    if (currentProject) takeSnapshot("Auto-save");
  }, 300000);

  // Import file input handler
  const importInput = document.getElementById("importFileInput");
  if (importInput) importInput.addEventListener("change", handleImportFile);
});

/* ═══════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════ */
function loadAllProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) { allProjects = []; return; }
    allProjects = JSON.parse(raw);
    if (!Array.isArray(allProjects)) allProjects = [];
  } catch (e) {
    console.error("Load failed:", e);
    allProjects = [];
  }
}

function saveAllProjects() {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(allProjects));
  } catch (e) {
    console.error("Save failed:", e);
    showToast("⚠️ Storage full — export backup");
  }
}

function restoreLastProject() {
  if (allProjects.length === 0) return;
  const lastId = localStorage.getItem(CURRENT_PROJECT_KEY);
  let found = lastId ? allProjects.find(p => p.id === lastId) : null;
  if (!found) {
    const sorted = [...allProjects].sort((a, b) =>
      (b.lastOpenedAt || b.createdAt) - (a.lastOpenedAt || a.createdAt));
    found = sorted[0];
  }
  if (found) {
    currentProject = found;
    currentProject.lastOpenedAt = Date.now();
  }
}

function setCurrentProjectId(id) {
  localStorage.setItem(CURRENT_PROJECT_KEY, id);
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 1: VERSION HISTORY
   ═══════════════════════════════════════════════════════════════ */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    historyCache = raw ? JSON.parse(raw) : {};
    if (typeof historyCache !== "object" || historyCache === null) historyCache = {};
  } catch { historyCache = {}; }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache));
  } catch (e) {
    for (const pid of Object.keys(historyCache)) {
      if (historyCache[pid].length > 5) historyCache[pid] = historyCache[pid].slice(-5);
    }
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyCache)); } catch {}
  }
}

function takeSnapshot(note = "Auto-save", pid = null) {
  const projectId = pid || (currentProject && currentProject.id);
  if (!projectId) return;

  const project = allProjects.find(p => p.id === projectId);
  if (!project) return;

  if (currentProject && currentProject.id === projectId) {
    for (const file of openFiles) {
      currentProject.files[file.path] = file.content;
    }
  }

  const snapshot = {
    ts: Date.now(),
    note,
    files: JSON.parse(JSON.stringify(project.files || {})),
  };

  if (!historyCache[projectId]) historyCache[projectId] = [];
  historyCache[projectId].push(snapshot);

  if (historyCache[projectId].length > MAX_HISTORY) {
    historyCache[projectId] = historyCache[projectId].slice(-MAX_HISTORY);
  }

  saveHistory();
}

function showHistory() {
  if (!currentProject) { showToast("No project"); return; }

  const list = document.getElementById("historyList");
  const history = historyCache[currentProject.id] || [];

  if (history.length === 0) {
    list.innerHTML = `<div class="history-empty">No versions yet.<br>Save or edit to create snapshots.</div>`;
  } else {
    list.innerHTML = [...history].reverse().map((snap, idx) => {
      const realIdx = history.length - 1 - idx;
      const fileCount = Object.keys(snap.files || {}).filter(k => !k.endsWith(".gitkeep")).length;
      return `
        <div class="history-item" onclick="restoreHistory(${realIdx})">
          <div class="history-item-main">
            <div class="history-item-time">${relativeTime(snap.ts)}</div>
            <div class="history-item-note">${escapeHtml(snap.note)}</div>
          </div>
          <div class="history-item-meta">${fileCount} files</div>
        </div>
      `;
    }).join("");
  }

  document.getElementById("historyBackdrop").classList.add("show");
}

function closeHistory(e) {
  if (e && e.target !== document.getElementById("historyBackdrop")) return;
  document.getElementById("historyBackdrop").classList.remove("show");
}

function restoreHistory(idx) {
  if (!currentProject) return;
  const history = historyCache[currentProject.id] || [];
  const snap = history[idx];
  if (!snap) return;

  if (!confirm(`Restore version from ${relativeTime(snap.ts)}?\n\nCurrent changes will be saved as a new version first.`)) return;

  takeSnapshot("Before restore");

  currentProject.files = JSON.parse(JSON.stringify(snap.files));
  currentProject.updatedAt = Date.now();
  saveAllProjects();

  openFiles = [];
  activeFile = null;
  activeFolder = "";
  renderFileTree();
  renderTabs();

  if (currentProject.files["module.json"] !== undefined) {
    setTimeout(() => openFile("module.json"), 100);
  } else {
    cmEditor.setValue("");
    document.getElementById("filePathLabel").textContent = "—";
    document.getElementById("editorEmpty").classList.remove("hidden");
  }

  closeHistory();
  showToast("🕐 Restored: " + relativeTime(snap.ts));
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 2: IMPORT / EXPORT JSON
   ═══════════════════════════════════════════════════════════════ */
function exportAllProjects() {
  if (allProjects.length === 0) {
    showToast("⚠️ No projects to export");
    return;
  }

  persistCurrentProject();

  const exportData = {
    format: "lets-apk-builder-projects",
    version: 1,
    exportedAt: new Date().toISOString(),
    totalProjects: allProjects.length,
    projects: allProjects,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `lets-apk-projects-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  const sizeKB = Math.round(blob.size / 1024);
  showToast(`✅ Exported ${allProjects.length} projects (${sizeKB} KB)`);
}

function importAllProjects() {
  const input = document.getElementById("importFileInput");
  if (!input) return;
  input.value = "";
  input.click();
}

function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast("⚠️ File too large (max 5 MB)");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.projects)) {
        showToast("✗ Invalid file format");
        return;
      }

      window.__pendingImport = data.projects;
      document.getElementById("importHint").textContent =
        `Found ${data.projects.length} projects. How to import?`;
      document.getElementById("importBackdrop").classList.add("show");
    } catch (err) {
      showToast("✗ Parse error: " + err.message);
    }
  };
  reader.readAsText(file);
}

function closeImportModal(e) {
  if (e && e.target !== document.getElementById("importBackdrop")) return;
  document.getElementById("importBackdrop").classList.remove("show");
  window.__pendingImport = null;
}

function confirmImport(mode) {
  const imported = window.__pendingImport;
  if (!imported) return;

  persistCurrentProject();

  if (mode === "replace") {
    if (!confirm("⚠️ This will DELETE all existing projects. Continue?")) return;
    allProjects = imported;
  } else {
    const existingIds = new Set(allProjects.map(p => p.id));
    let added = 0;
    for (const proj of imported) {
      if (!proj || !proj.id || !proj.name || !proj.files) continue;
      if (existingIds.has(proj.id)) {
        proj.id = proj.id + "-imported-" + Date.now() + Math.floor(Math.random() * 1000);
        proj.name = proj.name + "-imported";
      }
      allProjects.push(proj);
      added++;
    }
    showToast(`✅ Imported ${added} new projects`);
  }

  saveAllProjects();
  closeImportModal();

  if (!allProjects.find(p => p.id === (currentProject && currentProject.id))) {
    currentProject = allProjects[0] || null;
    if (currentProject) {
      setCurrentProjectId(currentProject.id);
      currentProject.lastOpenedAt = Date.now();
    }
    openFiles = [];
    activeFile = null;
  }

  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();
  showToast("✅ Import complete");
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 3: FILE SEARCH
   ═══════════════════════════════════════════════════════════════ */
function filterFiles() {
  fileSearchQuery = (document.getElementById("fileSearch").value || "").trim().toLowerCase();
  renderFileTree();
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 4: FILE DUPLICATE
   ═══════════════════════════════════════════════════════════════ */
function duplicateFile(path) {
  if (!currentProject) return;

  const content = currentProject.files[path];
  if (content === undefined) return;

  const parts = path.split("/");
  const fileName = parts.pop();
  const folder = parts.join("/");
  const dotIdx = fileName.lastIndexOf(".");
  const baseName = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";

  let newName;
  let counter = 2;
  do {
    newName = `${baseName}-copy${counter === 2 ? "" : counter}${ext}`;
    counter++;
  } while (currentProject.files[folder ? folder + "/" + newName : newName] !== undefined);

  const newPath = folder ? folder + "/" + newName : newName;

  currentProject.files[newPath] = content;
  currentProject.updatedAt = Date.now();
  saveAllProjects();
  renderFileTree();
  showToast("📋 Duplicated: " + newName);
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 5: UNSAVED WARNING
   ═══════════════════════════════════════════════════════════════ */
function updateDirtyIndicator() {
  const hasDirty = openFiles.some(f => f.dirty);
  const indicator = document.getElementById("globalDirtyIndicator");
  if (indicator) indicator.style.display = hasDirty ? "inline" : "none";
  renderTabs();
}

function showSaveStatus(text) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  if (saveStatusTimer) clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => el.classList.add("hidden"), 2000);
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 6: FILE MOVE
   ═══════════════════════════════════════════════════════════════ */
function showMoveModal(path) {
  if (!currentProject) return;
  if (!currentProject.files[path]) return;

  moveTarget = path;

  const folders = new Set();
  folders.add("");
  for (const filePath of Object.keys(currentProject.files)) {
    const parts = filePath.split("/");
    if (parts.length > 1) folders.add(parts[0]);
  }

  const fileParts = path.split("/");
  const currentFolder = fileParts.length > 1 ? fileParts.slice(0, -1).join("/") : "";
  const fileName = fileParts[fileParts.length - 1];

  const picker = document.getElementById("folderPicker");
  const sortedFolders = Array.from(folders).sort();

  picker.innerHTML = sortedFolders.map(folder => {
    const isCurrent = folder === currentFolder;
    const label = folder === "" ? "🏠 Root" : `📁 ${folder}/`;
    return `
      <div class="folder-option ${isCurrent ? "selected" : ""}" onclick="moveFileTo('${escapeHtml(folder)}')">
        <span>${escapeHtml(label)}</span>
        ${isCurrent ? '<span style="margin-left:auto;font-size:11px;">current</span>' : ""}
      </div>
    `;
  }).join("");

  document.getElementById("moveHint").textContent = `Moving "${fileName}" — pick destination folder`;
  document.getElementById("moveBackdrop").classList.add("show");
}

function closeMoveModal(e) {
  if (e && e.target !== document.getElementById("moveBackdrop")) return;
  document.getElementById("moveBackdrop").classList.remove("show");
  moveTarget = null;
}

function moveFileTo(newFolder) {
  if (!currentProject || !moveTarget) return;

  const path = moveTarget;
  const fileParts = path.split("/");
  const fileName = fileParts[fileParts.length - 1];
  const currentFolder = fileParts.length > 1 ? fileParts.slice(0, -1).join("/") : "";

  if (currentFolder === newFolder) {
    closeMoveModal();
    return;
  }

  const newPath = newFolder ? newFolder + "/" + fileName : fileName;

  if (currentProject.files[newPath] !== undefined) {
    showToast("⚠️ A file with that name already exists in target folder");
    return;
  }

  currentProject.files[newPath] = currentProject.files[path];
  delete currentProject.files[path];
  currentProject.updatedAt = Date.now();

  for (const f of openFiles) {
    if (f.path === path) f.path = newPath;
  }
  if (activeFile === path) {
    activeFile = newPath;
    document.getElementById("filePathLabel").textContent = newPath;
  }

  saveAllProjects();
  renderFileTree();
  renderTabs();
  closeMoveModal();
  showToast(`📁 Moved to ${newFolder || "root"}`);
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 7: CODE FORMAT
   ═══════════════════════════════════════════════════════════════ */
function formatCode() {
  if (!activeFile) { showToast("No file open"); return; }
  const file = openFiles.find(f => f.path === activeFile);
  if (!file) return;

  const path = activeFile;
  const content = cmEditor.getValue();

  let formatted;
  try {
    if (path.endsWith(".json")) {
      formatted = JSON.stringify(JSON.parse(content), null, 2);
    } else if (path.endsWith(".xml")) {
      formatted = formatXml(content);
    } else if (path.endsWith(".kt") || path.endsWith(".java") || path.endsWith(".gradle")) {
      formatted = formatCurlies(content);
    } else {
      formatted = trimTrailingSpaces(content);
    }
  } catch (e) {
    showToast("⚠️ Could not format: " + e.message);
    return;
  }

  cmEditor.setValue(formatted);
  file.content = formatted;
  file.dirty = true;
  updateDirtyIndicator();
  showToast("✨ Formatted");
}

function formatXml(xml) {
  const trimmed = xml.trim();
  const lines = trimmed.replace(/>\s*</g, ">\n<").split("\n");
  let indent = 0;
  const result = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (/^<\//.test(line)) indent = Math.max(0, indent - 1);
    result.push("  ".repeat(indent) + line);
    if (/^<[^!?][^>]*[^\/]>$/.test(line) && !/<\/.*>$/.test(line)) {
      indent++;
    }
  }

  return result.join("\n");
}

function formatCurlies(code) {
  const lines = code.split("\n");
  const result = [];
  let indent = 0;
  const INDENT = "    ";

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) { result.push(""); continue; }

    if (/^[})]/.test(trimmed)) indent = Math.max(0, indent - 1);

    result.push(INDENT.repeat(indent) + trimmed);

    let opens = 0;
    let closes = 0;
    for (const ch of trimmed) {
      if (ch === "{" || ch === "(" || ch === "[") opens++;
      else if (ch === "}" || ch === ")" || ch === "]") closes++;
    }
    indent = Math.max(0, indent + opens - closes);
  }

  return result.join("\n");
}

function trimTrailingSpaces(text) {
  return text.split("\n").map(l => l.replace(/[ \t]+$/, "")).join("\n");
}

/* ═══════════════════════════════════════════════════════════════
   PROJECT CRUD
   ═══════════════════════════════════════════════════════════════ */
function createNewProject() {
  document.getElementById("newProjectName").value = "";
  templateSelection = "blank";
  document.querySelectorAll(".template-card").forEach(c => {
    c.classList.toggle("active", c.dataset.template === "blank");
  });
  document.getElementById("newProjectBackdrop").classList.add("show");
  setTimeout(() => document.getElementById("newProjectName").focus(), 150);
}

function closeNewProjectModal(e) {
  if (e && e.target !== document.getElementById("newProjectBackdrop")) return;
  document.getElementById("newProjectBackdrop").classList.remove("show");
}

function selectTemplate(el, type) {
  templateSelection = type;
  document.querySelectorAll(".template-card").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
}

function confirmNewProject() {
  const nameInput = document.getElementById("newProjectName");
  const name = nameInput.value.trim();
  if (!name) { showToast("⚠️ Enter a project name"); nameInput.focus(); return; }

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const id = safeName + "-" + Date.now();
  const files = getTemplateFiles(templateSelection, safeName);

  persistCurrentProject();

  const newProject = {
    id, name: safeName, files,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };

  allProjects.push(newProject);
  saveAllProjects();
  setCurrentProjectId(id);

  currentProject = newProject;
  openFiles = [];
  activeFile = null;
  activeFolder = "";
  fileSearchQuery = "";
  const fs = document.getElementById("fileSearch");
  if (fs) fs.value = "";

  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();
  updateDirtyIndicator();
  document.getElementById("editorEmpty").classList.remove("hidden");

  const firstFile = Object.keys(files)[0];
  if (firstFile) setTimeout(() => openFile(firstFile), 100);

  closeNewProjectModal();
  showToast("✅ Created: " + safeName);
}

function switchProject(id) {
  if (currentProject && currentProject.id === id) return;
  persistCurrentProject();

  const target = allProjects.find(p => p.id === id);
  if (!target) { showToast("⚠️ Not found"); return; }

  currentProject = target;
  currentProject.lastOpenedAt = Date.now();
  setCurrentProjectId(id);
  openFiles = [];
  activeFile = null;
  activeFolder = "";
  fileSearchQuery = "";
  const fs = document.getElementById("fileSearch");
  if (fs) fs.value = "";

  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();
  updateDirtyIndicator();

  if (currentProject.files && currentProject.files["module.json"] !== undefined) {
    setTimeout(() => openFile("module.json"), 100);
  } else {
    document.getElementById("editorEmpty").classList.remove("hidden");
    cmEditor.setValue("");
    document.getElementById("filePathLabel").textContent = "—";
  }

  showToast("📂 Opened: " + currentProject.name);
}

function renameProject() {
  if (!currentProject) { showToast("No project"); return; }
  const newName = prompt("Rename project:", currentProject.name);
  if (!newName || newName === currentProject.name) return;

  const safeName = newName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  currentProject.name = safeName;
  currentProject.updatedAt = Date.now();
  saveAllProjects();
  renderProjectList();
  updateProjectLabel();
  showToast("✏️ Renamed to: " + safeName);
}

function deleteProject(id) {
  const project = allProjects.find(p => p.id === id);
  if (!project) return;
  if (!confirm(`Delete project "${project.name}"?\n\nThis cannot be undone.`)) return;

  allProjects = allProjects.filter(p => p.id !== id);
  if (historyCache[id]) {
    delete historyCache[id];
    saveHistory();
  }
  saveAllProjects();

  if (currentProject && currentProject.id === id) {
    currentProject = allProjects[0] || null;
    openFiles = [];
    activeFile = null;
    activeFolder = "";
    if (currentProject) {
      setCurrentProjectId(currentProject.id);
      currentProject.lastOpenedAt = Date.now();
      if (currentProject.files && currentProject.files["module.json"] !== undefined) {
        setTimeout(() => openFile("module.json"), 100);
      }
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
      cmEditor.setValue("");
      document.getElementById("filePathLabel").textContent = "—";
      document.getElementById("editorEmpty").classList.remove("hidden");
    }
  }

  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();
  updateDirtyIndicator();
  showToast("🗑️ Deleted: " + project.name);
}

function duplicateProject(id) {
  const src = allProjects.find(p => p.id === id);
  if (!src) return;

  const copy = JSON.parse(JSON.stringify(src));
  copy.id = src.name + "-copy-" + Date.now();
  copy.name = src.name + "-copy";
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.lastOpenedAt = Date.now();

  allProjects.push(copy);
  saveAllProjects();
  renderProjectList();
  showToast("📋 Duplicated: " + copy.name);
}

/* ═══════════════════════════════════════════════════════════════
   PROJECT MENU
   ═══════════════════════════════════════════════════════════════ */
function showProjectMenu(id, evt) {
  if (evt) evt.stopPropagation();
  projectMenuTarget = id;
  const project = allProjects.find(p => p.id === id);
  if (!project) return;
  document.getElementById("projectMenuTitle").textContent = "Project: " + project.name;
  document.getElementById("projectMenuBackdrop").classList.add("show");
}

function closeProjectMenu(e) {
  if (e && e.target !== document.getElementById("projectMenuBackdrop")) return;
  document.getElementById("projectMenuBackdrop").classList.remove("show");
  projectMenuTarget = null;
}

function menuRename() {
  const id = projectMenuTarget;
  closeProjectMenu();
  if (!id) return;
  const target = allProjects.find(p => p.id === id);
  if (!target) return;
  const newName = prompt("Rename project:", target.name);
  if (!newName || newName === target.name) return;
  target.name = newName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  target.updatedAt = Date.now();
  saveAllProjects();
  renderProjectList();
  if (currentProject && currentProject.id === id) updateProjectLabel();
  showToast("✏️ Renamed");
}

function menuDuplicate() { const id = projectMenuTarget; closeProjectMenu(); if (id) duplicateProject(id); }
function menuDownload() { const id = projectMenuTarget; closeProjectMenu(); if (!id) return; const t = allProjects.find(p => p.id === id); if (t) downloadProjectZip(t); }
function menuDelete() { const id = projectMenuTarget; closeProjectMenu(); if (id) deleteProject(id); }

/* ═══════════════════════════════════════════════════════════════
   TOOLS MENU
   ═══════════════════════════════════════════════════════════════ */
function showToolsMenu() {
  document.getElementById("toolsMenuBackdrop").classList.add("show");
}

function closeToolsMenu(e) {
  if (e && e.target !== document.getElementById("toolsMenuBackdrop")) return;
  document.getElementById("toolsMenuBackdrop").classList.remove("show");
}

function menuRenameCurrentProject() { closeToolsMenu(); renameProject(); }
function menuDuplicateCurrentProject() { closeToolsMenu(); if (currentProject) duplicateProject(currentProject.id); }
function menuFormatCurrentFile() { closeToolsMenu(); formatCode(); }
function menuExportAll() { closeToolsMenu(); exportAllProjects(); }
function menuImportAll() { closeToolsMenu(); importAllProjects(); }
function menuDownloadCurrent() { closeToolsMenu(); downloadZip(); }
function menuDeleteCurrentProject() { closeToolsMenu(); if (currentProject) deleteProject(currentProject.id); }

/* ═══════════════════════════════════════════════════════════════
   FILE MENU
   ═══════════════════════════════════════════════════════════════ */
function showFileMenu(path, evt) {
  if (evt) evt.stopPropagation();
  moveTarget = path;
  const fileName = path.split("/").pop();
  document.getElementById("fileMenuTitle").textContent = "File: " + fileName;
  document.getElementById("fileMenuBackdrop").classList.add("show");
}

function closeFileMenu(e) {
  if (e && e.target !== document.getElementById("fileMenuBackdrop")) return;
  document.getElementById("fileMenuBackdrop").classList.remove("show");
}

function fileMenuRename() {
  const path = moveTarget;
  closeFileMenu();
  if (path) renameFile(path);
}
function fileMenuDuplicate() {
  const path = moveTarget;
  closeFileMenu();
  if (path) duplicateFile(path);
}
function fileMenuMove() {
  const path = moveTarget;
  closeFileMenu();
  if (path) showMoveModal(path);
}
function fileMenuDelete() {
  const path = moveTarget;
  closeFileMenu();
  if (path) deleteFile(path);
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — PROJECTS
   ═══════════════════════════════════════════════════════════════ */
function renderProjectList() {
  const list = document.getElementById("projectList");
  if (!list) return;

  let projects = [...allProjects];
  if (projectSearchQuery) {
    const q = projectSearchQuery.toLowerCase();
    projects = projects.filter(p => p.name.toLowerCase().includes(q));
  }
  projects.sort((a, b) =>
    (b.lastOpenedAt || b.createdAt) - (a.lastOpenedAt || a.createdAt));

  if (projects.length === 0) {
    list.innerHTML = `<div class="project-empty">${projectSearchQuery ? "No matches" : "No projects yet"}</div>`;
    return;
  }

  list.innerHTML = projects.map(p => {
    const isActive = currentProject && currentProject.id === p.id;
    const fileCount = Object.keys(p.files || {}).filter(k => !k.endsWith(".gitkeep")).length;
    const timeAgo = relativeTime(p.updatedAt || p.createdAt);
    return `
      <div class="project-card ${isActive ? "active" : ""}" onclick="switchProject('${p.id}')">
        <div class="project-card-main">
          <div class="project-card-name">${escapeHtml(p.name)}</div>
          <div class="project-card-meta">${fileCount} file${fileCount !== 1 ? "s" : ""} · ${timeAgo}</div>
        </div>
        <button class="project-card-menu" onclick="showProjectMenu('${p.id}', event)" title="More">⋯</button>
      </div>
    `;
  }).join("");
}

function filterProjects() {
  projectSearchQuery = document.getElementById("projectSearch").value.trim();
  renderProjectList();
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — FILE TREE (with CLICK FIX)
   ═══════════════════════════════════════════════════════════════ */
function renderFileTree() {
  const tree = document.getElementById("fileTree");
  if (!tree) return;
  if (!currentProject) { tree.innerHTML = ""; updateBreadcrumb(); return; }

  let files = Object.keys(currentProject.files || {}).sort();

  if (fileSearchQuery) {
    files = files.filter(path => path.toLowerCase().includes(fileSearchQuery));
    if (files.length === 0) {
      tree.innerHTML = `<div class="project-empty">No files match "${escapeHtml(fileSearchQuery)}"</div>`;
      return;
    }
  }

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

  const folderNames = Object.keys(folders).sort();
  let html = "";

  // Root files
  for (const path of rootFiles) {
    html += renderFileItem(path, 0);
  }

  // Folders + their files
  for (const folder of folderNames) {
    const isActive = activeFolder === folder;
    const folderFiles = folders[folder].sort();
    const visibleCount = folderFiles.filter(p => !p.endsWith(".gitkeep")).length;

    html += `
      <div class="file-folder-row ${isActive ? "active" : ""}" onclick="enterFolder('${escapeHtml(folder)}')">
        <span class="folder-label">📁 ${escapeHtml(folder)}</span>
        <span class="folder-count">${visibleCount}</span>
        <button class="folder-action" onclick="renameFolder('${escapeHtml(folder)}', event)" title="Rename">✏️</button>
      </div>
    `;

    for (const path of folderFiles) {
      if (path.endsWith(".gitkeep")) continue;
      const parts = path.split("/");
      if (parts.length === 2) {
        html += renderFileItem(path, 1);
      }
    }
  }

  tree.innerHTML = html;
  updateBreadcrumb();

  // ⭐ CRITICAL FIX: Attach click listeners to file items
  tree.querySelectorAll(".file-item").forEach(el => {
    el.addEventListener("click", (e) => {
      // Ignore if clicked on action button
      if (e.target.closest(".file-action")) return;
      e.stopPropagation();
      const path = el.dataset.path;
      if (path) openFile(path);
    });
  });
}

function renderFileItem(path, depth = 0) {
  const isActive = path === activeFile ? "active" : "";
  const icon = getFileIcon(path);
  const fileName = path.split("/").pop();
  const indent = depth > 0 ? "padding-left:18px;" : "";

  return `
    <div class="file-item ${isActive}" data-path="${escapeHtml(path)}" style="${indent}">
      <span class="file-icon">${icon}</span>
      <span class="file-name">${escapeHtml(fileName)}</span>
      <button class="file-action" onclick="showFileMenu('${escapeHtml(path)}', event)" title="Actions">⋯</button>
    </div>`;
}

function updateBreadcrumb() {
  const crumb = document.getElementById("folderBreadcrumb");
  const pathEl = document.getElementById("breadcrumbPath");
  if (!crumb || !pathEl) return;

  if (activeFolder) {
    crumb.style.display = "flex";
    pathEl.textContent = activeFolder + "/";
  } else {
    crumb.style.display = "none";
  }
}

/* ═══════════════════════════════════════════════════════════════
   FOLDER CONTEXT
   ═══════════════════════════════════════════════════════════════ */
function enterFolder(folder) {
  if (activeFolder === folder) {
    activeFolder = "";
  } else {
    activeFolder = folder;
    showToast("📂 Inside: " + folder + "/");
  }
  renderFileTree();
}

function goToRoot() {
  activeFolder = "";
  renderFileTree();
  showToast("🏠 Back to root");
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — TABS
   ═══════════════════════════════════════════════════════════════ */
function renderTabs() {
  const tabs = document.getElementById("editorTabs");
  if (!tabs) return;
  tabs.innerHTML = openFiles.map(f => `
    <div class="editor-tab ${f.path === activeFile ? "active" : ""}" data-path="${escapeHtml(f.path)}">
      <span>${escapeHtml(f.path.split("/").pop())}</span>
      ${f.dirty ? '<span class="tab-dot">●</span>' : ""}
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

function updateProjectLabel() {
  document.getElementById("moduleNameLabel").textContent =
    currentProject ? currentProject.name : "untitled-project";
}

/* ═══════════════════════════════════════════════════════════════
   CODEMIRROR
   ═══════════════════════════════════════════════════════════════ */
function initCodeMirror() {
  const textarea = document.getElementById("codeArea");
  if (!textarea) return;
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
        if (!file.dirty) { file.dirty = true; updateDirtyIndicator(); }
      }
    }
  });

  cmEditor.on("cursorActivity", () => {
    const pos = cmEditor.getCursor();
    document.getElementById("cursorPos").textContent = `Ln ${pos.line + 1}, Col ${pos.ch + 1}`;
  });
}

function setEditorMode(path) {
  let mode = "text/plain";
  if (path.endsWith(".kt") || path.endsWith(".java")) mode = "text/x-kotlin";
  else if (path.endsWith(".xml")) mode = "application/xml";
  else if (path.endsWith(".json")) mode = "application/json";
  else if (path.endsWith(".gradle")) mode = "text/x-groovy";
  else if (path.endsWith(".js")) mode = "text/javascript";
  cmEditor.setOption("mode", mode);
}

/* ═══════════════════════════════════════════════════════════════
   FILE OPERATIONS
   ═══════════════════════════════════════════════════════════════ */
function openFile(path) {
  if (!currentProject) return;
  if (currentProject.files[path] === undefined) {
    console.warn("File not found:", path);
    return;
  }
  let file = openFiles.find(f => f.path === path);
  if (!file) {
    file = { path, content: currentProject.files[path] || "", dirty: false };
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

function closeTab(path) {
  const idx = openFiles.findIndex(f => f.path === path);
  if (idx === -1) return;
  const file = openFiles[idx];
  if (file.dirty) {
    currentProject.files[file.path] = file.content;
    saveAllProjects();
  }
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
  updateDirtyIndicator();
  renderTabs();
  renderFileTree();
}

function createNewFile() {
  if (!currentProject) { createNewProject(); return; }
  modalMode = "file";
  let hint = activeFolder
    ? `📂 Creating inside "${activeFolder}/" — just type the filename`
    : "Use / for subfolders (e.g. layout/main.xml) or tap a folder first";
  showModal("New File", "filename.kt", hint);
}

function createNewFolder() {
  if (!currentProject) { createNewProject(); return; }
  modalMode = "folder";
  let hint = activeFolder
    ? `📂 Creating subfolder inside "${activeFolder}/"`
    : "Top-level folder name (no slashes)";
  showModal("New Folder", "folder-name", hint);
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
    let fullPath = value;
    if (activeFolder && !value.startsWith(activeFolder + "/")) {
      fullPath = activeFolder + "/" + value;
    }
    if (currentProject.files[fullPath] !== undefined) {
      showToast("⚠️ File already exists"); return;
    }
    currentProject.files[fullPath] = "";
    currentProject.updatedAt = Date.now();
    saveAllProjects();
    renderFileTree();
    closeModal();
    setTimeout(() => openFile(fullPath), 100);
    showToast("✅ Created: " + fullPath);
  } else if (modalMode === "folder") {
    let folderName = value.replace(/\/+$/, "");
    let fullFolderPath = folderName;
    if (activeFolder && !folderName.startsWith(activeFolder + "/")) {
      fullFolderPath = activeFolder + "/" + folderName;
    }
    const placeholderFile = fullFolderPath + "/.gitkeep";
    if (currentProject.files[placeholderFile] !== undefined) {
      showToast("⚠️ Folder already exists"); return;
    }
    currentProject.files[placeholderFile] = "";
    currentProject.updatedAt = Date.now();
    saveAllProjects();
    renderFileTree();
    closeModal();
    showToast("📁 Created: " + fullFolderPath);
  }
}

document.addEventListener("keydown", (e) => {
  if (document.getElementById("modalBackdrop").classList.contains("show")) {
    if (e.key === "Enter") confirmModal();
    if (e.key === "Escape") closeModal();
  }
  if (document.getElementById("renameBackdrop").classList.contains("show")) {
    if (e.key === "Enter") confirmRename();
    if (e.key === "Escape") closeRenameModal();
  }
  if (document.getElementById("newProjectBackdrop").classList.contains("show")) {
    if (e.key === "Enter") confirmNewProject();
    if (e.key === "Escape") closeNewProjectModal();
  }
});

/* ═══════════════════════════════════════════════════════════════
   RENAME FILE / FOLDER
   ═══════════════════════════════════════════════════════════════ */
function renameFile(path, evt) {
  if (evt) evt.stopPropagation();
  if (!currentProject) return;
  const fileName = path.split("/").pop();
  renameTarget = { type: "file", path };
  document.getElementById("renameTitle").textContent = "✏️ Rename File";
  document.getElementById("renameHint").textContent = `Current: ${path}`;
  const input = document.getElementById("renameInput");
  input.value = fileName;
  input.placeholder = "new-filename.kt";
  document.getElementById("renameBackdrop").classList.add("show");
  setTimeout(() => { input.focus(); input.select(); }, 100);
}

function renameFolder(folderName, evt) {
  if (evt) evt.stopPropagation();
  if (!currentProject) return;
  renameTarget = { type: "folder", path: folderName };
  document.getElementById("renameTitle").textContent = "✏️ Rename Folder";
  document.getElementById("renameHint").textContent = `Current: ${folderName}/ (all files inside will be moved)`;
  const input = document.getElementById("renameInput");
  input.value = folderName;
  input.placeholder = "new-folder-name";
  document.getElementById("renameBackdrop").classList.add("show");
  setTimeout(() => { input.focus(); input.select(); }, 100);
}

function closeRenameModal(e) {
  if (e && e.target !== document.getElementById("renameBackdrop")) return;
  document.getElementById("renameBackdrop").classList.remove("show");
  renameTarget = null;
}

function confirmRename() {
  const input = document.getElementById("renameInput");
  const newName = input.value.trim();
  if (!newName || !renameTarget) return;
  const target = renameTarget;
  if (target.type === "file") performFileRename(target.path, newName);
  else performFolderRename(target.path, newName);
  closeRenameModal();
}

function performFileRename(oldPath, newName) {
  if (!currentProject) return;
  const safeName = newName.replace(/[<>:"|?*\\]/g, "").trim();
  if (!safeName) { showToast("⚠️ Invalid name"); return; }
  const parts = oldPath.split("/");
  parts[parts.length - 1] = safeName;
  const newPath = parts.join("/");
  if (newPath === oldPath) return;
  if (currentProject.files[newPath] !== undefined) {
    showToast("⚠️ A file with that name already exists"); return;
  }
  currentProject.files[newPath] = currentProject.files[oldPath];
  delete currentProject.files[oldPath];
  for (const f of openFiles) if (f.path === oldPath) f.path = newPath;
  if (activeFile === oldPath) {
    activeFile = newPath;
    document.getElementById("filePathLabel").textContent = newPath;
  }
  currentProject.updatedAt = Date.now();
  saveAllProjects();
  renderFileTree();
  renderTabs();
  showToast("✏️ Renamed: " + safeName);
}

function performFolderRename(oldFolder, newName) {
  if (!currentProject) return;
  const safeName = newName.replace(/[<>:"|?*\\/]/g, "").trim();
  if (!safeName || safeName === oldFolder) return;
  if (safeName.includes("/")) { showToast("⚠️ No slashes"); return; }
  const prefix = oldFolder + "/";
  const toMove = [];
  for (const path of Object.keys(currentProject.files)) {
    if (path.startsWith(prefix) || path === oldFolder + "/.gitkeep") {
      toMove.push({ oldPath: path, newPath: safeName + "/" + path.slice(prefix.length) });
    }
  }
  if (toMove.length === 0) { showToast("⚠️ No files to move"); return; }
  for (const { newPath } of toMove) {
    if (currentProject.files[newPath] !== undefined) {
      showToast("⚠️ Conflict: " + newPath); return;
    }
  }
  for (const { oldPath, newPath } of toMove) {
    currentProject.files[newPath] = currentProject.files[oldPath];
    delete currentProject.files[oldPath];
  }
  for (const f of openFiles) {
    const m = toMove.find(x => x.oldPath === f.path);
    if (m) f.path = m.newPath;
  }
  const am = toMove.find(x => x.oldPath === activeFile);
  if (am) {
    activeFile = am.newPath;
    document.getElementById("filePathLabel").textContent = am.newPath;
  }
  if (activeFolder === oldFolder) activeFolder = safeName;
  currentProject.updatedAt = Date.now();
  saveAllProjects();
  renderFileTree();
  renderTabs();
  showToast(`✏️ Renamed: ${oldFolder}/ → ${safeName}/`);
}

function deleteFile(path, evt) {
  if (evt) evt.stopPropagation();
  if (!currentProject) return;
  if (!confirm(`Delete "${path}"?`)) return;
  delete currentProject.files[path];
  currentProject.updatedAt = Date.now();
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
  saveAllProjects();
  updateDirtyIndicator();
  renderFileTree();
  renderTabs();
  showToast("🗑️ Deleted: " + path);
}

/* ═══════════════════════════════════════════════════════════════
   PERSIST
   ═══════════════════════════════════════════════════════════════ */
function persistCurrentProject() {
  if (!currentProject) return;
  let hadChanges = false;
  for (const file of openFiles) {
    if (file.dirty) {
      currentProject.files[file.path] = file.content;
      file.dirty = false;
      hadChanges = true;
    }
  }
  currentProject.updatedAt = Date.now();
  saveAllProjects();
  if (hadChanges) updateDirtyIndicator();
}

function saveProject() {
  if (!currentProject) { showToast("No project to save"); return; }
  persistCurrentProject();
  takeSnapshot("Manual save");
  renderTabs();
  showSaveStatus("✓ Saved " + new Date().toLocaleTimeString());
  showToast("💾 Saved: " + currentProject.name);
}

/* ═══════════════════════════════════════════════════════════════
   DOWNLOAD ZIP
   ═══════════════════════════════════════════════════════════════ */
async function downloadZip() {
  if (!currentProject) { showToast("No project"); return; }
  persistCurrentProject();
  await downloadProjectZip(currentProject);
}

async function downloadProjectZip(project) {
  const files = project.files || {};
  const fileKeys = Object.keys(files).filter(p => !p.endsWith(".gitkeep"));
  if (fileKeys.length === 0) { showToast("⚠️ Project is empty"); return; }
  try {
    showToast("⏳ Building ZIP…");
    const zip = new JSZip();
    for (const path of fileKeys) zip.file(path, files[path] || "");
    const blob = await zip.generateAsync({
      type: "blob", compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "project"}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const sizeKB = Math.round(blob.size / 1024);
    showToast(`✅ Downloaded: ${project.name}.zip (${sizeKB} KB)`);
  } catch (err) {
    console.error(err);
    showToast("✗ Failed: " + err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATES
   ═══════════════════════════════════════════════════════════════ */
function getTemplateFiles(type, name) {
  const moduleJson = JSON.stringify({
    name, version: "1.0.0",
    author: "admin@letssecuredo.com",
    description: "Custom module: " + name,
    isMain: false, minSdk: 21,
  }, null, 2);

  const blank = { "module.json": moduleJson };

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
`,
  };

  return { blank, helper, activity, full }[type] || blank;
}

/* ═══════════════════════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════════════════════ */
function relativeTime(ts) {
  if (!ts) return "just now";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  }[c] || c));
}

function getFileIcon(path) {
  if (path.endsWith(".kt")) return "🟣";
  if (path.endsWith(".java")) return "🟠";
  if (path.endsWith(".xml")) return "🔵";
  if (path.endsWith(".json")) return "🟡";
  if (path.endsWith(".gradle")) return "🟢";
  if (path.endsWith(".png") || path.endsWith(".jpg")) return "🖼️";
  if (path.endsWith(".md")) return "📝";
  return "📄";
}

let toastTimer = null;
function showToast(message, duration = 2000) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

/* ═══════════════════════════════════════════════════════════════
   EXPOSE GLOBALS
   ═══════════════════════════════════════════════════════════════ */
window.createNewProject = createNewProject;
window.closeNewProjectModal = closeNewProjectModal;
window.selectTemplate = selectTemplate;
window.confirmNewProject = confirmNewProject;
window.switchProject = switchProject;
window.renameProject = renameProject;
window.deleteProject = deleteProject;
window.duplicateProject = duplicateProject;
window.showProjectMenu = showProjectMenu;
window.closeProjectMenu = closeProjectMenu;
window.menuRename = menuRename;
window.menuDuplicate = menuDuplicate;
window.menuDownload = menuDownload;
window.menuDelete = menuDelete;
window.filterProjects = filterProjects;
window.createNewFile = createNewFile;
window.createNewFolder = createNewFolder;
window.closeModal = closeModal;
window.confirmModal = confirmModal;
window.saveProject = saveProject;
window.downloadZip = downloadZip;
window.renameFile = renameFile;
window.renameFolder = renameFolder;
window.closeRenameModal = closeRenameModal;
window.confirmRename = confirmRename;
window.enterFolder = enterFolder;
window.goToRoot = goToRoot;
window.formatCode = formatCode;
window.showHistory = showHistory;
window.closeHistory = closeHistory;
window.restoreHistory = restoreHistory;
window.showToolsMenu = showToolsMenu;
window.closeToolsMenu = closeToolsMenu;
window.menuRenameCurrentProject = menuRenameCurrentProject;
window.menuDuplicateCurrentProject = menuDuplicateCurrentProject;
window.menuFormatCurrentFile = menuFormatCurrentFile;
window.menuExportAll = menuExportAll;
window.menuImportAll = menuImportAll;
window.menuDownloadCurrent = menuDownloadCurrent;
window.menuDeleteCurrentProject = menuDeleteCurrentProject;
window.exportAllProjects = exportAllProjects;
window.importAllProjects = importAllProjects;
window.confirmImport = confirmImport;
window.closeImportModal = closeImportModal;
window.showFileMenu = showFileMenu;
window.closeFileMenu = closeFileMenu;
window.fileMenuRename = fileMenuRename;
window.fileMenuDuplicate = fileMenuDuplicate;
window.fileMenuMove = fileMenuMove;
window.fileMenuDelete = fileMenuDelete;
window.showMoveModal = showMoveModal;
window.closeMoveModal = closeMoveModal;
window.moveFileTo = moveFileTo;
window.filterFiles = filterFiles;
window.duplicateFile = duplicateFile;

// Core file operations (fix)
window.openFile = openFile;
window.closeTab = closeTab;
window.deleteFile = deleteFile;
window.persistCurrentProject = persistCurrentProject;
