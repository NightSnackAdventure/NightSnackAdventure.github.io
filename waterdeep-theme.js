// Shared theme switcher for the Waterdeep pages (campaign guide + map).
// Persists the chosen theme in localStorage under 'wd_theme' so it's
// consistent across both pages.

const THEMES = {
  loisto: { label: 'Loisto', vars: { '--bg':'#0d1326','--bg2':'#0a0f1f','--panel':'#15203f','--panel2':'#1a274c','--ink':'#f2e8cd','--ink-soft':'#c7bf9f','--ink-faint':'#8b86a0','--gold':'#cda94f','--gold-soft':'#e6d29a','--accent':'#7d93cf','--line':'rgba(205,169,79,.22)','--line-2':'rgba(205,169,79,.45)','--shadow':'rgba(0,0,0,.55)','--ph':'rgba(205,169,79,.10)','--field':'rgba(255,255,255,.05)' } },
  tome: { label: 'Tomu', vars: { '--bg':'#e2d4b2','--bg2':'#d8c8a2','--panel':'#f2e8ce','--panel2':'#ecdfc0','--ink':'#2a2114','--ink-soft':'#5b4c33','--ink-faint':'#8a7850','--gold':'#9a7726','--gold-soft':'#7a5e1f','--accent':'#7c2e2e','--line':'rgba(120,95,40,.30)','--line-2':'rgba(120,95,40,.55)','--shadow':'rgba(80,60,25,.20)','--ph':'rgba(120,95,40,.12)','--field':'rgba(120,95,40,.06)' } },
  lyhty: { label: 'Lyhty', vars: { '--bg':'#14110d','--bg2':'#0f0d0a','--panel':'#221d16','--panel2':'#2b251b','--ink':'#dccfb1','--ink-soft':'#a99c7e','--ink-faint':'#6f6552','--gold':'#c0964a','--gold-soft':'#d9b06a','--accent':'#b0613a','--line':'rgba(192,150,74,.20)','--line-2':'rgba(192,150,74,.45)','--shadow':'rgba(0,0,0,.6)','--ph':'rgba(192,150,74,.09)','--field':'rgba(255,255,255,.04)' } },
};

function wdApplyTheme(name) {
  const t = THEMES[name] || THEMES.loisto;
  const r = document.documentElement.style;
  Object.keys(t.vars).forEach(k => r.setProperty(k, t.vars[k]));
}

function wdLoadTheme() {
  let saved;
  try { saved = localStorage.getItem('wd_theme'); } catch (e) {}
  const theme = (saved && THEMES[saved]) ? saved : 'lyhty';
  wdApplyTheme(theme);
  return theme;
}

function wdRenderThemeSwitcher(containerId, currentTheme, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  Object.keys(THEMES).forEach(key => {
    const th = THEMES[key];
    const btn = document.createElement('button');
    btn.className = 'wd-theme-btn' + (currentTheme === key ? ' active' : '');
    btn.title = th.label;
    btn.onclick = () => onChange(key);
    btn.innerHTML = `<span class="wd-theme-dot"><span style="background:${th.vars['--bg']}"></span><span style="background:${th.vars['--gold']}"></span></span><span>${th.label}</span>`;
    el.appendChild(btn);
  });
}
