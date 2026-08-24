/**
 * MultiSession Pro - Popup UI Controller (Per-Tab & Per-Domain Engine)
 */

let currentTab = null;
let currentDomain = null;
let activeSessionId = 'default';
let isolationMode = 'tab'; // 'tab' | 'domain'
let currentScope = 'tab'; // 'tab' | 'domain'
let tabSessionId = null;
let domainSessionId = 'default';
let sessions = {};
let sessionCookies = {};

// DOM Elements
const currentDomainEl = document.getElementById('current-domain');
const currentTabBadgeEl = document.getElementById('current-tab-badge');
const currentScopeLabelEl = document.getElementById('current-scope-label');
const currentSessionNameEl = document.getElementById('current-session-name');
const currentSessionIconEl = document.getElementById('current-session-icon');
const currentSessionDotEl = document.getElementById('current-session-dot');
const sessionListEl = document.getElementById('session-list');
const searchInput = document.getElementById('search-input');
const btnSync = document.getElementById('btn-sync');
const btnAddSession = document.getElementById('btn-add-session');
const btnOptions = document.getElementById('btn-options');
const btnClearDomain = document.getElementById('btn-clear-domain');
const btnNewIsolatedTab = document.getElementById('btn-new-isolated-tab');
const btnToggleMode = document.getElementById('btn-toggle-mode');
const modeText = document.getElementById('mode-text');
const btnScopeTab = document.getElementById('btn-scope-tab');
const btnScopeDomain = document.getElementById('btn-scope-domain');

// Modal Elements (Session Form)
const modalOverlay = document.getElementById('modal-overlay');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const sessionForm = document.getElementById('session-form');
const formSessionId = document.getElementById('form-session-id');
const formSessionName = document.getElementById('form-session-name');
const modalTitle = document.getElementById('modal-title');
const toastEl = document.getElementById('toast');

// Dialog Elements (Confirmation & Alerts)
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const dialogTitle = document.getElementById('dialog-title');
const dialogMessage = document.getElementById('dialog-message');
const dialogIconDanger = document.getElementById('dialog-icon-danger');
const dialogIconInfo = document.getElementById('dialog-icon-info');
const btnDialogConfirm = document.getElementById('btn-dialog-confirm');
const btnDialogCancel = document.getElementById('btn-dialog-cancel');

let selectedIcon = '👤';
let selectedColor = '#faae2b';

// Init on popup load
document.addEventListener('DOMContentLoaded', async () => {
  await initCurrentTab();
  await loadData();
  setupEventListeners();
});

// Get current active tab and parse domain
async function initCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (tab?.id) {
    currentTabBadgeEl.textContent = `Tab #${tab.id}`;
  }

  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      if (['http:', 'https:'].includes(url.protocol)) {
        currentDomain = url.hostname;
      } else {
        currentDomain = null;
      }
    } catch {
      currentDomain = null;
    }
  }

  if (currentDomain) {
    currentDomainEl.textContent = currentDomain;
  } else {
    currentDomainEl.textContent = 'Halaman Internal Browser';
    currentDomainEl.style.color = '#94a3b8';
    currentTabBadgeEl.style.display = 'none';
  }
}

// Load status from background
async function loadData() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'GET_STATUS_INFO',
      tabId: currentTab?.id,
      domain: currentDomain
    }, (res) => {
      if (res) {
        isolationMode = res.isolationMode || 'tab';
        tabSessionId = res.tabSessionId;
        domainSessionId = res.domainSessionId || 'default';
        activeSessionId = res.activeSessionId || 'default';
        sessions = res.sessions || {};
      }

      updateModeUI();
      renderActiveBanner();
      renderSessionList();
      resolve();
    });
  });
}

function updateModeUI() {
  modeText.textContent = isolationMode === 'tab' ? 'Mode: Per-Tab' : 'Mode: Domain';
  if (currentScope === 'tab') {
    btnScopeTab.classList.add('active');
    btnScopeDomain.classList.remove('active');
    currentScopeLabelEl.textContent = 'Session aktif untuk tab ini:';
  } else {
    btnScopeTab.classList.remove('active');
    btnScopeDomain.classList.add('active');
    currentScopeLabelEl.textContent = 'Session global untuk website ini:';
  }
}

