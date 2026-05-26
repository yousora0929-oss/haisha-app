/**
 * 初回描画前にテーマを適用（FOUC 防止）。各 HTML で tailwind より先に読み込む。
 */
(function bootstrapTheme() {
  var KEY = 'concrete_link_theme_mode_v1';
  var root = document.documentElement;

  function resolve(mode) {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  var mode = 'system';
  try {
    var stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') mode = stored;
  } catch (e) {
    /* ignore */
  }

  var effective = resolve(mode);
  root.classList.toggle('dark', effective === 'dark');
  root.dataset.themeMode = mode;
  root.dataset.themeEffective = effective;
  root.style.colorScheme = effective;

  window.__CONCRETE_LINK_TAILWIND_CONFIG = {
    darkMode: 'class',
    theme: {
      extend: {
        fontFamily: {
          sans: ['"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', 'Meiryo', 'system-ui', 'sans-serif'],
        },
      },
    },
  };
})();
