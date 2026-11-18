const DEFAULTS = {
  theme: 'elegant',
  fabEnabled: true,
};

const THEME_NAMES = {
  elegant: '雅蓝', tech: '科技蓝', warm: '暖橙',
  forest: '青竹', mono: '极简黑白', sakura: '樱粉',
};

async function getSettings() {
  const d = await chrome.storage.local.get('mopai');
  return Object.assign({}, DEFAULTS, (d && d.mopai) || {});
}

(async () => {
  const s = await getSettings();

  const themeSel = document.getElementById('theme');
  themeSel.innerHTML = Object.entries(THEME_NAMES)
    .map(([id, name]) => `<option value="${id}"${id === s.theme ? ' selected' : ''}>${name}</option>`)
    .join('');
  themeSel.addEventListener('change', async () => {
    s.theme = themeSel.value;
    await chrome.storage.local.set({ mopai: s });
  });

  const fab = document.getElementById('fab');
  fab.checked = s.fabEnabled !== false;
  fab.addEventListener('change', async () => {
    s.fabEnabled = fab.checked;
    await chrome.storage.local.set({ mopai: s });
  });

  document.getElementById('open-mp').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://mp.weixin.qq.com/' });
  });
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
})();
