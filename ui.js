// ==========================================================================
// SHARED UI — Custom right-click menu + Status indicator
// Include on every page: <script src="ui.js"></script>
// ==========================================================================

(function() {

  // ============ STATUS INDICATOR ============
  // Edit STATUS below to change site status everywhere at once.
  // Options: 'online', 'issues', 'down', 'maintenance'
  const STATUS = 'maintenance';

  const STATUS_INFO = {
    online:      { label: 'OPERATIONAL', color: '#3dd676', glow: 'rgba(61, 214, 118, 0.6)' },
    issues:      { label: 'DEGRADED',    color: '#e8a93d', glow: 'rgba(232, 169, 61, 0.6)' },
    down:        { label: 'OFFLINE',     color: '#d63a3a', glow: 'rgba(214, 58, 58, 0.6)' },
    maintenance: { label: 'MAINTENANCE', color: '#9d6cd1', glow: 'rgba(157, 108, 209, 0.6)' }
  };

  function buildStatus() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    const info = STATUS_INFO[STATUS] || STATUS_INFO.maintenance;
    const el = document.createElement('div');
    el.className = 'status-pill';
    el.innerHTML = `
      <style>
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.35rem 0.7rem;
          border: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.6rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--gray);
          margin-right: 1rem;
          cursor: crosshair;
          transition: all 0.2s;
        }
        .status-pill:hover {
          border-color: ${info.color};
          color: var(--fg);
        }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${info.color};
          box-shadow: 0 0 8px ${info.glow}, 0 0 14px ${info.glow};
          animation: statusPulse 1.8s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes statusPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
        @media (max-width: 800px) {
          .status-pill { font-size: 0.55rem; padding: 0.25rem 0.5rem; margin-right: 0.5rem; }
        }
      </style>
      <span class="status-dot"></span>
      <span>${info.label}</span>
    `;
    el.title = `Service status: ${info.label}`;
    // Insert before the <ul> in the nav
    const ul = nav.querySelector('ul');
    if (ul) {
      ul.parentNode.insertBefore(el, ul);
    } else {
      nav.appendChild(el);
    }
  }

  // ============ CUSTOM RIGHT-CLICK MENU ============
  function buildContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.innerHTML = `
      <style>
        #ctx-menu {
          position: fixed;
          background: var(--bg-2);
          border: 1px solid var(--border);
          min-width: 220px;
          padding: 0.4rem;
          font-family: 'JetBrains Mono', monospace;
          z-index: 99999;
          opacity: 0;
          transform: scale(0.95);
          pointer-events: none;
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 0 30px var(--accent-glow);
        }
        #ctx-menu.open {
          opacity: 1;
          transform: scale(1);
          pointer-events: auto;
        }
        #ctx-menu .ctx-header {
          font-family: 'Cinzel', serif;
          font-size: 0.65rem;
          letter-spacing: 0.3em;
          color: var(--accent-2);
          text-transform: uppercase;
          padding: 0.6rem 0.7rem 0.4rem;
          border-bottom: 1px solid var(--border);
          margin-bottom: 0.3rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #ctx-menu .ctx-header .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-2);
          animation: statusPulse 1.5s ease-in-out infinite;
        }
        #ctx-menu .ctx-item {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          padding: 0.55rem 0.7rem;
          color: var(--fg);
          cursor: crosshair;
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          transition: all 0.15s;
          border: 1px solid transparent;
        }
        #ctx-menu .ctx-item:hover {
          background: var(--bg);
          border-color: var(--border);
          color: var(--accent-2);
        }
        #ctx-menu .ctx-item .icon {
          color: var(--accent-2);
          font-size: 0.9rem;
          width: 14px;
          text-align: center;
        }
        #ctx-menu .ctx-item .kbd {
          margin-left: auto;
          font-size: 0.6rem;
          color: var(--muted);
          letter-spacing: 0.1em;
        }
        #ctx-menu .ctx-sep {
          height: 1px;
          background: var(--border);
          margin: 0.3rem 0;
        }
        #ctx-menu .ctx-foot {
          padding: 0.4rem 0.7rem 0.2rem;
          font-size: 0.55rem;
          letter-spacing: 0.2em;
          color: var(--muted);
          text-transform: uppercase;
          text-align: center;
          border-top: 1px solid var(--border);
          margin-top: 0.3rem;
        }
      </style>
      <div class="ctx-header">
        <span>S.S.P.</span>
        <span class="dot"></span>
      </div>
      <div class="ctx-item" data-action="home">
        <span class="icon">⌂</span>
        <span>Home</span>
      </div>
      <div class="ctx-item" data-action="database">
        <span class="icon">⌕</span>
        <span>Database</span>
      </div>
      <div class="ctx-item" data-action="credits">
        <span class="icon">✦</span>
        <span>Credits</span>
      </div>
      <div class="ctx-item" data-action="terminal">
        <span class="icon">▸</span>
        <span>Terminal</span>
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-action="copy-url">
        <span class="icon">⧉</span>
        <span>Copy URL</span>
      </div>
      <div class="ctx-item" data-action="reload">
        <span class="icon">↻</span>
        <span>Reload</span>
        <span class="kbd">F5</span>
      </div>
      <div class="ctx-item" data-action="back">
        <span class="icon">←</span>
        <span>Back</span>
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-action="discord">
        <span class="icon">◆</span>
        <span>Join Discord</span>
      </div>
      <div class="ctx-foot">— Eyes Only —</div>
    `;
    document.body.appendChild(menu);

    // Show on right-click
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const x = e.clientX;
      const y = e.clientY;
      // Show first so we can measure size
      menu.classList.add('open');
      const rect = menu.getBoundingClientRect();
      const finalX = Math.min(x, window.innerWidth - rect.width - 10);
      const finalY = Math.min(y, window.innerHeight - rect.height - 10);
      menu.style.left = finalX + 'px';
      menu.style.top = finalY + 'px';
    });

    // Hide on left-click anywhere
    document.addEventListener('click', () => {
      menu.classList.remove('open');
    });

    // Hide on scroll / escape
    window.addEventListener('scroll', () => menu.classList.remove('open'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.classList.remove('open');
    });

    // Handle clicks on menu items
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      const action = item.dataset.action;
      menu.classList.remove('open');

      switch (action) {
        case 'home':     window.location.href = 'index.html'; break;
        case 'database': window.location.href = 'database.html'; break;
        case 'credits':  window.location.href = 'credits.html'; break;
        case 'terminal': window.location.href = 'terminal.html'; break;
        case 'reload':   window.location.reload(); break;
        case 'back':     window.history.back(); break;
        case 'discord':  alert('Discord invite coming soon.'); break;
        case 'copy-url':
          navigator.clipboard.writeText(window.location.href).then(() => {
            flashToast('URL COPIED');
          });
          break;
      }
    });
  }

  // ============ TOAST (for "URL copied" feedback) ============
  function flashToast(text) {
    const t = document.createElement('div');
    t.textContent = text;
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '6rem',
      right: '1.5rem',
      background: 'var(--bg-2)',
      border: '1px solid var(--accent)',
      color: 'var(--accent-2)',
      padding: '0.7rem 1.2rem',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '0.7rem',
      letterSpacing: '0.25em',
      textTransform: 'uppercase',
      zIndex: '99999',
      boxShadow: '0 0 20px var(--accent-glow)',
      opacity: '0',
      transform: 'translateY(10px)',
      transition: 'all 0.3s'
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
      setTimeout(() => t.remove(), 300);
    }, 1500);
  }

  // ============ INIT ============
  function init() {
    buildContextMenu();
    buildStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();