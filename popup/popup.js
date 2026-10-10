/**
 * MultiSession Pro - Popup UI Controller (Per-Tab & Per-Domain Engine)
 */

let currentTab = null;
let currentDomain = null;
let activeSessionId = 'default';
let currentScope = 'tab'; // 'tab' | 'domain' (persisted as isolationMode)
let tabSessionId = null;
let domainSessionId = 'default';
let sessions = {};

const SEARCH_THRESHOLD = 6;

const $ = (id) => document.getElementById(id);

// DOM Elements
const currentDomainEl = $('current-domain');
const currentSessionNameEl = $('current-session-name');
const currentSessionIconEl = $('current-session-icon');
const currentSessionDotEl = $('current-session-dot');
const sessionListEl = $('session-list');
const searchWrap = $('search-wrap');
const searchInput = $('search-input');
const btnSync = $('btn-sync');
const btnAddSession = $('btn-add-session');
const btnOptions = $('btn-options');
const btnClearDomain = $('btn-clear-domain');
const btnScopeTab = $('btn-scope-tab');
const btnScopeDomain = $('btn-scope-domain');

// Session form
const modalOverlay = $('modal-overlay');
const btnCancelModal = $('btn-cancel-modal');
const sessionForm = $('session-form');
const formSessionId = $('form-session-id');
const formSessionName = $('form-session-name');
const modalTitle = $('modal-title');
const toastEl = $('toast');

// Confirmation dialog
const confirmModalOverlay = $('confirm-modal-overlay');
const dialogTitle = $('dialog-title');
const dialogMessage = $('dialog-message');
const btnDialogConfirm = $('btn-dialog-confirm');
const btnDialogCancel = $('btn-dialog-cancel');

let selectedIcon = '👤';
let selectedColor = '#faae2b';

const ICONS = {
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  open: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
  edit: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
  delete: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>'
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await refresh(true);
});

// Re-read the active tab and its session state (also used when the active tab changes while the popup is open)
async function refresh(initial = false) {
  await initCurrentTab();
  await loadData(initial);
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (res) => {
      void chrome.runtime.lastError;
      resolve(res);
    });
  });
}

// Get current active tab and parse domain
async function initCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  currentDomain = null;

  try {
    const url = new URL(tab?.url || tab?.pendingUrl || '');
    if (['http:', 'https:'].includes(url.protocol)) {
      currentDomain = url.hostname;
    }
  } catch {}

  currentDomainEl.textContent = currentDomain || 'Halaman internal browser';
  for (const el of [btnSync, btnClearDomain, btnScopeTab, btnScopeDomain]) {
    el.disabled = !currentDomain;
  }
}

// Load status from background
async function loadData(initial = false) {
  const res = await sendMessage({
    action: 'GET_STATUS_INFO',
    tabId: currentTab?.id,
    domain: currentDomain
  });

  if (res) {
    if (initial) currentScope = res.isolationMode === 'domain' ? 'domain' : 'tab';
    tabSessionId = res.tabSessionId;
    domainSessionId = res.domainSessionId || 'default';
    activeSessionId = res.activeSessionId || 'default';
    sessions = res.sessions || {};
  }

  searchWrap.hidden = Object.keys(sessions).length <= SEARCH_THRESHOLD;
  render();
}

// Session the user is currently targeting given the selected scope
function getTargetSessionId() {
  return currentScope === 'tab' ? (tabSessionId || activeSessionId) : domainSessionId;
}

function render() {
  btnScopeTab.classList.toggle('active', currentScope === 'tab');
  btnScopeDomain.classList.toggle('active', currentScope === 'domain');
  renderActiveSession();
  renderSessionList(searchInput.value);
}

function renderActiveSession() {
  const session = sessions[getTargetSessionId()] || sessions['default'] || {
    name: 'Default',
    icon: '👤',
    color: '#faae2b'
  };

  currentSessionNameEl.textContent = session.name;
  currentSessionIconEl.textContent = session.icon || '👤';
  currentSessionDotEl.style.backgroundColor = session.color || '#faae2b';
}

