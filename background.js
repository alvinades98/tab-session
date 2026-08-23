/**
 * MultiSession Pro - Background Service Worker
 * True Per-Tab & Per-Domain Session Isolation Engine for Chromium.
 * Features:
 * - Mutex-serialized atomic cookie swapping (zero race conditions)
 * - Persistent service worker state across lifecycles
 * - Domain hierarchy cookie protection & clean attribute handling
 * - Smart background tab protection (no background session overwriting)
 */

// In-memory runtime state (mirrored to storage for service worker restarts)
let tabSessionMap = {}; // { [tabId]: sessionId }
let groupSessionMap = {}; // { [groupId]: sessionId }
let activeDomainLoadedSession = {}; // { [domain]: sessionId }
let lastActiveTabId = null;
let lastActiveDomain = null;
let isInitialized = false;

// Mutex queue to serialize all cookie operations and avoid race conditions
let opQueue = Promise.resolve();
function runExclusive(fn) {
  const next = opQueue.then(fn, fn);
  opQueue = next.catch((err) => {
    console.error('[MultiSession] Exclusive operation error:', err);
  });
  return next;
}

// Storage accessor: prefer chrome.storage.session (survives SW suspend), fallback to local
function getSessionStorage() {
  return chrome.storage.session || chrome.storage.local;
}

// Restore state whenever service worker wakes up
async function ensureInitialized() {
  if (isInitialized) return;

  try {
    const storage = getSessionStorage();
    const sessionData = await storage.get([
      'tabSessionMap',
      'groupSessionMap',
      'activeDomainLoadedSession',
      'lastActiveTabId',
      'lastActiveDomain'
    ]);

    if (sessionData.tabSessionMap) tabSessionMap = { ...sessionData.tabSessionMap };
    if (sessionData.groupSessionMap) groupSessionMap = { ...sessionData.groupSessionMap };
    if (sessionData.activeDomainLoadedSession) activeDomainLoadedSession = { ...sessionData.activeDomainLoadedSession };
    if (sessionData.lastActiveTabId) lastActiveTabId = sessionData.lastActiveTabId;
    if (sessionData.lastActiveDomain) lastActiveDomain = sessionData.lastActiveDomain;

    const localData = await chrome.storage.local.get([
      'tabSessionMap',
      'groupSessionMap',
      'activeDomainLoadedSession'
    ]);

    if (Object.keys(tabSessionMap).length === 0 && localData.tabSessionMap) {
      tabSessionMap = { ...localData.tabSessionMap };
    }
    if (Object.keys(groupSessionMap).length === 0 && localData.groupSessionMap) {
      groupSessionMap = { ...localData.groupSessionMap };
    }
    if (Object.keys(activeDomainLoadedSession).length === 0 && localData.activeDomainLoadedSession) {
      activeDomainLoadedSession = { ...localData.activeDomainLoadedSession };
    }
  } catch (e) {
    console.warn('[MultiSession] Init state error:', e);
  }

  isInitialized = true;
}

// Persist runtime state
async function persistState() {
  try {
    const storage = getSessionStorage();
    const state = {
      tabSessionMap,
      groupSessionMap,
      activeDomainLoadedSession,
      lastActiveTabId,
      lastActiveDomain
    };
    await storage.set(state);
    await chrome.storage.local.set({
      tabSessionMap,
      groupSessionMap,
      activeDomainLoadedSession
    });
  } catch (e) {
    console.warn('[MultiSession] Error persisting state:', e);
  }
}

// Track the foreground tab (domain may be null for non-http pages)
async function trackActiveTab(tabId, domain) {
  lastActiveTabId = tabId;
  lastActiveDomain = domain;
  await persistState();
}

