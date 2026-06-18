/**
 * app.js
 * Main application logic, state management, drag & drop, paste handlers,
 * and UI controllers for the EPUB Creator.
 */

// Application State
const state = {
  title: "",
  author: "",
  publisher: "Self-Published",
  language: "en",
  uuid: "",
  coverImage: null,        // Blob
  coverImageType: "",      // e.g. "image/jpeg"
  coverImageURL: null,     // Object URL
  items: [],               // Array of { id, title, content, isChapter }
  images: {},              // Path -> Blob mapping
  activeItemId: null,
  theme: "dark"
};

// State Helpers
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Debounce helper for auto-saving
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadSavedBook();
  bindEvents();
  renderSidebar();
  selectDefaultItem();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem("epub-creator-theme") || "dark";
  state.theme = savedTheme;
  document.body.setAttribute("data-theme", savedTheme);
  
  const themeToggleIcon = document.getElementById("theme-toggle-icon");
  if (themeToggleIcon) {
    themeToggleIcon.className = savedTheme === "dark" ? "bi bi-sun" : "bi bi-moon";
  }
}

function toggleTheme() {
  const newTheme = state.theme === "dark" ? "light" : "dark";
  state.theme = newTheme;
  document.body.setAttribute("data-theme", newTheme);
  localStorage.setItem("epub-creator-theme", newTheme);
  
  const themeToggleIcon = document.getElementById("theme-toggle-icon");
  if (themeToggleIcon) {
    themeToggleIcon.className = newTheme === "dark" ? "bi bi-sun" : "bi bi-moon";
  }
}

// Save & Load state to localStorage
// Images and cover images are serialized as Base64 strings to keep persistence across refreshes.
const saveBookToStorage = debounce(async () => {
  const serializedState = {
    title: state.title,
    author: state.author,
    publisher: state.publisher,
    language: state.language,
    uuid: state.uuid,
    items: state.items,
    theme: state.theme
  };

  // Convert cover image to base64
  if (state.coverImage) {
    serializedState.coverImageType = state.coverImageType;
    serializedState.coverImageBase64 = await blobToBase64(state.coverImage);
  }

  // Convert pasted/inserted images to base64
  const serializedImages = {};
  for (const [path, blob] of Object.entries(state.images)) {
    serializedImages[path] = {
      type: blob.type,
      base64: await blobToBase64(blob)
    };
  }
  serializedState.images = serializedImages;

  localStorage.setItem("epub-creator-draft", JSON.stringify(serializedState));
  updateStatusBar("Saved draft.");
}, 1000);

async function loadSavedBook() {
  const savedData = localStorage.getItem("epub-creator-draft");
  if (!savedData) {
    // New Book Init
    state.uuid = generateUUID();
    state.items = [
      { id: "intro-1", title: "Introduction", content: "<p>Welcome to your new book. Start writing here...</p>", isChapter: false },
      { id: "chapter-1", title: "Chapter 1: The Beginning", content: "<p>Once upon a time...</p>", isChapter: true }
    ];
    return;
  }

  try {
    const parsed = JSON.parse(savedData);
    state.title = parsed.title || "";
    state.author = parsed.author || "";
    state.publisher = parsed.publisher || "Self-Published";
    state.language = parsed.language || "en";
    state.uuid = parsed.uuid || generateUUID();
    state.items = parsed.items || [];
    
    // Load metadata inputs
    document.getElementById("book-title-input").value = state.title;
    document.getElementById("book-author-input").value = state.author;
    document.getElementById("book-publisher-input").value = state.publisher;
    document.getElementById("book-lang-input").value = state.language;

    // Load cover image
    if (parsed.coverImageBase64) {
      state.coverImageType = parsed.coverImageType;
      const response = await fetch(parsed.coverImageBase64);
      state.coverImage = await response.blob();
      state.coverImageURL = URL.createObjectURL(state.coverImage);
      showCoverPreview(state.coverImageURL);
    }

    // Load images
    if (parsed.images) {
      for (const [path, imgData] of Object.entries(parsed.images)) {
        const response = await fetch(imgData.base64);
        state.images[path] = await response.blob();
      }
    }
  } catch (err) {
    console.error("Failed to load saved draft:", err);
  }
}

