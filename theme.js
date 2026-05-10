
(function() {
  const THEMES = {
    violet: {
      name: 'Violet',
      vars: {
        '--bg': '#08070a',
        '--bg-2': '#0f0d12',
        '--fg': '#ededed',
        '--gray': '#8a8590',
        '--muted': 'rgba(237, 237, 237, 0.5)',
        '--accent': '#6b3fa0',
        '--accent-2': '#9d6cd1',
        '--accent-glow': 'rgba(107, 63, 160, 0.45)',
        '--border': 'rgba(237, 237, 237, 0.12)',
        '--alert-bg': 'linear-gradient(90deg, #4a1f7a, #6b3fa0, #4a1f7a)'
      }
    },
    crimson: {
      name: 'Crimson',
      vars: {
        '--bg': '#0a0606',
        '--bg-2': '#120a0a',
        '--fg': '#ededed',
        '--gray': '#8a8590',
        '--muted': 'rgba(237, 237, 237, 0.5)',
        '--accent': '#a01f1f',
        '--accent-2': '#d14545',
        '--accent-glow': 'rgba(160, 31, 31, 0.45)',
        '--border': 'rgba(237, 237, 237, 0.12)',
        '--alert-bg': 'linear-gradient(90deg, #5a1212, #a01f1f, #5a1212)'
      }
    },
    verdant: {
      name: 'Verdant',
      vars: {
        '--bg': '#06090a',
        '--bg-2': '#0a1010',
        '--fg': '#e8ede8',
        '--gray': '#859085',
        '--muted': 'rgba(232, 237, 232, 0.5)',
        '--accent': '#2d7a4f',
        '--accent-2': '#5fb87f',
        '--accent-glow': 'rgba(45, 122, 79, 0.45)',
        '--border': 'rgba(232, 237, 232, 0.12)',
        '--alert-bg': 'linear-gradient(90deg, #143a25, #2d7a4f, #143a25)'
      }
    },
    ivory: {
      name: 'Ivory',
      vars: {
        '--bg': '#f0ebe0',
        '--bg-2': '#e6e0d2',
        '--fg': '#1a1612',
        '--gray': '#5a554d',
        '--muted': 'rgba(26, 22, 18, 0.55)',
        '--accent': '#4a2570',
        '--accent-2': '#6b3fa0',
        '--accent-glow': 'rgba(74, 37, 112, 0.25)',
        '--border': 'rgba(26, 22, 18, 0.18)',
        '--alert-bg': 'linear-gradient(90deg, #2d1a4d, #4a2570, #2d1a4d)'
      }
    }
  };

  // Apply theme to <html> element so CSS variables cascade everywhere
  function applyTheme(themeKey) {
    const theme = THEMES[themeKey] || THEMES.violet;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([key, val]) => {
      root.style.setProperty(key, val);
    });
    root.dataset.theme = themeKey;
    localStorage.setItem('ssp-theme', themeKey);
  }

  // Apply saved theme immediately to avoid flash
  const saved = localStorage.getItem('ssp-theme') || 'violet';
  applyTheme(saved);

  // Build the floating switcher UI
  function buildSwitcher() {
    const container = document.createElement('div');
    container.id = 'theme-switcher';
    container.innerHTML = `
      <style>
        #theme-switcher {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          z-index: 9998;
          font-family: 'JetBrains Mono', monospace;
        }
        #theme-toggle {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: var(--bg-2);
          border: 1px solid var(--border);
          color: var(--accent-2);
          cursor: crosshair;
          font-size: 1.4rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s;
          box-shadow: 0 0 20px var(--accent-glow);
        }
        #theme-toggle:hover {
          transform: rotate(180deg) scale(1.1);
          border-color: var(--accent-2);
        }
        #theme-panel {
          position: absolute;
          bottom: 65px;
          right: 0;
          background: var(--bg-2);
          border: 1px solid var(--border);
          padding: 1rem;
          min-width: 180px;
          opacity: 0;
          transform: translateY(10px) scale(0.95);
          pointer-events: none;
          transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
          box-shadow: 0 0 40px var(--accent-glow);
        }
        #theme-panel.open {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        #theme-panel h4 {
          font-family: 'Cinzel', serif;
          font-size: 0.75rem;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          color: var(--accent-2);
          margin-bottom: 0.8rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }
        .theme-opt {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          padding: 0.5rem 0.6rem;
          cursor: crosshair;
          font-size: 0.75rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--gray);
          transition: all 0.2s;
          border: 1px solid transparent;
          margin-bottom: 0.2rem;
        }
        .theme-opt:hover {
          background: var(--bg);
          color: var(--fg);
          border-color: var(--border);
        }
        .theme-opt.active {
          color: var(--accent-2);
          border-color: var(--accent);
          background: var(--bg);
        }
        .swatch {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 1px solid var(--border);
          flex-shrink: 0;
        }
        @media (max-width: 600px) {
          #theme-switcher { bottom: 1rem; right: 1rem; }
          #theme-toggle { width: 44px; height: 44px; font-size: 1.2rem; }
        }
      </style>
      <button id="theme-toggle" title="Change theme">✦</button>
      <div id="theme-panel">
        <h4>Theme</h4>
        <div class="theme-opt" data-theme="violet">
          <span class="swatch" style="background:#9d6cd1"></span>
          <span>Violet</span>
        </div>
        <div class="theme-opt" data-theme="crimson">
          <span class="swatch" style="background:#d14545"></span>
          <span>Crimson</span>
        </div>
        <div class="theme-opt" data-theme="verdant">
          <span class="swatch" style="background:#5fb87f"></span>
          <span>Verdant</span>
        </div>
        <div class="theme-opt" data-theme="ivory">
          <span class="swatch" style="background:#f0ebe0;border-color:#5a554d"></span>
          <span>Ivory</span>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const toggle = document.getElementById('theme-toggle');
    const panel = document.getElementById('theme-panel');
    const opts = container.querySelectorAll('.theme-opt');

    // Mark current
    function refreshActive() {
      const current = localStorage.getItem('ssp-theme') || 'violet';
      opts.forEach(o => {
        o.classList.toggle('active', o.dataset.theme === current);
      });
    }
    refreshActive();

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) panel.classList.remove('open');
    });

    opts.forEach(opt => {
      opt.addEventListener('click', () => {
        applyTheme(opt.dataset.theme);
        refreshActive();
        setTimeout(() => panel.classList.remove('open'), 200);
      });
    });
  }

  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSwitcher);
  } else {
    buildSwitcher();
  }
})();
