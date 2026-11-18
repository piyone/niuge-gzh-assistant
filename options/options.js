const THEME_NAMES = {
  elegant: '雅蓝', tech: '科技蓝', warm: '暖橙',
  forest: '青竹', mono: '极简黑白', sakura: '樱粉',
};

async function getSettings() {
  const d = await chrome.storage.local.get('mopai');
  return d && d.mopai ? d.mopai : {};
}
async function setSettings(s) {
  await chrome.storage.local.set({ mopai: s });
}

(async () => {
  const s = await getSettings();
  s.rules = Object.assign(
    { pad: true, punct: true, blank: true, footnote: true, ellipsis: true, collapse: false },
    s.rules || {}
  );
  s.customWords = s.customWords || [];
  s.theme = s.theme || 'elegant';
  s.ai = Object.assign(
    { apiKey: '', baseUrl: '', model: '', maxTokens: 1024 },
    s.ai || {}
  );

  const themeSel = document.getElementById('theme');
  themeSel.innerHTML = Object.entries(THEME_NAMES)
    .map(([id, name]) => `<option value="${id}"${id === s.theme ? ' selected' : ''}>${name}</option>`).join('');
  themeSel.addEventListener('change', () => { s.theme = themeSel.value; setSettings(s); });

  const binds = [
    ['rule-pad', 'pad'], ['rule-punct', 'punct'], ['rule-blank', 'blank'],
    ['rule-footnote', 'footnote'], ['rule-ellipsis', 'ellipsis'], ['rule-collapse', 'collapse'],
  ];
  binds.forEach(([id, key]) => {
    const cb = document.getElementById(id);
    cb.checked = !!s.rules[key];
    cb.addEventListener('change', () => { s.rules[key] = cb.checked; setSettings(s); });
  });

  const words = document.getElementById('words');
  words.value = s.customWords.join('\n');
  words.addEventListener('change', () => {
    s.customWords = words.value.split('\n').map((w) => w.trim()).filter(Boolean);
    setSettings(s);
  });

  // ---------------- AI 模型配置 ----------------

  const AI_PROVIDERS = [
    { id: 'aitools', name: 'aitools.cfd(需自备 Key)', url: 'https://platform.aitools.cfd/api/v1/chat/completions', models: ['zhipu/glm-4-flash', 'zhipu/glm-4-air', 'openai/gpt-oss-20b', 'google/gemma-4-31b'] },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'zhipu', name: '智谱开放平台', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'] },
    { id: 'moonshot', name: '月之暗面 Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
    { id: 'qwen', name: '通义千问(兼容模式)', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
    { id: 'siliconflow', name: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1/chat/completions', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat'] },
    { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001'] },
    { id: 'ollama', name: 'Ollama(本地,无需 Key)', url: 'http://localhost:11434/v1/chat/completions', models: ['qwen2.5', 'llama3.1'] },
    { id: 'custom', name: '自定义 OpenAI 兼容接口', url: '', models: [] },
  ];

  const providerSel = document.getElementById('ai-provider');
  const urlInput = document.getElementById('ai-url');
  const keyInput = document.getElementById('ai-key');
  const keyToggle = document.getElementById('ai-key-toggle');
  const modelInput = document.getElementById('ai-model');
  const modelList = document.getElementById('ai-model-list');
  const testBtn = document.getElementById('ai-test');
  const testResult = document.getElementById('ai-test-result');

  s.ai.keys = s.ai.keys || {};
  if (!s.ai.keys[s.ai.provider || 'aitools'] && s.ai.apiKey) {
    s.ai.keys[s.ai.provider || 'aitools'] = s.ai.apiKey; // 迁移旧配置
  }
  s.ai.provider = s.ai.provider || 'aitools';

  providerSel.innerHTML = AI_PROVIDERS
    .map((p) => `<option value="${p.id}"${p.id === s.ai.provider ? ' selected' : ''}>${p.name}</option>`).join('');

  function fillModelList(models) {
    modelList.innerHTML = (models || []).map((m) => `<option value="${m}">`).join('');
  }

  function applyProvider(id) {
    const preset = AI_PROVIDERS.find((p) => p.id === id);
    if (!preset) return;
    fillModelList(preset.models);
    if (preset.url) urlInput.value = preset.url;
    const stored = s.ai.keys[id] || '';
    keyInput.value = stored;
    s.ai.apiKey = stored;
    s.ai.baseUrl = urlInput.value.trim();
    if (preset.models.length) {
      modelInput.value = preset.models[0];
      s.ai.model = preset.models[0];
    } else if (id === 'custom') {
      modelInput.value = '';
      s.ai.model = '';
    }
    s.ai.provider = id;
    setSettings(s);
  }

  providerSel.addEventListener('change', () => applyProvider(providerSel.value));

  urlInput.value = s.ai.baseUrl || '';
  keyInput.value = s.ai.apiKey || '';
  modelInput.value = s.ai.model || '';
  fillModelList((AI_PROVIDERS.find((p) => p.id === s.ai.provider) || {}).models || []);

  // 初始加载:地址/模型为空时按当前服务商预设自动填充(用户只需填 Key)
  const initPreset = AI_PROVIDERS.find((p) => p.id === s.ai.provider);
  if (initPreset && (initPreset.url && !s.ai.baseUrl) || (initPreset && !s.ai.model && initPreset.models.length)) {
    if (initPreset.url && !s.ai.baseUrl) { urlInput.value = initPreset.url; s.ai.baseUrl = initPreset.url; }
    if (!s.ai.model && initPreset.models.length) { modelInput.value = initPreset.models[0]; s.ai.model = initPreset.models[0]; }
    setSettings(s);
  }

  urlInput.addEventListener('change', () => { s.ai.baseUrl = urlInput.value.trim(); setSettings(s); });
  keyInput.addEventListener('change', () => {
    s.ai.apiKey = keyInput.value.trim();
    s.ai.keys[s.ai.provider] = s.ai.apiKey; // 按服务商记忆
    setSettings(s);
  });
  modelInput.addEventListener('change', () => { s.ai.model = modelInput.value.trim(); setSettings(s); });

  keyToggle.addEventListener('click', () => {
    const hidden = keyInput.type === 'password';
    keyInput.type = hidden ? 'text' : 'password';
    keyToggle.textContent = hidden ? '隐藏' : '显示';
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testResult.className = '';
    testResult.textContent = '测试中…(真实调用一次接口)';
    const ai = { apiKey: keyInput.value.trim(), baseUrl: urlInput.value.trim(), model: modelInput.value.trim() };
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'mopai-ai-test', ai });
    } catch (e) {
      resp = { ok: false, error: '后台不可用:' + e.message };
    }
    testBtn.disabled = false;
    if (resp && resp.ok) {
      testResult.className = 'ok';
      testResult.textContent = `✅ 连接成功 · ${resp.latency}ms`
        + (resp.preview ? ` · 返回:「${resp.preview}」` : ' · 返回为空')
        + (resp.warning ? ` ⚠️ ${resp.warning}` : '');
    } else {
      testResult.className = 'err';
      testResult.textContent = '❌ ' + ((resp && resp.error) || '未知错误');
    }
  });

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mopai-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const file = document.getElementById('file');
  document.getElementById('import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      await setSettings(obj);
      alert('导入成功,即将刷新页面');
      location.reload();
    } catch (e) {
      alert('导入失败:' + e.message);
    }
  });
})();