// Initialize on install / startup
chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get([
    'sessions',
    'domainSessionMap',
    'sessionCookies',
    'isolationMode',
    'tabSessionMap',
    'groupSessionMap'
  ]);

  if (!data.sessions || Object.keys(data.sessions).length === 0) {
    const defaultSessions = {
      'default': {
        id: 'default',
        name: 'Personal / Default',
        color: '#faae2b',
        icon: '👤',
        createdAt: Date.now()
      },
      'session-work': {
        id: 'session-work',
        name: 'Work / Kantor',
        color: '#f36c21',
        icon: '💼',
        createdAt: Date.now() + 1
      },
      'session-alt1': {
        id: 'session-alt1',
        name: 'Account 2 / Alt',
        color: '#a78bfa',
        icon: '⚡',
        createdAt: Date.now() + 2
      }
    };

    await chrome.storage.local.set({
      sessions: defaultSessions,
      domainSessionMap: {},
      sessionCookies: {},
      isolationMode: 'tab',
      showFloatingBadge: true,
      tabSessionMap: {},
      groupSessionMap: {}
    });
  }

  if (data.tabSessionMap) {
    tabSessionMap = { ...data.tabSessionMap };
  }
  if (data.groupSessionMap) {
    groupSessionMap = { ...data.groupSessionMap };
  }

  await setupContextMenus();
});

// Helper: Extract hostname from URL
function extractDomain(urlStr) {
  try {
    if (!urlStr) return null;
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

// Helper: Format URL for cookie remove / set
function getCookieUrl(cookie) {
  const cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
  const protocol = cookie.secure ? 'https:' : 'http:';
  return `${protocol}//${cleanDomain}${cookie.path || '/'}`;
}

// Helper: Get isolation mode
async function getIsolationMode() {
  const { isolationMode = 'tab' } = await chrome.storage.local.get('isolationMode');
  return isolationMode;
}

// Helper: Find session matching a Tab Group's title (Strict matching to prevent accidental session override)
function findSessionForGroupTitle(groupTitle, sessions) {
  if (!groupTitle) return null;
  const cleanTitle = groupTitle.trim().toLowerCase();

  for (const session of Object.values(sessions)) {
    const sName = session.name.trim().toLowerCase();
    const fullExpected = `${session.icon || '📌'} ${session.name}`.trim().toLowerCase();
    if (cleanTitle === sName || cleanTitle === fullExpected) {
      return session;
    }
  }
  return null;
}

// Get the intended session ID for a specific tab and domain
async function getSessionForTab(tabId, domain) {
  await ensureInitialized();

  // 1. Direct in-memory tab session
  if (tabId && tabSessionMap[tabId]) {
    return tabSessionMap[tabId];
  }

  // 2. Check if tab is in a Chrome Tab Group with a mapped session
  if (tabId && chrome.tabGroups) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.groupId && tab.groupId > 0) {
        if (groupSessionMap[tab.groupId]) {
          tabSessionMap[tabId] = groupSessionMap[tab.groupId];
          await persistState();
          return groupSessionMap[tab.groupId];
        }
        const group = await chrome.tabGroups.get(tab.groupId);
        const { sessions = {} } = await chrome.storage.local.get('sessions');
        const matched = findSessionForGroupTitle(group?.title, sessions);
        if (matched) {
          groupSessionMap[tab.groupId] = matched.id;
          tabSessionMap[tabId] = matched.id;
          await persistState();
          return matched.id;
        }
      }
    } catch {}
  }

  // 3. Storage lookup
  const { tabSessionMap: storedMap = {}, domainSessionMap = {} } = await chrome.storage.local.get([
    'tabSessionMap',
    'domainSessionMap'
  ]);
  if (tabId && storedMap[tabId]) {
    tabSessionMap[tabId] = storedMap[tabId];
    await persistState();
    return storedMap[tabId];
  }

  if (domain && domainSessionMap[domain]) {
    return domainSessionMap[domain];
  }

  return 'default';
}

// Save all active browser cookies for a domain into a specific session's storage
async function saveCookiesForDomain(domain, sessionId, force = false) {
  if (!domain || !sessionId) return 0;

  // SAFETY GUARD: Never snapshot cookies into sessionId if active browser cookies belong to a different session!
  if (!force && activeDomainLoadedSession[domain] && activeDomainLoadedSession[domain] !== sessionId) {
    console.warn(`[MultiSession] Prevented accidental cookie overwrite: domain ${domain} currently loaded with session "${activeDomainLoadedSession[domain]}", but tried to save as "${sessionId}".`);
    return 0;
  }

  try {
    const cookies = await chrome.cookies.getAll({ domain });
    const { sessionCookies = {} } = await chrome.storage.local.get('sessionCookies');

    if (!sessionCookies[sessionId]) {
      sessionCookies[sessionId] = {};
    }

    sessionCookies[sessionId][domain] = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate,
      storeId: c.storeId
    }));

    await chrome.storage.local.set({ sessionCookies });
    return cookies.length;
  } catch (err) {
    console.error(`[MultiSession] Error saving cookies for ${domain}:`, err);
    return 0;
  }
}