function renderSessionList(filterQuery = '') {
  const query = filterQuery.toLowerCase().trim();
  const targetId = getTargetSessionId();
  const filtered = Object.values(sessions)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .filter((s) => s.name.toLowerCase().includes(query));

  if (filtered.length === 0) {
    sessionListEl.innerHTML = '<li class="empty">Tidak ada session yang cocok.</li>';
    return;
  }

  sessionListEl.innerHTML = filtered.map((session) => {
    const isActive = session.id === targetId;
    const id = escapeHtml(session.id);
    const isDefault = session.id === 'default';

    return `
      <li class="item ${isActive ? 'active' : ''}" data-id="${id}" title="${isActive ? 'Session aktif' : 'Klik untuk beralih'}">
        <span class="avatar" style="--c:${escapeHtml(session.color || '#faae2b')}">${escapeHtml(session.icon || '📌')}</span>
        <span class="name">${escapeHtml(session.name)}</span>
        ${isActive ? `<span class="check">${ICONS.check}</span>` : ''}
        <span class="actions">
          ${currentDomain ? `<button class="icon-btn" data-action="open-tab" data-id="${id}" title="Buka di tab baru dengan session ini">${ICONS.open}</button>` : ''}
          ${!isDefault ? `
            <button class="icon-btn" data-action="edit" data-id="${id}" title="Edit">${ICONS.edit}</button>
            <button class="icon-btn danger" data-action="delete" data-id="${id}" title="Hapus">${ICONS.delete}</button>
          ` : ''}
        </span>
      </li>
    `;
  }).join('');
}

// Switch session according to the active scope
async function handleSwitchSession(targetSessionId) {
  if (!currentDomain) {
    showToast('Buka website terlebih dahulu');
    return;
  }

  const res = await sendMessage(currentScope === 'tab'
    ? {
        action: 'SET_TAB_SESSION',
        tabId: currentTab?.id,
        domain: currentDomain,
        sessionId: targetSessionId,
        reload: false
      }
    : {
        action: 'SET_DOMAIN_SESSION',
        domain: currentDomain,
        sessionId: targetSessionId,
        tabId: currentTab?.id,
        reload: false
      });

  if (!res?.success) {
    showToast('Gagal mengganti session');
    return;
  }

  await loadData();
  showToast(`${currentScope === 'tab' ? 'Tab' : 'Website'} → ${sessions[targetSessionId]?.name || 'Session'}`);
}

async function handleOpenTabWithSession(sessionId) {
  if (!currentTab?.url) return;
  const res = await sendMessage({
    action: 'OPEN_NEW_TAB_WITH_SESSION',
    url: currentTab.url,
    sessionId
  });
  if (res?.success) {
    showToast(`Tab baru: ${sessions[sessionId]?.name}`);
  }
}

async function setScope(scope) {
  if (scope === currentScope) return;
  currentScope = scope;
  render();
  await sendMessage({ action: 'SET_ISOLATION_MODE', mode: scope });
}

// Promise-based confirmation dialog
function showConfirmDialog({ title, message, confirmText = 'Hapus' }) {
  return new Promise((resolve) => {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    btnDialogConfirm.textContent = confirmText;
    confirmModalOverlay.classList.add('active');

    function finish(result) {
      btnDialogConfirm.removeEventListener('click', onConfirm);
      btnDialogCancel.removeEventListener('click', onCancel);
      confirmModalOverlay.removeEventListener('click', onOverlayClick);
      confirmModalOverlay.classList.remove('active');
      resolve(result);
    }
    function onConfirm() { finish(true); }
    function onCancel() { finish(false); }
    function onOverlayClick(e) {
      if (e.target === confirmModalOverlay) finish(false);
    }

    btnDialogConfirm.addEventListener('click', onConfirm);
    btnDialogCancel.addEventListener('click', onCancel);
    confirmModalOverlay.addEventListener('click', onOverlayClick);
  });
}

