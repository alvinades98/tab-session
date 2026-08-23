/**
 * MultiSession Pro - Options & Dashboard Controller
 */

let sessions = {};
let domainSessionMap = {};
let sessionCookies = {};
let tabSessionMap = {};
let isolationMode = 'tab';

// Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const sessionsGrid = document.getElementById('sessions-grid');
const tabsTableBody = document.getElementById('tabs-table-body');
const cookiesTableBody = document.getElementById('cookies-table-body');
const btnCreateSession = document.getElementById('btn-create-session');
const btnExportJson = document.getElementById('btn-export-json');
const inputImportFile = document.getElementById('input-import-file');
const btnResetAll = document.getElementById('btn-reset-all');
const selectIsolationMode = document.getElementById('select-isolation-mode');
const toggleFloatingBadge = document.getElementById('toggle-floating-badge');

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

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  await loadAllData();
});

// Setup navigation tabs
function setupTabs() {
  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const targetId = item.dataset.tab;
      navItems.forEach(n => n.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(targetId)?.classList.add('active');

      if (targetId === 'tab-tabs') {
        await renderTabsTable();
      }
    });
  });
}

// Load storage
async function loadAllData() {
  const data = await chrome.storage.local.get(['sessions', 'domainSessionMap', 'sessionCookies', 'tabSessionMap', 'isolationMode', 'showFloatingBadge']);
  sessions = data.sessions || {};
  domainSessionMap = data.domainSessionMap || {};
  sessionCookies = data.sessionCookies || {};
  tabSessionMap = data.tabSessionMap || {};
  isolationMode = data.isolationMode || 'tab';

  if (selectIsolationMode) {
    selectIsolationMode.value = isolationMode;
  }

  if (toggleFloatingBadge) {
    toggleFloatingBadge.checked = data.showFloatingBadge !== false;
  }

  renderSessionsGrid();
  await renderTabsTable();
  renderCookiesTable();
}