// Clear active browser cookies for a domain
async function clearCookiesForDomain(domain) {
  if (!domain) return;
  try {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const cookie of cookies) {
      const url = getCookieUrl(cookie);
      try {
        await chrome.cookies.remove({
          url: url,
          name: cookie.name,
          storeId: cookie.storeId
        });
      } catch (removeErr) {
        console.warn(`[MultiSession] Failed to remove cookie ${cookie.name}:`, removeErr);
      }
    }
  } catch (err) {
    console.error(`[MultiSession] Error clearing cookies for ${domain}:`, err);
  }
}

// Restore saved cookies for a domain from a specific session into the browser
async function restoreCookiesForDomain(domain, sessionId) {
  if (!domain || !sessionId) return;
  try {
    const { sessionCookies = {} } = await chrome.storage.local.get('sessionCookies');
    const stored = sessionCookies[sessionId]?.[domain] || [];

    for (const cookie of stored) {
      const url = getCookieUrl(cookie);
      const cookieData = {
        url: url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly
      };

      if (cookie.storeId) {
        cookieData.storeId = cookie.storeId;
      }

      if (cookie.sameSite && ['no_restriction', 'lax', 'strict', 'unspecified'].includes(cookie.sameSite)) {
        cookieData.sameSite = cookie.sameSite;
      }

      // Chromium requirement: SameSite=None requires Secure=true and HTTPS URL
      if (cookieData.sameSite === 'no_restriction') {
        cookieData.secure = true;
        if (cookieData.url.startsWith('http://')) {
          cookieData.url = cookieData.url.replace('http://', 'https://');
        }
      }

      // Set domain only for domain cookies (leading dot) and non-__Host- prefixed cookies
      const isHostOnly = !cookie.domain || !cookie.domain.startsWith('.');
      const isHostPrefixed = cookie.name.startsWith('__Host-');
      if (!isHostOnly && !isHostPrefixed) {
        cookieData.domain = cookie.domain;
      }

      if (cookie.expirationDate) {
        if (cookie.expirationDate > Date.now() / 1000) {
          cookieData.expirationDate = cookie.expirationDate;
        } else {
          continue; // Expired cookie, skip
        }
      }

      try {
        await chrome.cookies.set(cookieData);
      } catch {
        // Fallback without domain parameter (set as host-only)
        delete cookieData.domain;
        try {
          await chrome.cookies.set(cookieData);
        } catch (subErr) {
          console.warn(`[MultiSession] Could not restore cookie ${cookie.name}:`, subErr);
        }
      }
    }
  } catch (err) {
    console.error(`[MultiSession] Error restoring cookies for ${domain}:`, err);
  }
}

// Ensure browser has the cookies for target session on this domain (Atomic)
// Returns true only when an actual cookie swap (clear + restore) happened
async function loadSessionCookies(domain, targetSessionId) {
  if (!domain || !targetSessionId) return false;

  const currentLoaded = activeDomainLoadedSession[domain];
  if (currentLoaded === targetSessionId) {
    return false; // Target session cookies are already loaded
  }

  if (currentLoaded) {
    // Save current active state before wiping browser cookies
    await saveCookiesForDomain(domain, currentLoaded, true);
  }

  // Clear & Restore target session
  await clearCookiesForDomain(domain);
  await restoreCookiesForDomain(domain, targetSessionId);
  activeDomainLoadedSession[domain] = targetSessionId;
  await persistState();
  return true;
}

// Map session hex color to Chrome Tab Group color
function getChromeTabGroupColor(hex) {
  const map = {
    '#6366f1': 'blue',
    '#0ea5e9': 'cyan',
    '#10b981': 'green',
    '#f59e0b': 'yellow',
    '#ef4444': 'red',
    '#ec4899': 'pink',
    '#8b5cf6': 'purple',
    '#14b8a6': 'cyan'
  };
  return map[hex] || 'grey';
}