// Convert blob to base64 utility
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Event Bindings
function bindEvents() {
  // Theme Toggle
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  // Metadata Sync
  document.getElementById("book-title-input").addEventListener("input", (e) => {
    state.title = e.target.value;
    saveBookToStorage();
  });
  document.getElementById("book-author-input").addEventListener("input", (e) => {
    state.author = e.target.value;
    saveBookToStorage();
  });
  document.getElementById("book-publisher-input").addEventListener("input", (e) => {
    state.publisher = e.target.value;
    saveBookToStorage();
  });
  document.getElementById("book-lang-input").addEventListener("change", (e) => {
    state.language = e.target.value;
    saveBookToStorage();
  });

  // Cover Image Selector
  const coverZone = document.getElementById("cover-dropzone");
  const coverInput = document.getElementById("cover-file-input");

  coverZone.addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleCoverFile(e.target.files[0]);
    }
  });

  // Paste Cover Image from clipboard
  coverZone.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        handleCoverFile(file);
      }
    }
  });

  // Drag and Drop Cover
  coverZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    coverZone.classList.add("drag-over");
  });
  coverZone.addEventListener("dragleave", () => {
    coverZone.classList.remove("drag-over");
  });
  coverZone.addEventListener("drop", (e) => {
    e.preventDefault();
    coverZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) {
      handleCoverFile(e.dataTransfer.files[0]);
    }
  });

  // Add Chapter / Add Loose Page
  document.getElementById("add-chapter-btn").addEventListener("click", () => addPage(true));
  document.getElementById("add-page-btn").addEventListener("click", () => addPage(false));

  // Editor Inputs
  const editorTitle = document.getElementById("editor-title-input");
  const editorBody = document.getElementById("editor-body");

  editorTitle.addEventListener("input", (e) => {
    if (state.activeItemId) {
      const item = state.items.find(i => i.id === state.activeItemId);
      if (item) {
        item.title = e.target.value;
        const navEl = document.querySelector(`.nav-item[data-id="${state.activeItemId}"] .nav-item-title`);
        if (navEl) navEl.textContent = item.title;
        saveBookToStorage();
      }
    }
  });

  editorBody.addEventListener("input", () => {
    if (state.activeItemId) {
      const item = state.items.find(i => i.id === state.activeItemId);
      if (item) {
        item.content = editorBody.innerHTML;
        updateWordCount();
        saveBookToStorage();
      }
    }
  });

  // Intercept Paste for Image pastes
  editorBody.addEventListener("paste", (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        handlePasteImage(blob);
      }
    }
  });

  // Drop image files directly in the editor
  editorBody.addEventListener("dragover", (e) => e.preventDefault());
  editorBody.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.indexOf("image") !== -1) {
          e.preventDefault();
          handlePasteImage(files[i]);
        }
      }
    }
  });

  // Formatting Toolbar commands
  const toolbarButtons = document.querySelectorAll(".toolbar-btn[data-command]");
  toolbarButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      // Find closest button parent if nested icon triggered it
      const targetBtn = e.target.closest(".toolbar-btn");
      const cmd = targetBtn.getAttribute("data-command");
      const val = targetBtn.getAttribute("data-value") || null;
      
      // Execute command on editable iframe or div
      document.execCommand(cmd, false, val);
      editorBody.focus();
      
      // Sync editor status after change
      if (state.activeItemId) {
        const item = state.items.find(i => i.id === state.activeItemId);
        if (item) item.content = editorBody.innerHTML;
        saveBookToStorage();
      }
    });
  });

  // Formatting select inputs (Heading / Paragraph)
  const formatSelect = document.getElementById("toolbar-format");
  if (formatSelect) {
    formatSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      document.execCommand("formatBlock", false, val);
      editorBody.focus();
      e.target.value = ""; // Reset value for next select
    });
  }

  // Insert Image via File Picker in Toolbar
  const insertImageBtn = document.getElementById("toolbar-insert-image");
  if (insertImageBtn) {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        handlePasteImage(e.target.files[0]);
      }
    });
    insertImageBtn.addEventListener("click", () => fileInput.click());
  }

  // Drawers and Overlays
  const exportOpenBtn = document.getElementById("export-open-btn");
  const exportDrawer = document.getElementById("export-drawer");
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  const drawerCloseBtn = document.getElementById("drawer-close");

  const openDrawer = () => {
    exportDrawer.classList.add("open");
    drawerBackdrop.classList.add("open");
    runValidationCheck();
  };

  const closeDrawer = () => {
    exportDrawer.classList.remove("open");
    drawerBackdrop.classList.remove("open");
  };

  exportOpenBtn.addEventListener("click", openDrawer);
  drawerCloseBtn.addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);

  // Trigger Export Compilation
  document.getElementById("compile-btn").addEventListener("click", triggerEPUBExport);
}

