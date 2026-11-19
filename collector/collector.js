/** 采集选择器窗口:检测已登录账号 → 选择账号 → 上传素材库(步骤可视化,失败显示诊断信息) */
(() => {
  const q = new URLSearchParams(location.search);
  const SRC = q.get('src') || '';
  const PAGE = q.get('page') || '';
  const ERR = q.get('err') || '';

  const $ = (id) => document.getElementById(id);
  let currentToken = null;

  if (SRC) {
    $('thumb').src = SRC;
    $('thumb').onerror = () => { $('thumb').style.visibility = 'hidden'; };
    $('thumbUrl').textContent = SRC;
  } else {
    $('thumbUrl').textContent = '未获取到图片地址';
    $('recheck').style.display = 'none';
  }

  function setSection(t) { $('secTitle').textContent = t; }

  function renderError(msg, detail) {
    setSection('采集失败');
    $('accList').innerHTML = '';
    const box = document.createElement('div');
    box.className = 'status show';
    box.innerHTML = `<div class="line err"><span class="dot"></span><span>${escapeHtml(msg)}</span></div>` +
      (detail ? `<div class="detail">${escapeHtml(detail)}</div>` : '');
    $('accList').appendChild(box);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function detect() {
    setSection('检测已登录的公众号…');
    $('accList').innerHTML = '';
    $('status').classList.remove('show');
    let info = null;
    try {
      info = await chrome.runtime.sendMessage({ type: 'mopai-collect-info' });
    } catch (e) {
      renderError('后台无响应:' + e.message);
      return;
    }
    if (!info || !info.ok) {
      renderError((info && info.error) || '检测登录态失败');
      return;
    }
    const accounts = info.accounts || [];
    if (!accounts.length) {
      renderError('未检测到已登录的公众号。请先在浏览器打开 mp.weixin.qq.com 登录,再重新检测。');
      return;
    }
    setSection(accounts.length > 1 ? `检测到 ${accounts.length} 个已登录账号,点击选择要上传到的账号` : '检测到已登录账号');
    accounts.forEach((acc, i) => {
      const row = document.createElement('div');
      row.className = 'acc';
      const name = acc.nick || `账号 ${i + 1}`;
      const ava = acc.avatar
        ? `<img src="${escapeHtml(acc.avatar)}" onerror="this.outerHTML='<div class=&quot;ava-fallback&quot;>牛</div>'">`
        : `<div class="ava-fallback">${escapeHtml(name.slice(0, 1))}</div>`;
      row.innerHTML = `${ava}<div class="info"><div class="name">${escapeHtml(name)}</div>
        <div class="token">token …${escapeHtml(acc.token.slice(-6))}</div></div><div class="go">上传 →</div>`;
      row.addEventListener('click', () => upload(acc, row));
      $('accList').appendChild(row);
    });
  }

  async function upload(acc, row) {
    if (currentToken) return; // 防重复点击
    currentToken = acc.token;
    $('accList').querySelectorAll('.acc').forEach((el) => { el.style.opacity = el === row ? '1' : '.35'; el.style.pointerEvents = 'none'; });
    $('status').classList.add('show');
    ['step1', 'step2', 'step3'].forEach((id) => { $(id).className = 'line'; });
    $('result').textContent = '';
    $('detail').style.display = 'none';
    $('okActions').style.display = 'none';
    $('step1').classList.add('doing');

    const r = await chrome.runtime.sendMessage({ type: 'mopai-collect-upload', token: acc.token, srcUrl: SRC, pageUrl: PAGE });

    $('step1').classList.remove('doing');
    $('step2').classList.remove('doing');
    $('step3').classList.remove('doing');
    if (r && r.ok) {
      ['step1', 'step2', 'step3'].forEach((id) => $(id).classList.add('done'));
      $('result').className = 'result ok';
      $('result').textContent = '✅ 已存入素材库:' + r.url;
      $('okActions').style.display = 'flex';
      $('copyBtn').onclick = async () => {
        try { await navigator.clipboard.writeText(r.url); $('copyBtn').textContent = '已复制'; } catch (e) { /* ignore */ }
      };
      $('libBtn').onclick = () => chrome.tabs.create({ url: 'https://mp.weixin.qq.com/cgi-bin/filepage?action=get_all_materials&token=' + acc.token });
    } else {
      const err = (r && r.error) || '未知错误';
      // 定位失败步骤:票据失败 → step2;上传失败 → step3
      if (/票据/.test(err)) { $('step1').classList.add('done'); $('step2').classList.add('err'); $('step3').classList.add('err'); }
      else { $('step1').classList.add('done'); $('step2').classList.add('done'); $('step3').classList.add('err'); }
      $('result').className = 'result err';
      $('result').textContent = '❌ ' + err;
      if (r && r.detail) {
        $('detail').style.display = 'block';
        $('detail').textContent = r.detail;
      }
    }
    currentToken = null;
    $('accList').querySelectorAll('.acc').forEach((el) => { el.style.opacity = ''; el.style.pointerEvents = ''; });
  }

  $('recheck').addEventListener('click', detect);
  if (ERR) { renderError(ERR); return; } // 通知失败时的兜底错误窗
  detect();
})();