// Automatically group tabs into native colored Chrome Tab Groups
async function syncChromeTabGroup(tabId, session) {
  try {
    if (!chrome.tabGroups || !tabId) return;
    const { enableTabGroups = true } = await chrome.storage.local.get('enableTabGroups');
    if (!enableTabGroups) return;

    // Check if tab is already in a group with this session
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId > 0 && groupSessionMap[tab.groupId] === session.id) {
      return;
    }

    const groupId = await chrome.tabs.group({ tabIds: tabId });
    groupSessionMap[groupId] = session.id;
    await persistState();

    await chrome.tabGroups.update(groupId, {
      title: `${session.icon || '📌'} ${session.name}`,
      color: getChromeTabGroupColor(session.color)
    });
  } catch {
    // Tab groups might not be available or permitted
  }
}

// Set session for a specific Tab
async function setSessionForTab(tabId, sessionId, domain = null, reload = true) {
  if (!tabId || !sessionId) return { success: false, error: 'Invalid parameters' };

  await ensureInitialized();
  tabSessionMap[tabId] = sessionId;
  await persistState();

  const { sessions = {} } = await chrome.storage.local.get('sessions');
  const session = sessions[sessionId] || sessions['default'];

  if (session) {
    await syncChromeTabGroup(tabId, session);
    chrome.tabs.sendMessage(tabId, { action: 'SESSION_CHANGED', session }).catch(() => {});
  }

  if (domain) {
    await loadSessionCookies(domain, sessionId);
    await updateBadgeForTab(tabId, domain, sessionId);
    if (reload) {
      try {
        await chrome.tabs.reload(tabId);
      } catch {}
    }
  }

  return { success: true, tabId, sessionId };
}

// Set session globally for a Domain
async function setSessionForDomain(domain, sessionId, currentTabId = null) {
  if (!domain || !sessionId) return { success: false, error: 'Invalid parameters' };

  await ensureInitialized();
  const { domainSessionMap = {}, sessions = {} } = await chrome.storage.local.get([
    'domainSessionMap',
    'sessions'
  ]);
  domainSessionMap[domain] = sessionId;
  await chrome.storage.local.set({ domainSessionMap });

  await loadSessionCookies(domain, sessionId);

  const session = sessions[sessionId] || sessions['default'];

  if (currentTabId) {
    tabSessionMap[currentTabId] = sessionId;
    await persistState();
    await updateBadgeForTab(currentTabId, domain, sessionId);
    if (session) {
      await syncChromeTabGroup(currentTabId, session);
      chrome.tabs.sendMessage(currentTabId, { action: 'SESSION_CHANGED', session }).catch(() => {});
    }
    try {
      await chrome.tabs.reload(currentTabId);
    } catch {}
  }

  return { success: true, domain, sessionId };
}

// Open a new tab isolated in a specific session (Atomic execution)
async function openNewTabWithSession(url, sessionId) {
  return runExclusive(async () => {
    await ensureInitialized();
    try {
      const domain = extractDomain(url);

      // 1. Save current active tab cookies first before altering browser state
      if (lastActiveTabId && lastActiveDomain) {
        const prevSession = await getSessionForTab(lastActiveTabId, lastActiveDomain);
        if (activeDomainLoadedSession[lastActiveDomain] === prevSession) {
          await saveCookiesForDomain(lastActiveDomain, prevSession, true);
        }
      }

      // 2. Pre-load target session cookies for this domain
      if (domain) {
        await loadSessionCookies(domain, sessionId);
      }

      // 3. Create the new tab as active
      const newTab = await chrome.tabs.create({ url, active: true });

      // 4. Store tab mapping immediately
      tabSessionMap[newTab.id] = sessionId;
      lastActiveTabId = newTab.id;
      lastActiveDomain = domain;
      await persistState();

      const { sessions = {} } = await chrome.storage.local.get('sessions');
      const session = sessions[sessionId] || sessions['default'];

      if (session) {
        await syncChromeTabGroup(newTab.id, session);
      }

      if (domain) {
        await updateBadgeForTab(newTab.id, domain, sessionId);
      }

      return { success: true, tabId: newTab.id };
    } catch (err) {
      console.error('[MultiSession] Error opening tab with session:', err);
      return { success: false, error: err.message };
    }
  });
}

// Update Extension Action Badge for a specific tab
async function updateBadgeForTab(tabId, domain, explicitSessionId = null) {
  try {
    if (!domain || !tabId) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }

    const sessionId = explicitSessionId || (await getSessionForTab(tabId, domain));
    const { sessions = {} } = await chrome.storage.local.get('sessions');
    const session = sessions[sessionId] || sessions['default'];

    if (session) {
      const badgeText = session.name.substring(0, 3).toUpperCase();
      await chrome.action.setBadgeText({ tabId, text: badgeText });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: session.color || '#faae2b' });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (err) {
    // Tab might no longer exist
  }
}