// Handle Cover Image upload
function handleCoverFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please select a valid image file for the cover.");
    return;
  }
  
  state.coverImage = file;
  state.coverImageType = file.type;
  
  if (state.coverImageURL) {
    URL.revokeObjectURL(state.coverImageURL);
  }
  state.coverImageURL = URL.createObjectURL(file);
  showCoverPreview(state.coverImageURL);
  saveBookToStorage();
}

function showCoverPreview(url) {
  const container = document.getElementById("cover-dropzone");
  // Clean elements except input
  const previewImg = container.querySelector(".cover-preview-img") || document.createElement("img");
  previewImg.className = "cover-preview-img";
  previewImg.src = url;
  
  container.appendChild(previewImg);
  
  // Add clear button
  let removeBtn = container.querySelector(".cover-remove-btn");
  if (!removeBtn) {
    removeBtn = document.createElement("button");
    removeBtn.className = "cover-remove-btn";
    removeBtn.innerHTML = '<i class="bi bi-x"></i>';
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Avoid triggering file select dialog
      removeCoverImage();
    });
    container.appendChild(removeBtn);
  }
}

function removeCoverImage() {
  state.coverImage = null;
  state.coverImageType = "";
  if (state.coverImageURL) {
    URL.revokeObjectURL(state.coverImageURL);
    state.coverImageURL = null;
  }
  
  const container = document.getElementById("cover-dropzone");
  const img = container.querySelector(".cover-preview-img");
  const btn = container.querySelector(".cover-remove-btn");
  if (img) img.remove();
  if (btn) btn.remove();
  
  saveBookToStorage();
}

// Handle pasting images into the Editor
function handlePasteImage(file) {
  const timestamp = Date.now();
  const rand = Math.floor(Math.random() * 10000);
  
  let ext = "png";
  if (file.type === "image/jpeg") ext = "jpg";
  if (file.type === "image/gif") ext = "gif";
  if (file.type === "image/svg+xml") ext = "svg";

  const imgPath = `images/img_${timestamp}_${rand}.${ext}`;
  state.images[imgPath] = file;

  const objectUrl = URL.createObjectURL(file);

  // Insert the image into the selection
  const imgHTML = `<img src="${objectUrl}" data-epub-src="${imgPath}" alt="Book Illustration" />`;
  document.execCommand("insertHTML", false, imgHTML);

  // Sync state
  const editorBody = document.getElementById("editor-body");
  if (state.activeItemId) {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (item) {
      item.content = editorBody.innerHTML;
      saveBookToStorage();
    }
  }
}

// Add Page/Chapter
function addPage(isChapter = true) {
  const id = `item-${Date.now()}`;
  const prefix = isChapter ? "Chapter" : "Page";
  const num = state.items.filter(i => i.isChapter === isChapter).length + 1;
  const title = `${prefix} ${num}`;
  
  const newItem = {
    id: id,
    title: title,
    content: "<p>Write your content here...</p>",
    isChapter: isChapter
  };

  state.items.push(newItem);
  renderSidebar();
  selectItem(id);
  saveBookToStorage();
}

// Delete Page/Chapter
function deletePage(id) {
  const confirmDelete = confirm("Are you sure you want to delete this page?");
  if (!confirmDelete) return;

  state.items = state.items.filter(item => item.id !== id);
  
  renderSidebar();

  if (state.activeItemId === id) {
    selectDefaultItem();
  }
  saveBookToStorage();
}