// Render active session banner
function renderActiveBanner() {
  const effectiveSessionId = currentScope === 'tab' ? (tabSessionId || activeSessionId) : domainSessionId;
  const activeSession = sessions[effectiveSessionId] || sessions['default'] || {
    name: 'Default',
    icon: '👤',
    color: '#faae2b'
  };

  currentSessionNameEl.textContent = activeSession.name;
  currentSessionIconEl.textContent = activeSession.icon || '👤';
  currentSessionDotEl.style.backgroundColor = activeSession.color || '#faae2b';
}

// Render list of all sessions
function renderSessionList(filterQuery = '') {
  sessionListEl.innerHTML = '';
  const query = filterQuery.toLowerCase().trim();
  const sessionEntries = Object.values(sessions).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const filtered = sessionEntries.filter(s => 
    s.name.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    sessionListEl.innerHTML = `
      <div style="text-align: center; padding: 24px 0; color: #71717a; font-size: 12px; font-weight: 600;">
        Tidak ada session yang cocok.
      </div>
    `;
    return;
  }

  const currentTargetSessionId = currentScope === 'tab' ? (tabSessionId || activeSessionId) : domainSessionId;

  filtered.forEach(session => {
    const isActive = session.id === currentTargetSessionId;

    const card = document.createElement('div');
    card.className = `session-card ${isActive ? 'active' : ''}`;
    card.dataset.id = session.id;
    card.title = isActive ? 'Session ini sedang aktif' : `Klik untuk beralih ke "${session.name}"`;

    card.innerHTML = `
      <div class="session-card-left">
        <div class="session-badge-avatar" style="background: ${session.color || '#faae2b'};">
          ${session.icon || '📌'}
        </div>
        <div class="session-card-details">
          <span class="session-card-name" title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</span>
          <div class="session-card-meta">
            ${session.id === 'default' ? '<span>(Sistem / Utama)</span>' : '<span>Profil Kustom</span>'}
          </div>
        </div>
      </div>
      <div class="session-card-actions">
        ${isActive ? `
          <div class="active-indicator">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Aktif
          </div>
        ` : `
          <span class="click-hint-indicator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </span>
        `}
        ${currentDomain ? `
          <button class="icon-btn btn-item-action" data-action="open-tab" data-id="${session.id}" title="Buka website ini di tab baru dengan session ini">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
        ` : ''}
        ${session.id !== 'default' ? `
          <button class="icon-btn btn-item-action" data-action="edit" data-id="${session.id}" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="icon-btn btn-item-action" data-action="delete" data-id="${session.id}" title="Hapus" style="color: #ef4444;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
            </svg>
          </button>
        ` : ''}
      </div>
    `;

    sessionListEl.appendChild(card);
  });
}

// Switch Session according to active scope
async function handleSwitchSession(targetSessionId) {
  if (!currentDomain) {
    showToast('Buka website terlebih dahulu');
    return;
  }

  showToast(`Menerapkan session...`);

  if (currentScope === 'tab') {
    // Apply only to this tab
    chrome.runtime.sendMessage({
      action: 'SET_TAB_SESSION',
      tabId: currentTab?.id,
      domain: currentDomain,
      sessionId: targetSessionId,
      reload: false
    }, async () => {
      tabSessionId = targetSessionId;
      activeSessionId = targetSessionId;
      await loadData();
      showToast(`Tab diubah ke: ${sessions[targetSessionId]?.name || 'Session'}`);
    });
  } else {
    // Apply globally to domain
    chrome.runtime.sendMessage({
      action: 'SET_DOMAIN_SESSION',
      domain: currentDomain,
      sessionId: targetSessionId,
      tabId: currentTab?.id,
      reload: false
    }, async () => {
      domainSessionId = targetSessionId;
      activeSessionId = targetSessionId;
      await loadData();
      showToast(`Domain diubah ke: ${sessions[targetSessionId]?.name || 'Session'}`);
    });
  }
}

// Open new tab with specific session
async function handleOpenTabWithSession(sessionId) {
  if (!currentTab?.url) return;
  chrome.runtime.sendMessage({
    action: 'OPEN_NEW_TAB_WITH_SESSION',
    url: currentTab.url,
    sessionId: sessionId
  }, (res) => {
    if (res?.success) {
      showToast(`Tab baru dibuka di: ${sessions[sessionId]?.name}`);
    }
  });
}

