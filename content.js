// Content Script - 统一分发控制引擎

(function () {
  'use strict';

  const BTN_CLASS = 'pincopy-btn';
  const PROCESSED_ATTR = 'data-pincopy-processed';

  let collectedUrls = new Set();
  let isInitialized = false;
  let activeAdapter = null;

  // 使用 WeakMap 存储每个按钮绑定的元数据
  const buttonDataMap = new WeakMap();

  // ─── 工具与通信 ────────────────────────────────────────────────────

  function safeMessage(msg, cb) {
    try { chrome.runtime.sendMessage(msg, cb); } catch (_) {}
  }

  let toastTimer = null;
  function showToast(text) {
    let toast = document.getElementById('pincopy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pincopy-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('pincopy-toast-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('pincopy-toast-show'), 1800);
  }

  // ─── SVG 图标 ────────────────────────────────────────────────────

  const ICON_BOOKMARK = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none">
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1z"
      stroke="#333" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;

  const ICON_BOOKMARK_FILLED = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1z"
      fill="#E60023"/>
  </svg>`;

  // ─── 统一按钮生命周期管理 ────────────────────────────────────────────

  function updateButtonState(btn, isCollected) {
    if (isCollected) {
      btn.innerHTML = ICON_BOOKMARK_FILLED;
      btn.setAttribute('data-collected', 'true');
      btn.title = '已收藏 · 点击取消';
      btn.classList.add('pincopy-collected');
    } else {
      btn.innerHTML = ICON_BOOKMARK;
      btn.setAttribute('data-collected', 'false');
      btn.title = '收藏到 PinCopy';
      btn.classList.remove('pincopy-collected');
    }
  }

  function handleButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const btn = e.currentTarget;
    const data = buttonDataMap.get(btn);
    if (!data) return;

    const isCollected = btn.getAttribute('data-collected') === 'true';

    if (isCollected) {
      safeMessage({ type: 'UNCOLLECT_IMAGE', imageUrl: data.highResUrl });
      collectedUrls.delete(data.rawUrl);
      updateButtonState(btn, false);
      showToast('已取消收藏');
    } else {
      safeMessage({
        type: 'COLLECT_IMAGE',
        data: { imageUrl: data.highResUrl, pageUrl: data.pageUrl, title: data.title }
      });
      collectedUrls.add(data.rawUrl);
      updateButtonState(btn, true);
      showToast('已收藏！');
    }
  }

  // 供给适配器使用的高级 API 上下文
  const coreAPI = {
    BTN_CLASS,
    PROCESSED_ATTR,
    createButton: (data) => {
      // data 结构期望: { rawUrl, highResUrl, pageUrl, title, imgElement }
      const btn = document.createElement('button');
      btn.className = BTN_CLASS;
      buttonDataMap.set(btn, data);
      updateButtonState(btn, collectedUrls.has(data.rawUrl));
      btn.addEventListener('click', handleButtonClick);
      return btn;
    }
  };

  function syncButtonStates() {
    document.querySelectorAll('.' + BTN_CLASS).forEach(btn => {
      const data = buttonDataMap.get(btn);
      if (data) updateButtonState(btn, collectedUrls.has(data.rawUrl));
    });
  }

  function processAll() {
    if (!activeAdapter) return;
    activeAdapter.process(coreAPI);
  }

  // ─── 初始化与路由分发 ────────────────────────────────────────────────

  function init() {
    if (isInitialized) return;
    isInitialized = true;

    // 获取全局设置
    chrome.storage.local.get(['pincopy_settings'], (result) => {
      const settings = result.pincopy_settings || { enable_pinterest: true };
      const hostname = window.location.hostname;

      // 遍历所有已注册的站点适配器
      for (const adapter of (window.PinCopyAdapters || [])) {
        if (adapter.matches(hostname)) {
          // 如果用户在设置面板关闭了该功能
          if (adapter.name === 'Pinterest' && settings.enable_pinterest === false) return;
          
          activeAdapter = adapter;
          break;
        }
      }

      // 没有匹配的适配器，或者已被禁用，直接退出即可
      if (!activeAdapter) return;

      console.log(`[PinCopy] Activated Injection Adapter: ${activeAdapter.name}`);

      // 加载初始数据池
      safeMessage({ type: 'GET_COLLECTED_URLS' }, (urls) => {
        if (Array.isArray(urls)) {
           // 将 storage 存储的 url 再次 normalize 回 raw url
           collectedUrls = new Set(urls.map(url => url.replace(/\/\d+x\//, '/').replace(/\?.*$/, '')));
        }
        processAll();
      });

      // 启动统一页面的防抖监视器
      let debounceTimer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processAll, 150);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // 监听侧边栏操作导致的数据改变，实现双向互动
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.pincopy_images) {
          collectedUrls = new Set(
            (changes.pincopy_images.newValue || []).map(img => img.imageUrl.replace(/\/\d+x\//, '/').replace(/\?.*$/, ''))
          );
          syncButtonStates();
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


})()