// Select Chapter/Page
function selectItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  state.activeItemId = id;

  // Remove active from all items, add to current
  const items = document.querySelectorAll(".nav-item");
  items.forEach(el => el.classList.remove("active"));
  const activeEl = document.querySelector(`.nav-item[data-id="${id}"]`);
  if (activeEl) activeEl.classList.add("active");

  // Show editor, hide welcome overlay
  document.getElementById("welcome-overlay").style.display = "none";

  // Bind values to Editor
  const titleInput = document.getElementById("editor-title-input");
  const editorBody = document.getElementById("editor-body");

  titleInput.value = item.title;
  
  // Replace references of data-epub-src to local Object URLs for editor preview
  let renderHTML = item.content;
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = renderHTML;
  const images = tempDiv.querySelectorAll("img[data-epub-src]");
  images.forEach(img => {
    const path = img.getAttribute("data-epub-src");
    if (state.images[path]) {
      img.src = URL.createObjectURL(state.images[path]);
    }
  });
  
  editorBody.innerHTML = tempDiv.innerHTML;
  updateWordCount();
}

function selectDefaultItem() {
  if (state.items.length > 0) {
    selectItem(state.items[0].id);
  } else {
    // Show Welcome screen if no documents exist
    state.activeItemId = null;
    document.getElementById("welcome-overlay").style.display = "flex";
  }
}

// Sidebar Rendering
function renderSidebar() {
  const uncategorizedList = document.getElementById("loose-pages-list");
  const chaptersList = document.getElementById("chapters-list");

  uncategorizedList.innerHTML = "";
  chaptersList.innerHTML = "";

  state.items.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = `nav-item ${state.activeItemId === item.id ? "active" : ""}`;
    li.setAttribute("data-id", item.id);
    li.setAttribute("draggable", "true");

    const iconClass = item.isChapter ? "bi bi-journal-text" : "bi bi-file-text";

    li.innerHTML = `
      <div class="nav-item-drag"><i class="bi bi-grip-vertical"></i></div>
      <i class="${iconClass} nav-item-icon"></i>
      <span class="nav-item-title">${item.title}</span>
      <button class="nav-item-delete" onclick="event.stopPropagation(); deletePage('${item.id}')">
        <i class="bi bi-trash"></i>
      </button>
    `;

    li.addEventListener("click", () => selectItem(item.id));
    
    // Drag and Drop event bindings
    li.addEventListener("dragstart", handleDragStart);
    li.addEventListener("dragover", handleDragOver);
    li.addEventListener("drop", handleDrop);
    li.addEventListener("dragend", handleDragEnd);

    if (item.isChapter) {
      chaptersList.appendChild(li);
    } else {
      uncategorizedList.appendChild(li);
    }
  });
}

// Reordering / Drag and Drop
let dragSrcElement = null;