// Custom confirmation dialog (Promise-based)
function showConfirmDialog({
  title = 'Konfirmasi Hapus',
  message = 'Apakah Anda yakin?',
  confirmText = 'Hapus',
  cancelText = 'Batal',
  type = 'danger'
}) {
  return new Promise((resolve) => {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    btnDialogConfirm.textContent = confirmText;
    btnDialogCancel.textContent = cancelText;
    btnDialogCancel.style.display = cancelText ? 'block' : 'none';

    if (type === 'danger') {
      dialogIconDanger.style.display = 'flex';
      dialogIconInfo.style.display = 'none';
      btnDialogConfirm.className = 'btn-danger';
    } else {
      dialogIconDanger.style.display = 'none';
      dialogIconInfo.style.display = 'flex';
      btnDialogConfirm.className = 'btn-primary';
    }

    confirmModalOverlay.classList.add('active');

    function onConfirm() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    function onOverlayClick(e) {
      if (e.target === confirmModalOverlay) {
        onCancel();
      }
    }

    function cleanup() {
      btnDialogConfirm.removeEventListener('click', onConfirm);
      btnDialogCancel.removeEventListener('click', onCancel);
      confirmModalOverlay.removeEventListener('click', onOverlayClick);
      confirmModalOverlay.classList.remove('active');
    }

    btnDialogConfirm.addEventListener('click', onConfirm);
    btnDialogCancel.addEventListener('click', onCancel);
    confirmModalOverlay.addEventListener('click', onOverlayClick);
  });
}

// Event Listeners setup
function setupEventListeners() {
  // Scope Switcher
  btnScopeTab.addEventListener('click', () => {
    currentScope = 'tab';
    updateModeUI();
    renderActiveBanner();
    renderSessionList(searchInput.value);
  });

  btnScopeDomain.addEventListener('click', () => {
    currentScope = 'domain';
    updateModeUI();
    renderActiveBanner();
    renderSessionList(searchInput.value);
  });

  // Toggle Isolation Mode (Tab / Domain default)
  btnToggleMode.addEventListener('click', () => {
    const newMode = isolationMode === 'tab' ? 'domain' : 'tab';
    chrome.runtime.sendMessage({
      action: 'SET_ISOLATION_MODE',
      mode: newMode
    }, async () => {
      isolationMode = newMode;
      currentScope = newMode;
      updateModeUI();
      renderActiveBanner();
      renderSessionList(searchInput.value);
      showToast(`Mode isolasi diubah ke: ${newMode === 'tab' ? 'Per-Tab' : 'Domain'}`);
    });
  });

  // Search
  searchInput.addEventListener('input', (e) => {
    renderSessionList(e.target.value);
  });

  // Action clicks inside session list (card click = switch, button click = action)
  sessionListEl.addEventListener('click', async (e) => {
    // 1. If clicked an action button (open-tab, edit, delete), handle that specific action
    const btn = e.target.closest('.btn-item-action');
    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'open-tab') {
        handleOpenTabWithSession(id);
      } else if (action === 'edit') {
        openEditModal(id);
      } else if (action === 'delete') {
        handleDeleteSession(id);
      }
      return;
    }

    // 2. Otherwise, clicking anywhere on the card switches the session!
    const card = e.target.closest('.session-card');
    if (!card) return;

    const id = card.dataset.id;
    const currentTargetSessionId = currentScope === 'tab' ? (tabSessionId || activeSessionId) : domainSessionId;
    if (id !== currentTargetSessionId) {
      handleSwitchSession(id);
    }
  });

  // Sync / Save Cookies button
  btnSync.addEventListener('click', async () => {
    if (!currentDomain) return;
    const icon = btnSync.querySelector('.sync-icon');
    icon.classList.add('spinning');

    chrome.runtime.sendMessage({
      action: 'SAVE_CURRENT_COOKIES',
      domain: currentDomain,
      sessionId: activeSessionId
    }, async (res) => {
      setTimeout(async () => {
        icon.classList.remove('spinning');
        await loadData();
        if (res?.success === false) {
          showToast('Dilewati: session aktif sudah berganti, cookie tidak ditimpa');
        } else {
          showToast(`${res?.count || 0} Cookies tersimpan!`);
        }
      }, 400);
    });
  });

  // Reset Cookies for Domain
  btnClearDomain.addEventListener('click', async () => {
    if (!currentDomain) return;
    const confirmed = await showConfirmDialog({
      title: 'Reset Cookie Domain',
      message: `Hapus semua cookie aktif untuk "${currentDomain}"? Anda akan otomatis logout dari website ini.`,
      confirmText: 'Ya, Reset Cookie',
      cancelText: 'Batal',
      type: 'danger'
    });

    if (confirmed) {
      chrome.runtime.sendMessage({
        action: 'CLEAR_SESSION_COOKIES',
        domain: currentDomain,
        sessionId: activeSessionId,
        clearBrowserToo: true
      }, async () => {
        if (currentTab?.id) {
          chrome.tabs.reload(currentTab.id);
        }
        await loadData();
        showToast('Cookie domain telah direset!');
      });
    }
  });

  // Open New Isolated Tab with Active Session
  btnNewIsolatedTab.addEventListener('click', () => {
    if (currentTab?.url) {
      handleOpenTabWithSession(activeSessionId);
    }
  });

  // Options page
  btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Add Session modal open
  btnAddSession.addEventListener('click', () => {
    openAddModal();
  });

  // Close modal
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Icon picker
  document.getElementById('icon-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-opt');
    if (!btn) return;
    document.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedIcon = btn.dataset.icon;
  });

  // Color picker
  document.getElementById('color-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-opt');
    if (!btn) return;
    document.querySelectorAll('.color-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedColor = btn.dataset.color;
  });

  // Form Submit
  sessionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = formSessionName.value.trim();
    const editId = formSessionId.value;

    if (!name) return;

    const data = await chrome.storage.local.get('sessions');
    const existingSessions = data.sessions || {};

    if (editId) {
      existingSessions[editId] = {
        ...existingSessions[editId],
        name,
        icon: selectedIcon,
        color: selectedColor
      };
    } else {
      const newId = `session-${Date.now()}`;
      existingSessions[newId] = {
        id: newId,
        name,
        icon: selectedIcon,
        color: selectedColor,
        createdAt: Date.now()
      };
    }

    await chrome.storage.local.set({ sessions: existingSessions });
    chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });

    closeModal();
    await loadData();
    showToast(editId ? 'Session diperbarui!' : 'Session baru dibuat!');
  });
}