// Context Menus
async function setupContextMenus() {
  try {
    await chrome.contextMenus.removeAll();

    chrome.contextMenus.create({
      id: 'multisession_root',
      title: 'MultiSession Pro',
      contexts: ['page', 'action', 'link']
    });

    const { sessions = {} } = await chrome.storage.local.get('sessions');
    const sessionList = Object.values(sessions);

    // 1. Submenu: Open link in new tab with session
    chrome.contextMenus.create({
      id: 'open_link_session_root',
      parentId: 'multisession_root',
      title: '🔗 Buka Link di Tab Session Baru',
      contexts: ['link']
    });

    for (const s of sessionList) {
      chrome.contextMenus.create({
        id: `open_link_${s.id}`,
        parentId: 'open_link_session_root',
        title: `${s.icon || '📌'} ${s.name}`,
        contexts: ['link']
      });
    }

    // 2. Submenu: Open / duplicate this page in new tab with session
    chrome.contextMenus.create({
      id: 'open_page_session_root',
      parentId: 'multisession_root',
      title: '📑 Buka Halaman Ini di Tab Session Baru',
      contexts: ['page', 'action']
    });

    for (const s of sessionList) {
      chrome.contextMenus.create({
        id: `open_page_${s.id}`,
        parentId: 'open_page_session_root',
        title: `${s.icon || '📌'} ${s.name}`,
        contexts: ['page', 'action']
      });
    }

    // 3. Submenu: Switch this tab to session
    chrome.contextMenus.create({
      id: 'switch_tab_session_root',
      parentId: 'multisession_root',
      title: '⚡ Ganti Session Tab Ini',
      contexts: ['page', 'action']
    });

    for (const s of sessionList) {
      chrome.contextMenus.create({
        id: `switch_tab_${s.id}`,
        parentId: 'switch_tab_session_root',
        title: `${s.icon || '📌'} ${s.name}`,
        contexts: ['page', 'action']
      });
    }
  } catch (err) {
    console.error('Error creating context menus:', err);
  }
}

// Context Menu click events
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId.startsWith('open_link_') && info.linkUrl) {
    const sessionId = info.menuItemId.replace('open_link_', '');
    await openNewTabWithSession(info.linkUrl, sessionId);
  } else if (info.menuItemId.startsWith('open_page_')) {
    const url = info.pageUrl || tab?.url;
    if (url) {
      const sessionId = info.menuItemId.replace('open_page_', '');
      await openNewTabWithSession(url, sessionId);
    }
  } else if (info.menuItemId.startsWith('switch_tab_') && tab?.url) {
    const sessionId = info.menuItemId.replace('switch_tab_', '');
    const domain = extractDomain(tab.url);
    if (domain) {
      await runExclusive(async () => {
        await setSessionForTab(tab.id, sessionId, domain, true);
      });
    }
  }
});

// Event: Tab Activated (User switched between tabs)
chrome.tabs.onActivated.addListener((activeInfo) => {
  runExclusive(async () => {
    await ensureInitialized();
    const currentTabId = activeInfo.tabId;

    let tab;
    try {
      tab = await chrome.tabs.get(currentTabId);
    } catch {
      return; // Tab closed or unavailable
    }

    if (!tab?.url) {
      await trackActiveTab(currentTabId, null);
      return;
    }

    const domain = extractDomain(tab.url);
    if (!domain) {
      // Non-http pages hold no cookies; refresh tracking so a stale
      // previous-tab snapshot can never fire on the next activation
      await trackActiveTab(currentTabId, null);
      return;
    }

    // 1. Save state of previous active tab before switching
    if (lastActiveTabId && lastActiveDomain && lastActiveTabId !== currentTabId) {
      const prevSession = await getSessionForTab(lastActiveTabId, lastActiveDomain);
      if (activeDomainLoadedSession[lastActiveDomain] === prevSession) {
        await saveCookiesForDomain(lastActiveDomain, prevSession, true);
      }
    }

    // 2. Get target session for this newly activated tab
    const targetSession = await getSessionForTab(currentTabId, domain);

    // 3. Load cookies for this tab's session
    const swapped = await loadSessionCookies(domain, targetSession);
    await updateBadgeForTab(currentTabId, domain, targetSession);

    // 4. Update tracking
    await trackActiveTab(currentTabId, domain);

    // Reload once so the page re-authenticates against the correct cookie jar.
    // Skipped when no swap occurred (target session was already loaded).
    if (swapped) {
      try {
        await chrome.tabs.reload(currentTabId);
      } catch {}
    }

    // 5. Notify content script to synchronize visuals
    const { sessions = {} } = await chrome.storage.local.get('sessions');
    const session = sessions[targetSession] || sessions['default'];
    if (session) {
      chrome.tabs.sendMessage(currentTabId, { action: 'SESSION_CHANGED', session }).catch(() => {});
    }
  });
});