function handleDragStart(e) {
  this.classList.add("sortable-ghost");
  dragSrcElement = this;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", this.getAttribute("data-id"));
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();

  const srcId = e.dataTransfer.getData("text/plain");
  const targetId = this.getAttribute("data-id");

  if (srcId !== targetId) {
    const srcIndex = state.items.findIndex(i => i.id === srcId);
    const targetIndex = state.items.findIndex(i => i.id === targetId);
    
    if (srcIndex !== -1 && targetIndex !== -1) {
      // Re-order in the array
      const itemToMove = state.items.splice(srcIndex, 1)[0];
      
      // Keep categorizations consistent! If moving a loose page into chapters or vice-versa,
      // change its categorizations to match its drop location
      const targetItem = state.items[targetIndex > srcIndex ? targetIndex - 1 : targetIndex];
      if (targetItem) {
        itemToMove.isChapter = targetItem.isChapter;
      }
      
      state.items.splice(targetIndex, 0, itemToMove);
      renderSidebar();
      saveBookToStorage();
    }
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove("sortable-ghost");
}

// UI State Syncing
function updateWordCount() {
  const editorBody = document.getElementById("editor-body");
  const text = editorBody.innerText || "";
  const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  document.getElementById("word-count-badge").textContent = `${words} words`;
}

function updateStatusBar(message) {
  const statusLabel = document.getElementById("status-label");
  if (statusLabel) {
    statusLabel.textContent = message;
    setTimeout(() => {
      if (statusLabel.textContent === message) statusLabel.textContent = "Draft autosaved.";
    }, 3000);
  }
}

// Validation Checks
function runValidationCheck() {
  const container = document.getElementById("validation-report");
  container.innerHTML = "";

  const checkList = [];

  // 1. Title Check
  if (!state.title.trim()) {
    checkList.push({
      type: "danger",
      title: "Book Title Missing",
      desc: "Specify a title for your book before compiling."
    });
  } else {
    checkList.push({
      type: "success",
      title: "Book Title Set",
      desc: `"${state.title}"`
    });
  }

  // 2. Author Check
  if (!state.author.trim()) {
    checkList.push({
      type: "warning",
      title: "Author Missing",
      desc: "It is recommended to set an author name."
    });
  } else {
    checkList.push({
      type: "success",
      title: "Author Set",
      desc: state.author
    });
  }

  // 3. Cover Image Check
  if (!state.coverImage) {
    checkList.push({
      type: "warning",
      title: "No Cover Image",
      desc: "An e-book looks best with a cover image, though it's optional."
    });
  } else {
    checkList.push({
      type: "success",
      title: "Cover Image Added",
      desc: `${(state.coverImage.size / 1024).toFixed(0)} KB (${state.coverImageType})`
    });
  }

  // 4. Chapters Count Check
  const chaptersCount = state.items.filter(i => i.isChapter).length;
  if (chaptersCount === 0) {
    checkList.push({
      type: "danger",
      title: "No Chapters Created",
      desc: "E-books need at least one Chapter to build a Table of Contents."
    });
  } else {
    checkList.push({
      type: "success",
      title: "Chapters Configured",
      desc: `${chaptersCount} Chapter(s) in TOC.`
    });
  }

  // 5. Total Pages/Contents Check
  if (state.items.length === 0) {
    checkList.push({
      type: "danger",
      title: "No Content",
      desc: "Your book has no chapters or pages."
    });
  }

  // Render Checks
  checkList.forEach(item => {
    const el = document.createElement("div");
    el.className = `validation-item ${item.type}`;
    
    let iconClass = "bi-check-circle";
    if (item.type === "warning") iconClass = "bi-exclamation-triangle";
    if (item.type === "danger") iconClass = "bi-x-circle";

    el.innerHTML = `
      <i class="bi ${iconClass} validation-icon"></i>
      <div class="validation-text">
        <div class="validation-text-title">${item.title}</div>
        <div class="validation-text-desc">${item.desc}</div>
      </div>
    `;
    container.appendChild(el);
  });

  // Enable/Disable Compile Button
  const hasErrors = checkList.some(item => item.type === "danger");
  document.getElementById("compile-btn").disabled = hasErrors;
}

// Compile & Download EPUB
async function triggerEPUBExport() {
  const isKepub = document.getElementById("kepub-toggle").checked;
  const progressOverlay = document.getElementById("progress-overlay");
  
  progressOverlay.style.display = "flex";
  
  try {
    const epubBlob = await EPUBBuilder.compile(state, { isKepub: isKepub });
    
    const cleanTitle = (state.title || "untitled").toLowerCase().replace(/[^a-z0-9]/gi, "_");
    const filename = `${cleanTitle}${isKepub ? ".kepub.epub" : ".epub"}`;
    
    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(epubBlob);
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    setTimeout(() => {
      progressOverlay.style.display = "none";
      // Close drawer on compile complete
      document.getElementById("export-drawer").classList.remove("open");
      document.getElementById("drawer-backdrop").classList.remove("open");
    }, 1000);
  } catch (error) {
    console.error("Compilation error:", error);
    alert("Export failed: " + error.message);
    progressOverlay.style.display = "none";
  }
}

// Global hook bindings for inline buttons in template
window.deletePage = deletePage;
window.addPage = addPage;