function openAddModal() {
  modalTitle.textContent = 'Buat Session Baru';
  formSessionId.value = '';
  formSessionName.value = '';
  selectedIcon = '👤';
  selectedColor = '#faae2b';
  syncPickerSelections();
  modalOverlay.classList.add('active');
  formSessionName.focus();
}

function openEditModal(id) {
  const session = sessions[id];
  if (!session) return;

  modalTitle.textContent = 'Edit Profil Session';
  formSessionId.value = id;
  formSessionName.value = session.name;
  selectedIcon = session.icon || '👤';
  selectedColor = session.color || '#faae2b';
  syncPickerSelections();
  modalOverlay.classList.add('active');
  formSessionName.focus();
}

function syncPickerSelections() {
  document.querySelectorAll('.icon-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.icon === selectedIcon);
  });
  document.querySelectorAll('.color-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === selectedColor);
  });
}

function closeModal() {
  modalOverlay.classList.remove('active');
}

async function handleDeleteSession(id) {
  if (id === 'default') {
    showToast('Session Default tidak bisa dihapus');
    return;
  }

  const session = sessions[id];
  const confirmed = await showConfirmDialog({
    title: 'Hapus Session',
    message: `Apakah Anda yakin ingin menghapus session "${session?.name || id}"? Semua data cookie tersimpan untuk session ini akan dihapus permanen.`,
    confirmText: 'Ya, Hapus Session',
    cancelText: 'Batal',
    type: 'danger'
  });

  if (!confirmed) return;

  const data = await chrome.storage.local.get(['sessions', 'sessionCookies', 'domainSessionMap']);
  const newSessions = { ...data.sessions };
  const newSessionCookies = { ...data.sessionCookies };
  const newDomainMap = { ...data.domainSessionMap };

  delete newSessions[id];
  delete newSessionCookies[id];

  for (const [dom, sessId] of Object.entries(newDomainMap)) {
    if (sessId === id) {
      newDomainMap[dom] = 'default';
    }
  }

  await chrome.storage.local.set({
    sessions: newSessions,
    sessionCookies: newSessionCookies,
    domainSessionMap: newDomainMap
  });

  chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });

  if (activeSessionId === id) {
    activeSessionId = 'default';
  }

  await loadData();
  showToast('Session berhasil dihapus');
}

// Toast notification helper
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2200);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}