// Event: Tab navigation / update & Tab Group drag detector
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 1. Detect when a tab is dragged/moved into a Chrome Tab Group
  if (changeInfo.groupId !== undefined && changeInfo.groupId > 0) {
    runExclusive(async () => {
      await ensureInitialized();
      try {
        const group = await chrome.tabGroups.get(changeInfo.groupId);
        const { sessions = {} } = await chrome.storage.local.get('sessions');

        let matchedSession = groupSessionMap[changeInfo.groupId]
          ? sessions[groupSessionMap[changeInfo.groupId]]
          : null;

        if (!matchedSession && group?.title) {
          matchedSession = findSessionForGroupTitle(group.title, sessions);
        }

        if (matchedSession) {
          groupSessionMap[changeInfo.groupId] = matchedSession.id;
          const currentTabSessionId = tabSessionMap[tabId];
          if (currentTabSessionId !== matchedSession.id) {
            const tabObj = tab.url ? tab : await chrome.tabs.get(tabId);
            const domain = extractDomain(tabObj?.url);
            if (domain) {
              await setSessionForTab(tabId, matchedSession.id, domain, true);
            } else {
              tabSessionMap[tabId] = matchedSession.id;
              await persistState();
            }
          }
        }
      } catch (err) {
        console.warn('[MultiSession] Error handling tab group drag:', err);
      }
    });
  }

  // 2. Navigation completion
  if (changeInfo.status === 'complete' && tab?.url) {
    runExclusive(async () => {
      await ensureInitialized();
      const domain = extractDomain(tab.url);
      if (!domain) return;

      const targetSession = await getSessionForTab(tabId, domain);
      await updateBadgeForTab(tabId, domain, targetSession);

      // CRITICAL FIX: Only snapshot cookies if this tab is the ACTIVE foreground tab
      // and the browser's currently loaded cookies match targetSession!
      if (tab.active && activeDomainLoadedSession[domain] === targetSession) {
        await saveCookiesForDomain(domain, targetSession, true);
      }
    });
  }
});

// Event: Chrome Tab Group updated (title / color changed)
if (chrome.tabGroups) {
  chrome.tabGroups.onUpdated.addListener((group) => {
    runExclusive(async () => {
      await ensureInitialized();
      try {
        const { sessions = {} } = await chrome.storage.local.get('sessions');
        const matched = findSessionForGroupTitle(group.title, sessions);
        if (matched) {
          groupSessionMap[group.id] = matched.id;
          await persistState();
        }
      } catch {}
    });
  });

  chrome.tabGroups.onRemoved.addListener((group) => {
    runExclusive(async () => {
      await ensureInitialized();
      if (groupSessionMap[group.id]) {
        delete groupSessionMap[group.id];
        await persistState();
      }
    });
  });
}

// Event: Pre-navigation cookie injection for active tabs only
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0 && details.tabId > 0) {
    runExclusive(async () => {
      await ensureInitialized();
      try {
        const tab = await chrome.tabs.get(details.tabId);
        // CRITICAL FIX: Only swap cookies for the currently active foreground tab!
        // Background tab navigations must never swap the global browser cookies!
        if (!tab?.active) return;

        const domain = extractDomain(details.url);
        if (domain) {
          const targetSession = await getSessionForTab(details.tabId, domain);
          await loadSessionCookies(domain, targetSession);
        }
      } catch {}
    });
  }
});

// Event: Tab closed (cleanup in-memory and persistent map)
chrome.tabs.onRemoved.addListener((tabId) => {
  runExclusive(async () => {
    await ensureInitialized();
    if (tabSessionMap[tabId]) {
      delete tabSessionMap[tabId];
    }
    if (lastActiveTabId === tabId) {
      lastActiveTabId = null;
      lastActiveDomain = null;
    }
    await persistState();
  });
});