// Render Sessions Grid
function renderSessionsGrid() {
  sessionsGrid.innerHTML = '';
  const list = Object.values(sessions).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  list.forEach(session => {
    let totalCookies = 0;
    let domainsCount = 0;
    if (sessionCookies[session.id]) {
      const domains = Object.keys(sessionCookies[session.id]);
      domainsCount = domains.length;
      domains.forEach(d => {
        totalCookies += sessionCookies[session.id][d]?.length || 0;
      });
    }

    const panel = document.createElement('div');
    panel.className = 'session-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-avatar" style="background: ${session.color || '#faae2b'}; color: #18181b;">
          ${session.icon || '👤'}
        </div>
        <div class="panel-title-box">
          <h3 class="panel-name">${escapeHtml(session.name)}</h3>
          <span class="panel-meta">${session.id === 'default' ? 'Sistem / Profil Utama' : 'Kustom'}</span>
        </div>
      </div>
      <div class="panel-body">
        <div>🌐 <strong>${domainsCount}</strong> domain terisolasi</div>
        <div>🍪 <strong>${totalCookies}</strong> cookie tersimpan</div>
      </div>
      <div class="panel-footer">
        ${session.id !== 'default' ? `
          <button class="btn-sm-edit" data-id="${session.id}">Edit</button>
          <button class="btn-sm-delete" data-id="${session.id}">Hapus</button>
        ` : `
          <span style="font-size: 11px; color: var(--text-muted);">Session Default</span>
        `}
      </div>
    `;

    sessionsGrid.appendChild(panel);
  });
}

// Render Live Browser Tabs
async function renderTabsTable() {
  if (!tabsTableBody) return;
  tabsTableBody.innerHTML = '';

  try {
    const tabs = await chrome.tabs.query({});
    const validTabs = tabs.filter(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));

    if (validTabs.length === 0) {
      tabsTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
            Tidak ada tab website yang sedang terbuka.
          </td>
        </tr>
      `;
      return;
    }

    validTabs.forEach(tab => {
      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch {}

      const assignedSessionId = tabSessionMap[tab.id] || domainSessionMap[domain] || 'default';
      const session = sessions[assignedSessionId] || sessions['default'] || { name: 'Default', color: '#faae2b', icon: '👤' };

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="tab-pill-badge">#${tab.id}</span></td>
        <td>
          <div style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <strong>${escapeHtml(tab.title || domain)}</strong>
            <div style="font-size: 11px; color: var(--ink-secondary);">${escapeHtml(domain)}</div>
          </div>
        </td>
        <td>
          <select class="custom-select tab-session-select" data-tab-id="${tab.id}" data-domain="${domain}" style="min-width: 170px; padding: 6px 10px; font-size: 12px;">
            ${Object.values(sessions).map(s => `
              <option value="${s.id}" ${s.id === assignedSessionId ? 'selected' : ''}>
                ${s.icon || '📌'} ${escapeHtml(s.name)}
              </option>
            `).join('')}
          </select>
        </td>
        <td>
          <button class="btn-secondary btn-focus-tab" data-tab-id="${tab.id}" style="padding: 5px 10px; font-size: 12px;">
            Buka Tab
          </button>
        </td>
      `;
      tabsTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error listing tabs:', err);
  }
}

// Render Cookies Table
function renderCookiesTable() {
  cookiesTableBody.innerHTML = '';
  const rows = [];

  for (const [sessId, domainsObj] of Object.entries(sessionCookies)) {
    const session = sessions[sessId] || { name: sessId, color: '#faae2b', icon: '👤' };
    for (const [domain, cookieList] of Object.entries(domainsObj)) {
      if (cookieList && cookieList.length > 0) {
        rows.push({
          domain,
          sessionId: sessId,
          sessionName: session.name,
          sessionColor: session.color,
          sessionIcon: session.icon,
          count: cookieList.length
        });
      }
    }
  }

  if (rows.length === 0) {
    cookiesTableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Belum ada cookies yang ditangkap. Buka website dan ubah session untuk mulai mengisolasi cookies.
        </td>
      </tr>
    `;
    return;
  }

  rows.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(item.domain)}</strong></td>
      <td>
        <span class="badge-session-tag" style="background: ${item.sessionColor}20; color: ${item.sessionColor};">
          ${item.sessionIcon || '📌'} ${escapeHtml(item.sessionName)}
        </span>
      </td>
      <td>${item.count} item</td>
      <td>
        <button class="btn-sm-delete btn-delete-domain-cookies" data-domain="${item.domain}" data-session="${item.sessionId}">
          Hapus
        </button>
      </td>
    `;
    cookiesTableBody.appendChild(tr);
  });
}

// Custom confirmation dialog (Promise-based)
function showConfirmDialog({
  title = 'Konfirmasi Tindakan',
  message = 'Apakah Anda yakin ingin melanjutkan?',
  confirmText = 'Hapus',
  cancelText = 'Batal',
  type = 'danger'
}) {
  return new Promise((resolve) => {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    btnDialogConfirm.textContent = confirmText;

    if (cancelText) {
      btnDialogCancel.textContent = cancelText;
      btnDialogCancel.style.display = 'block';
    } else {
      btnDialogCancel.style.display = 'none';
    }

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

// Setup Event Listeners
function setupEventListeners() {
  // Isolation Mode Selector
  selectIsolationMode?.addEventListener('change', async (e) => {
    const newMode = e.target.value;
    await chrome.storage.local.set({ isolationMode: newMode });
    isolationMode = newMode;
    showToast(`Mode isolasi disimpan: ${newMode === 'tab' ? 'Per-Tab' : 'Global Domain'}`);
  });

  // Floating Badge Toggle
  toggleFloatingBadge?.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    await chrome.runtime.sendMessage({
      action: 'SET_FLOATING_BADGE',
      showFloatingBadge: isEnabled
    });
    showToast(`Badge melayang di web: ${isEnabled ? 'Diaktifkan' : 'Dinonaktifkan'}`);
  });

  // Create session
  btnCreateSession.addEventListener('click', () => {
    openModal();
  });

  // Grid Action clicks
  sessionsGrid.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-sm-edit');
    const delBtn = e.target.closest('.btn-sm-delete');

    if (editBtn) {
      const id = editBtn.dataset.id;
      openModal(id);
    } else if (delBtn) {
      const id = delBtn.dataset.id;
      deleteSession(id);
    }
  });

  // Tab Table Actions (Reassign Tab Session or Focus Tab)
  tabsTableBody?.addEventListener('change', async (e) => {
    const select = e.target.closest('.tab-session-select');
    if (!select) return;

    const tabId = parseInt(select.dataset.tabId, 10);
    const domain = select.dataset.domain;
    const targetSessionId = select.value;

    chrome.runtime.sendMessage({
      action: 'SET_TAB_SESSION',
      tabId,
      domain,
      sessionId: targetSessionId,
      reload: true
    }, async () => {
      tabSessionMap[tabId] = targetSessionId;
      showToast(`Tab #${tabId} dipindahkan ke ${sessions[targetSessionId]?.name || 'Session'}`);
    });
  });

  tabsTableBody?.addEventListener('click', async (e) => {
    const focusBtn = e.target.closest('.btn-focus-tab');
    if (!focusBtn) return;

    const tabId = parseInt(focusBtn.dataset.tabId, 10);
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch {}
  });

  // Table Action clicks (Delete domain cookies)
  cookiesTableBody.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.btn-delete-domain-cookies');
    if (!delBtn) return;

    const domain = delBtn.dataset.domain;
    const sessionId = delBtn.dataset.session;
    const sessName = sessions[sessionId]?.name || sessionId;

    const confirmed = await showConfirmDialog({
      title: 'Hapus Cookie Domain',
      message: `Hapus snapshot cookie untuk website "${domain}" pada session "${sessName}"?`,
      confirmText: 'Ya, Hapus',
      cancelText: 'Batal',
      type: 'danger'
    });

    if (confirmed) {
      if (sessionCookies[sessionId]?.[domain]) {
        delete sessionCookies[sessionId][domain];
        await chrome.storage.local.set({ sessionCookies });
        await loadAllData();
        showToast(`Cookie ${domain} berhasil dihapus`);
      }
    }
  });

  // Export JSON
  btnExportJson.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['sessions', 'domainSessionMap', 'sessionCookies', 'isolationMode']);
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `multisession_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup berhasil didownload!');
  });

  // Import JSON
  inputImportFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported.sessions) {
          throw new Error('Struktur data JSON tidak sesuai format backup MultiSession');
        }

        const confirmed = await showConfirmDialog({
          title: 'Pulihkan Data Backup',
          message: `Ditemukan ${Object.keys(imported.sessions).length} session pada file backup. Apakah Anda ingin menimpa data saat ini dengan file ini?`,
          confirmText: 'Pulihkan Data',
          cancelText: 'Batal',
          type: 'info'
        });

        if (confirmed) {
          await chrome.storage.local.set({
            sessions: imported.sessions,
            domainSessionMap: imported.domainSessionMap || {},
            sessionCookies: imported.sessionCookies || {},
            isolationMode: imported.isolationMode || 'tab'
          });

          chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });
          await loadAllData();
          showToast('Data berhasil dipulihkan!');
        }
      } catch (err) {
        showConfirmDialog({
          title: 'Gagal Membaca File',
          message: 'Format file backup tidak valid: ' + err.message,
          confirmText: 'Tutup',
          cancelText: null,
          type: 'danger'
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Reset All
  btnResetAll.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog({
      title: 'Reset Seluruh Data Extension',
      message: 'PERINGATAN: Semua profil session kustom dan snapshot cookies yang tersimpan akan dihapus secara permanen.',
      confirmText: 'Ya, Reset Semua',
      cancelText: 'Batal',
      type: 'danger'
    });

    if (confirmed) {
      await chrome.storage.local.clear();
      chrome.runtime.reload();
      window.location.reload();
    }
  });

  // Modal handlers
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  document.getElementById('icon-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-opt');
    if (!btn) return;
    document.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedIcon = btn.dataset.icon;
  });

  document.getElementById('color-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.color-opt');
    if (!btn) return;
    document.querySelectorAll('.color-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedColor = btn.dataset.color;
  });

  sessionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = formSessionName.value.trim();
    const editId = formSessionId.value;

    if (!name) return;

    if (editId) {
      sessions[editId] = {
        ...sessions[editId],
        name,
        icon: selectedIcon,
        color: selectedColor
      };
    } else {
      const newId = `session-${Date.now()}`;
      sessions[newId] = {
        id: newId,
        name,
        icon: selectedIcon,
        color: selectedColor,
        createdAt: Date.now()
      };
    }

    await chrome.storage.local.set({ sessions });
    chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });

    closeModal();
    await loadAllData();
    showToast(editId ? 'Session diperbarui!' : 'Session baru dibuat!');
  });
}

function openModal(id = null) {
  if (id && sessions[id]) {
    const s = sessions[id];
    modalTitle.textContent = 'Edit Session';
    formSessionId.value = id;
    formSessionName.value = s.name;
    selectedIcon = s.icon || '👤';
    selectedColor = s.color || '#faae2b';
  } else {
    modalTitle.textContent = 'Buat Session Baru';
    formSessionId.value = '';
    formSessionName.value = '';
    selectedIcon = '👤';
    selectedColor = '#faae2b';
  }

  document.querySelectorAll('.icon-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.icon === selectedIcon);
  });
  document.querySelectorAll('.color-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.color === selectedColor);
  });

  modalOverlay.classList.add('active');
  formSessionName.focus();
}

function closeModal() {
  modalOverlay.classList.remove('active');
}

async function deleteSession(id) {
  if (id === 'default') {
    showConfirmDialog({
      title: 'Pemberitahuan',
      message: 'Session Default adalah profil sistem utama dan tidak dapat dihapus.',
      confirmText: 'Mengerti',
      cancelText: null,
      type: 'info'
    });
    return;
  }

  const s = sessions[id];
  const confirmed = await showConfirmDialog({
    title: 'Hapus Profil Session',
    message: `Apakah Anda yakin ingin menghapus session "${s?.name || id}"? Semua data cookie tersimpan untuk session ini akan dihapus permanen.`,
    confirmText: 'Ya, Hapus Session',
    cancelText: 'Batal',
    type: 'danger'
  });

  if (!confirmed) return;

  delete sessions[id];
  delete sessionCookies[id];

  for (const [dom, sessId] of Object.entries(domainSessionMap)) {
    if (sessId === id) {
      domainSessionMap[dom] = 'default';
    }
  }

  await chrome.storage.local.set({
    sessions,
    sessionCookies,
    domainSessionMap
  });

  chrome.runtime.sendMessage({ action: 'REFRESH_MENUS' });
  await loadAllData();
  showToast('Session dihapus');
}

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
