/**
 * MultiSession Pro - Content Script
 * Decorates Tab Favicon and In-Page Session Indicator (Clean Tab Title)
 */

(function () {
  let currentSession = null;
  let floatingPill = null;
  let originalFaviconUrl = null;
  let showFloatingBadge = true;

  // Initialize
  init();

  async function init() {
    // Clean up any previously added title prefix if present
    document.title = document.title.replace(/^\[.*?\]\s*/, '');

    // Capture original favicon
    const favLink = document.querySelector("link[rel*='icon']");
    if (favLink) {
      originalFaviconUrl = favLink.href;
    }

    // Load initial stored setting for floating badge
    try {
      const stored = await chrome.storage.local.get('showFloatingBadge');
      if (stored && stored.showFloatingBadge !== undefined) {
        showFloatingBadge = stored.showFloatingBadge !== false;
      }
    } catch {}

    // Request session info from background
    try {
      chrome.runtime.sendMessage({ action: 'GET_TAB_SESSION_FOR_CONTENT' }, (response) => {
        if (response) {
          if (response.showFloatingBadge !== undefined) {
            showFloatingBadge = response.showFloatingBadge !== false;
          }
          if (response.session) {
            currentSession = response.session;
            applyTabDecorations(response.session);
          }
        }
      });
    } catch {}

    // Listen for live updates
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'SESSION_CHANGED' && message.session) {
        currentSession = message.session;
        applyTabDecorations(message.session);
      } else if (message.action === 'TOGGLE_FLOATING_BADGE') {
        showFloatingBadge = message.showFloatingBadge !== false;
        if (!showFloatingBadge) {
          removeFloatingPill();
        } else if (currentSession) {
          updateFloatingPill(currentSession);
        }
      }
    });

    // Listen for direct storage changes
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.showFloatingBadge !== undefined) {
          showFloatingBadge = changes.showFloatingBadge.newValue !== false;
          if (!showFloatingBadge) {
            removeFloatingPill();
          } else if (currentSession) {
            updateFloatingPill(currentSession);
          }
        }
      });
    } catch {}
  }

  // Apply visual indicators (Favicon & Floating Pill)
  function applyTabDecorations(session) {
    if (!session) return;
    updateTabFavicon(session);
    if (showFloatingBadge) {
      updateFloatingPill(session);
    } else {
      removeFloatingPill();
    }
  }

  function removeFloatingPill() {
    if (floatingPill) {
      floatingPill.remove();
      floatingPill = null;
    }
  }

  // 1. Decorate Favicon with colored badge dot
  function updateTabFavicon(session) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    const favImg = new Image();
    favImg.crossOrigin = 'anonymous';

    const defaultFavicon = originalFaviconUrl || '/favicon.ico';

    favImg.onload = () => {
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(favImg, 0, 0, 32, 32);
      drawBadge(ctx, session);
      setNewFavicon(canvas.toDataURL('image/png'));
    };

    favImg.onerror = () => {
      // Fallback: draw circular icon with session color
      ctx.clearRect(0, 0, 32, 32);
      ctx.fillStyle = session.color || '#faae2b';
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(session.icon || '📌', 16, 17);

      setNewFavicon(canvas.toDataURL('image/png'));
    };

    favImg.src = defaultFavicon;
  }

  function drawBadge(ctx, session) {
    // Draw vibrant colored notification dot in bottom-right corner
    const color = session.color || '#faae2b';
    const x = 24;
    const y = 24;
    const radius = 7;

    // Outer dark stroke
    ctx.beginPath();
    ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#18181b';
    ctx.fill();

    // Colored badge
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function setNewFavicon(dataUrl) {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'shortcut icon';
      document.getElementsByTagName('head')[0].appendChild(link);
    }
    link.type = 'image/png';
    link.href = dataUrl;
  }

  // 2. Floating In-Page Session Corner Pill
  function updateFloatingPill(session) {
    if (!showFloatingBadge) {
      removeFloatingPill();
      return;
    }

    if (!floatingPill) {
      floatingPill = document.createElement('div');
      floatingPill.id = 'multisession-floating-pill';
      document.body.appendChild(floatingPill);
    } else {
      floatingPill.style.display = '';
    }

    floatingPill.innerHTML = `
      <div class="multisession-pill-inner" style="--session-color: ${session.color || '#faae2b'};">
        <span class="multisession-pill-dot" style="background: ${session.color || '#faae2b'};"></span>
        <span class="multisession-pill-icon">${session.icon || '👤'}</span>
        <span class="multisession-pill-text">${escapeHtml(session.name)}</span>
        <button class="multisession-pill-close" title="Sembunyikan badge">&times;</button>
      </div>
    `;

    floatingPill.querySelector('.multisession-pill-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      floatingPill.style.display = 'none';
    });
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
})();