// Handle incoming messages from popup & options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureInitialized();
    switch (message.action) {
      case 'GET_STATUS_INFO': {
        const { tabId, domain } = message;
        const isolationMode = await getIsolationMode();
        const tabSessionId = tabSessionMap[tabId] || null;
        const { domainSessionMap = {}, sessions = {}, sessionCookies = {}, showFloatingBadge = true } = await chrome.storage.local.get([
          'domainSessionMap',
          'sessions',
          'sessionCookies',
          'showFloatingBadge'
        ]);
        const domainSessionId = domain ? (domainSessionMap[domain] || 'default') : 'default';
        const activeSessionId = await getSessionForTab(tabId, domain);
        const cookieCount = sessionCookies[activeSessionId]?.[domain]?.length || 0;

        sendResponse({
          domain,
          tabId,
          isolationMode,
          tabSessionId,
          domainSessionId,
          activeSessionId,
          sessions,
          cookieCount,
          showFloatingBadge
        });
        break;
      }

      case 'SET_FLOATING_BADGE': {
        const showFloatingBadge = message.showFloatingBadge !== false;
        await chrome.storage.local.set({ showFloatingBadge });
        try {
          const tabs = await chrome.tabs.query({});
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                action: 'TOGGLE_FLOATING_BADGE',
                showFloatingBadge
              }).catch(() => {});
            }
          }
        } catch {}
        sendResponse({ success: true, showFloatingBadge });
        break;
      }

      case 'SET_TAB_SESSION': {
        const res = await runExclusive(async () => {
          return await setSessionForTab(message.tabId, message.sessionId, message.domain, message.reload !== false);
        });
        sendResponse(res);
        break;
      }

      case 'SET_DOMAIN_SESSION': {
        const res = await runExclusive(async () => {
          return await setSessionForDomain(message.domain, message.sessionId, message.tabId);
        });
        sendResponse(res);
        break;
      }

      case 'OPEN_NEW_TAB_WITH_SESSION': {
        const res = await openNewTabWithSession(message.url, message.sessionId);
        sendResponse(res);
        break;
      }

      case 'SET_ISOLATION_MODE': {
        await chrome.storage.local.set({ isolationMode: message.mode });
        sendResponse({ success: true, mode: message.mode });
        break;
      }

      case 'SAVE_CURRENT_COOKIES': {
        const result = await runExclusive(async () => {
          const jarOwner = activeDomainLoadedSession[message.domain];
          if (jarOwner !== message.sessionId) {
            console.warn(`[MultiSession] Blocked cookie save: jar holds "${jarOwner}", refusing to write into "${message.sessionId}".`);
            return { blocked: true, count: 0 };
          }
          const count = await saveCookiesForDomain(message.domain, message.sessionId, true);
          return { blocked: false, count };
        });
        sendResponse({
          success: !result?.blocked,
          count: result?.count || 0,
          error: result?.blocked ? 'session-mismatch' : undefined
        });
        break;
      }

      case 'CLEAR_SESSION_COOKIES': {
        await runExclusive(async () => {
          const { sessionCookies = {} } = await chrome.storage.local.get('sessionCookies');
          if (sessionCookies[message.sessionId]?.[message.domain]) {
            delete sessionCookies[message.sessionId][message.domain];
            await chrome.storage.local.set({ sessionCookies });
          }
          if (message.clearBrowserToo) {
            await clearCookiesForDomain(message.domain);
            delete activeDomainLoadedSession[message.domain];
            await persistState();
          }
        });
        sendResponse({ success: true });
        break;
      }

      case 'REFRESH_MENUS': {
        await setupContextMenus();
        sendResponse({ success: true });
        break;
      }

      case 'GET_TAB_SESSION_FOR_CONTENT': {
        const tabId = sender.tab?.id;
        const domain = extractDomain(sender.tab?.url);
        const sessionId = await getSessionForTab(tabId, domain);
        const { sessions = {}, showFloatingBadge = true } = await chrome.storage.local.get(['sessions', 'showFloatingBadge']);
        const session = sessions[sessionId] || sessions['default'];
        sendResponse({ session, showFloatingBadge });
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  return true;
});