function setupEventListeners() {
  btnScopeTab.addEventListener('click', () => setScope('tab'));
  btnScopeDomain.addEventListener('click', () => setScope('domain'));

  searchInput.addEventListener('input', (e) => renderSessionList(e.target.value));

  // Row click = switch, action button click = that action
  sessionListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'open-tab') handleOpenTabWithSession(id);
      else if (action === 'edit') openModal(id);
      else if (action === 'delete') handleDeleteSession(id);
      return;
    }

    const item = e.target.closest('.item');
    if (item && item.dataset.id !== getTargetSessionId()) {
      handleSwitchSession(item.dataset.id);
    }
  });

  btnSync.addEventListener('click', async () => {
    if (!currentDomain) return;
    const icon = btnSync.querySelector('.sync-icon');
    icon.classList.add('spinning');

    const res = await sendMessage({
      action: 'SAVE_CURRENT_COOKIES',
      domain: currentDomain,
      sessionId: activeSessionId
    });

    setTimeout(() => icon.classList.remove('spinning'), 400);
    await loadData();
    showToast(res?.success === false
      ? 'Dilewati: session aktif sudah berganti'
      : `${res?.count || 0} cookie tersimpan`);
  });

  btnClearDomain.addEventListener('click', async () => {
    if (!currentDomain) return;
    const confirmed = await showConfirmDialog({
      title: 'Reset cookie',
      message: `Hapus semua cookie untuk "${currentDomain}"? Anda akan logout dari website ini.`,
      confirmText: 'Reset'
    });
    if (!confirmed) return;

    await sendMessage({
      action: 'CLEAR_SESSION_COOKIES',
      domain: currentDomain,
      sessionId: activeSessionId,
      clearBrowserToo: true
    });
    if (currentTab?.id) chrome.tabs.reload(currentTab.id);
    await loadData();
    showToast('Cookie direset');
  });

  btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  btnAddSession.addEventListener('click', () => openModal());

  btnCancelModal.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  $('icon-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-opt');
    if (!btn) return;
    selectedIcon = btn.dataset.icon;
    syncPickerSelections();
  });

  $('color-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-opt');
    if (!btn) return;
    selectedColor = btn.dataset.color;
    syncPickerSelections();
  });

  sessionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = formSessionName.value.trim();
    const editId = formSessionId.value;
    if (!name) return;

    const { sessions: existing = {} } = await chrome.storage.local.get('sessions');

    if (editId) {
      existing[editId] = { ...existing[editId], name, icon: selectedIcon, color: selectedColor };
    } else {
      const newId = `session-${Date.now()}`;
      existing[newId] = { id: newId, name, icon: selectedIcon, color: selectedColor, createdAt: Date.now() };
    }

    await chrome.storage.local.set({ sessions: existing });
    chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });

    closeModal();
    await loadData();
    showToast(editId ? 'Session diperbarui' : 'Session dibuat');
  });

  // Keep the popup in sync if the active tab changes while it is open
  chrome.tabs.onActivated.addListener(() => refresh());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === currentTab?.id && changeInfo.url) refresh();
  });
}

function openModal(id = null) {
  const session = id ? sessions[id] : null;
  if (id && !session) return;

  modalTitle.textContent = session ? 'Edit session' : 'Session baru';
  formSessionId.value = id || '';
  formSessionName.value = session?.name || '';
  selectedIcon = session?.icon || '👤';
  selectedColor = session?.color || '#faae2b';
  syncPickerSelections();
  modalOverlay.classList.add('active');
  formSessionName.focus();
}

function closeModal() {
  modalOverlay.classList.remove('active');
}

function syncPickerSelections() {
  document.querySelectorAll('.icon-opt').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.icon === selectedIcon);
  });
  document.querySelectorAll('.color-opt').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === selectedColor);
  });
}

async function handleDeleteSession(id) {
  if (id === 'default') return;

  const confirmed = await showConfirmDialog({
    title: 'Hapus session',
    message: `Hapus "${sessions[id]?.name || id}"? Semua cookie tersimpan untuk session ini ikut terhapus.`
  });
  if (!confirmed) return;

  const data = await chrome.storage.local.get(['sessions', 'sessionCookies', 'domainSessionMap']);
  const newSessions = { ...data.sessions };
  const newSessionCookies = { ...data.sessionCookies };
  const newDomainMap = { ...data.domainSessionMap };

  delete newSessions[id];
  delete newSessionCookies[id];
  for (const [dom, sessId] of Object.entries(newDomainMap)) {
    if (sessId === id) newDomainMap[dom] = 'default';
  }

  await chrome.storage.local.set({
    sessions: newSessions,
    sessionCookies: newSessionCookies,
    domainSessionMap: newDomainMap
  });
  chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });

  await loadData();
  showToast('Session dihapus');
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}
