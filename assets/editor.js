/* ═══════════════════════════════════════════════════════════════
   Code Editor — Multi-Project + Rename + Folder Context
   ═══════════════════════════════════════════════════════════════ */

const PROJECTS_KEY = "builder_editor_modules";
const CURRENT_PROJECT_KEY = "builder_editor_current";

let allProjects = [];
let currentProject = null;
let openFiles = [];
let activeFile = null;
let cmEditor = null;
let modalMode = null;
let templateSelection = "blank";
let projectMenuTarget = null;
let projectSearchQuery = "";

// Rename state
let renameTarget = null;  // { type: "file" | "folder", path: string }

// Folder context (current folder we're "inside")
let activeFolder = "";

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  loadAllProjects();
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

  window.addEventListener("beforeunload", () => {
    if (openFiles.some(f => f.dirty)) persistCurrentProject();
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
  });

  setInterval(() => {
    if (currentProject && openFiles.some(f => f.dirty)) persistCurrentProject();
  }, 30000);
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
    console.error("Failed to load:", e);
    allProjects = [];
  }
}

function saveAllProjects() {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(allProjects));
  } catch (e) {
    console.error("Failed to save:", e);
    showToast("⚠️ Storage full");
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
  if (!name) {
    showToast("⚠️ Enter a project name");
    nameInput.focus();
    return;
  }
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const id = safeName + "-" + Date.now();
  const files = getTemplateFiles(templateSelection, safeName);

  const newProject = {
    id, name: safeName, files,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };

  allProjects.push(newProject);
  saveAllProjects();
  persistCurrentProject();

  currentProject = newProject;
  setCurrentProjectId(id);
  openFiles = [];
  activeFile = null;
  activeFolder = "";

  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();
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

  renderProjectList();
  renderFileTree();
  renderTabs();
  updateProjectLabel();

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

function menuDuplicate() {
  const id = projectMenuTarget;
  closeProjectMenu();
  if (id) duplicateProject(id);
}

function menuDownload() {
  const id = projectMenuTarget;
  closeProjectMenu();
  if (!id) return;
  const target = allProjects.find(p => p.id === id);
  if (target) downloadProjectZip(target);
}

function menuDelete() {
  const id = projectMenuTarget;
  closeProjectMenu();
  if (id) deleteProject(id);
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
   RENDER — FILE TREE
   ═══════════════════════════════════════════════════════════════ */
function renderFileTree() {
  const tree = document.getElementById("fileTree");
  if (!tree) return;
  if (!currentProject) {
    tree.innerHTML = "";
    updateBreadcrumb();
    return;
  }

  const files = Object.keys(currentProject.files || {}).sort();
  if (files.length === 0) {
    tree.innerHTML = "";
    updateBreadcrumb();
    return;
  }

  // Group by top-level folder or root file
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

  // Sort folder names
  const folderNames = Object.keys(folders).sort();

  let html = "";

  // Root files first
  for (const path of rootFiles) {
    html += renderFileItem(path, 0);
  }

  // Then folders
  for (const folder of folderNames) {
    const isActive = activeFolder === folder;
    const folderFiles = folders[folder].sort();
    const visibleCount = folderFiles.filter(p => !p.endsWith(".gitkeep")).length;

    html += `
      <div class="file-folder-row ${isActive ? "active" : ""}" onclick="enterFolder('${escapeHtml(folder)}')">
        <span class="folder-label">📁 ${escapeHtml(folder)}</span>
        <span class="folder-count">${visibleCount}</span>
        <button class="folder-action" onclick="renameFolder('${escapeHtml(folder)}', event)" title="Rename folder">✏️</button>
      </div>
    `;

    // Show files in this folder
    for (const path of folderFiles) {
      if (path.endsWith(".gitkeep")) continue;
      // Show only files directly in this folder (not nested deeper)
      const parts = path.split("/");
      if (parts.length === 2) {
        html += renderFileItem(path, 1);
      }
    }
  }

  tree.innerHTML = html;
  updateBreadcrumb();
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
      <button class="file-action rename" onclick="renameFile('${escapeHtml(path)}', event)" title="Rename">✏️</button>
      <button class="file-action delete" onclick="deleteFile('${escapeHtml(path)}', event)" title="Delete">✕</button>
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
    // Toggle off — exit folder
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

function updateProjectLabel() {
  document.getElementById("moduleNameLabel").textContent =
    currentProject ? currentProject.name : "untitled-project";
}

/* ═══════════════════════════════════════════════════════════════
   CODEMIRROR
   ═══════════════════════════════════════════════════════════════ */
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
        if (!file.dirty) { file.dirty = true; renderTabs(); }
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
  renderTabs();
  renderFileTree();
}

/* ═══════════════════════════════════════════════════════════════
   CREATE FILE / FOLDER (context-aware)
   ═══════════════════════════════════════════════════════════════ */
function createNewFile() {
  if (!currentProject) { createNewProject(); return; }
  modalMode = "file";

  let placeholder = "filename.kt";
  let hint;
  if (activeFolder) {
    placeholder = "filename.kt";
    hint = `📂 Creating inside "${activeFolder}/" — just type the filename. Use / for subfolder (e.g. sub/file.kt)`;
  } else {
    hint = "Use / for subfolders (e.g. layout/main.xml) or tap a folder first to enter it";
  }

  showModal("New File", placeholder, hint);
}

function createNewFolder() {
  if (!currentProject) { createNewProject(); return; }
  modalMode = "folder";

  let hint;
  if (activeFolder) {
    hint = `📂 Creating subfolder inside "${activeFolder}/" — type subfolder name`;
  } else {
    hint = "Top-level folder name (no slashes)";
  }

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
    // ⭐ Context-aware: prepend active folder
    let fullPath = value;
    if (activeFolder && !value.startsWith(activeFolder + "/")) {
      fullPath = activeFolder + "/" + value;
    }

    if (currentProject.files[fullPath] !== undefined) {
      showToast("⚠️ File already exists: " + fullPath); return;
    }
    currentProject.files[fullPath] = "";
    currentProject.updatedAt = Date.now();
    saveAllProjects();
    renderFileTree();
    closeModal();
    setTimeout(() => openFile(fullPath), 100);
    showToast("✅ Created: " + fullPath);
  } else if (modalMode === "folder") {
    // ⭐ Context-aware: prepend active folder for subfolder
    let folderName = value.replace(/\/+$/, "");
    let fullFolderPath = folderName;
    if (activeFolder && !folderName.startsWith(activeFolder + "/")) {
      fullFolderPath = activeFolder + "/" + folderName;
    }

    const placeholderFile = fullFolderPath + "/.gitkeep";
    if (currentProject.files[placeholderFile] !== undefined) {
      showToast("⚠️ Folder already exists: " + fullFolderPath); return;
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

  if (target.type === "file") {
    performFileRename(target.path, newName);
  } else {
    performFolderRename(target.path, newName);
  }

  closeRenameModal();
}

function performFileRename(oldPath, newName) {
  if (!currentProject) return;

  // Sanitize
  const safeName = newName.replace(/[<>:"|?*\\]/g, "").trim();
  if (!safeName) { showToast("⚠️ Invalid name"); return; }

  // Determine new full path
  const parts = oldPath.split("/");
  parts[parts.length - 1] = safeName;
  const newPath = parts.join("/");

  if (newPath === oldPath) return;
  if (currentProject.files[newPath] !== undefined) {
    showToast("⚠️ A file with that name already exists"); return;
  }

  // Move content
  currentProject.files[newPath] = currentProject.files[oldPath];
  delete currentProject.files[oldPath];

  // Update open tabs
  for (const f of openFiles) {
    if (f.path === oldPath) f.path = newPath;
  }
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

  // Sanitize
  const safeName = newName.replace(/[<>:"|?*\\/]/g, "").trim();
  if (!safeName) { showToast("⚠️ Invalid name"); return; }
  if (safeName === oldFolder) return;

  if (safeName.includes("/")) {
    showToast("⚠️ Folder name can't contain slashes"); return;
  }

  // Find all files under this folder
  const prefix = oldFolder + "/";
  const toMove = [];
  for (const path of Object.keys(currentProject.files)) {
    if (path.startsWith(prefix) || path === oldFolder + "/.gitkeep") {
      const remainder = path.slice(prefix.length);
      toMove.push({
        oldPath: path,
        newPath: safeName + "/" + remainder,
      });
    }
  }

  if (toMove.length === 0) {
    showToast("⚠️ No files to move"); return;
  }

  // Check for conflicts
  for (const { newPath } of toMove) {
    if (currentProject.files[newPath] !== undefined) {
      showToast("⚠️ Conflict: " + newPath + " already exists"); return;
    }
  }

  // Apply moves
  for (const { oldPath, newPath } of toMove) {
    currentProject.files[newPath] = currentProject.files[oldPath];
    delete currentProject.files[oldPath];
  }

  // Update open tabs
  for (const f of openFiles) {
    const moved = toMove.find(m => m.oldPath === f.path);
    if (moved) f.path = moved.newPath;
  }
  const activeMoved = toMove.find(m => m.oldPath === activeFile);
  if (activeMoved) {
    activeFile = activeMoved.newPath;
    document.getElementById("filePathLabel").textContent = activeMoved.newPath;
  }

  // Update activeFolder context if we were inside this folder
  if (activeFolder === oldFolder) {
    activeFolder = safeName;
  }

  currentProject.updatedAt = Date.now();
  saveAllProjects();
  renderFileTree();
  renderTabs();
  showToast(`✏️ Renamed: ${oldFolder}/ → ${safeName}/`);
}

/* ═══════════════════════════════════════════════════════════════
   DELETE FILE
   ═══════════════════════════════════════════════════════════════ */
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
  renderFileTree();
  renderTabs();
  showToast("🗑️ Deleted: " + path);
}

/* ═══════════════════════════════════════════════════════════════
   PERSIST
   ═══════════════════════════════════════════════════════════════ */
function persistCurrentProject() {
  if (!currentProject) return;
  for (const file of openFiles) {
    currentProject.files[file.path] = file.content;
    file.dirty = false;
  }
  currentProject.updatedAt = Date.now();
  saveAllProjects();
  renderTabs();
}

function saveProject() {
  if (!currentProject) { showToast("No project to save"); return; }
  persistCurrentProject();
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
      type: "blob",
      compression: "DEFLATE",
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
    console.error("ZIP failed:", err);
    showToast("✗ Failed: " + err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
   TEMPLATES
   ═══════════════════════════════════════════════════════════════ */
function getTemplateFiles(type, name) {
  const moduleJson = JSON.stringify({
    name: name,
    version: "1.0.0",
    author: "admin@letssecuredo.com",
    description: "Custom module: " + name,
    isMain: false,
    minSdk: 21,
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

// New: rename + folder context
window.renameFile = renameFile;
window.renameFolder = renameFolder;
window.closeRenameModal = closeRenameModal;
window.confirmRename = confirmRename;
window.enterFolder = enterFolder;
window.goToRoot = goToRoot;
