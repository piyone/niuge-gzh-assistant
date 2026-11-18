// 测试环境 chrome API shim:在普通网页里模拟 chrome.storage / runtime
(() => {
  const syncStore = {};
  const localStore = {};
  const changeListeners = [];

  function fakeArea(store, areaName) {
    return {
      get: async (key) => (store[key] !== undefined ? { [key]: JSON.parse(JSON.stringify(store[key])) } : {}),
      set: async (obj) => {
        const changes = {};
        Object.keys(obj).forEach((k) => {
          changes[k] = { oldValue: store[k] ? JSON.parse(JSON.stringify(store[k])) : undefined, newValue: JSON.parse(JSON.stringify(obj[k])) };
          store[k] = JSON.parse(JSON.stringify(obj[k]));
        });
        // 通知 onChanged 监听器(带真实 area 名)
        changeListeners.forEach((fn) => { try { fn(changes, areaName); } catch (e) { /* ignore */ } });
      },
    };
  }
  window.chrome = {
    storage: {
      sync: fakeArea(syncStore, 'sync'),
      local: fakeArea(localStore, 'local'),
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: { getURL: (p) => p },
  };
  console.log('[mopai-test] chrome shim ready');
})();
