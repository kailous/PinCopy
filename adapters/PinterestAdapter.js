window.PinCopyAdapters = window.PinCopyAdapters || [];

window.PinCopyAdapters.push({
  name: 'Pinterest',

  matches: (hostname) => {
    return hostname.includes('pinterest.com') || hostname.includes('pinimg.com');
  },

  process: (core) => {
    // ── 1. 画板工具栏「收藏全部」按钮 ────────────────────────────
    _injectBoardCollectBtn(core);

    // ── 2. 画板 Pin 卡片「收藏」按钮（星形按钮旁）────────────────
    _injectBoardPinBtns(core);

    // ── 3. 单张 Pin 收藏按钮（「更多操作」按钮旁）────────────────
    const containerSelector = `[data-test-id="more-actions-button"]:not([${core.PROCESSED_ATTR}])`;
    document.querySelectorAll(containerSelector).forEach(moreActionsBtn => {
      if (moreActionsBtn.hasAttribute(core.PROCESSED_ATTR)) return;

      const container = moreActionsBtn.parentElement;
      if (!container) return;
      if (container.querySelector('.' + core.BTN_CLASS)) return;

      let ancestor = container;
      let img = null;
      for (let i = 0; i < 15; i++) {
        ancestor = ancestor.parentElement;
        if (!ancestor || ancestor === document.body) break;
        const found = ancestor.querySelector('img[src*="pinimg.com"]');
        if (found && found.src.includes('pinimg.com') && /\/\d+x\//.test(found.src)) {
          img = found;
          break;
        }
      }

      if (!img) return;

      moreActionsBtn.setAttribute(core.PROCESSED_ATTR, 'true');

      const highResUrl = img.src.replace(/\/\d+x\//, '/736x/');
      const rawUrl = img.src.replace(/\/\d+x\//, '/').replace(/\?.*$/, '');
      const pinLink = img.closest('a[href*="/pin/"]');
      const pageUrl = pinLink ? pinLink.href : window.location.href;

      const btn = core.createButton({
        rawUrl, highResUrl, pageUrl,
        title: document.title,
        imgElement: img
      });

      container.appendChild(btn);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 画板工具栏注入逻辑（独立函数，避免 process 过于臃肿）
// ─────────────────────────────────────────────────────────────────────────────

function _injectBoardCollectBtn(core) {
  const toolsEl = document.querySelector('[data-test-id="board-tools"]');
  if (!toolsEl) return;
  if (toolsEl.querySelector('.pincopy-board-tool')) return; // 已注入

  // 构建按钮（与原生工具项视觉一致）
  const btn = document.createElement('button');
  btn.className = 'pincopy-board-tool';
  btn.title = '将此画板所有 Pin 收藏到 PinCopy';
  btn.innerHTML = `
    <div class="pincopy-board-tool-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1z"/>
        <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
      </svg>
    </div>
    <div class="pincopy-board-tool-label">收藏全部</div>
  `;

  // 找到工具列表的直接子容器并插入
  const listEl = toolsEl.querySelector('[role="list"]') || toolsEl;
  listEl.appendChild(btn);

  btn.addEventListener('click', () => _collectAllBoardPins(btn));
}

async function _collectAllBoardPins(btn) {
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');

  const label = btn.querySelector('.pincopy-board-tool-label');

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function sendMsg(msg) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage(msg, resolve); } catch (_) { resolve(null); }
    });
  }
  function countPins() {
    return document.querySelectorAll('a[href*="/pin/"]').length;
  }

  try {
    // ── 第一阶段：自动滚动，加载全部 Pin ─────────────────────────────
    if (label) label.textContent = '加载中…';
    const origScroll = window.scrollY;

    let lastCount = countPins();
    let stableRounds = 0;

    while (stableRounds < 3) {
      window.scrollTo(0, document.body.scrollHeight);
      await wait(1800);
      const cur = countPins();
      if (cur > lastCount) {
        lastCount = cur;
        stableRounds = 0;
        if (label) label.textContent = `已加载 ${lastCount}…`;
      } else {
        stableRounds++;
      }
    }

    // 滚回原位
    window.scrollTo(0, origScroll);

    // ── 第二阶段：从 DOM 提取所有 Pin ────────────────────────────────
    const seen = new Set();
    const pins = [];

    document.querySelectorAll('a[href*="/pin/"]').forEach(link => {
      const pinM = link.href.match(/\/pin\/(\d+)/);
      if (!pinM) return;
      const pinId = pinM[1];
      if (seen.has(pinId)) return;
      seen.add(pinId);

      // 找最近的 pinimg 图片
      const img = link.querySelector('img[src*="pinimg.com"]') ||
                  link.parentElement?.querySelector('img[src*="pinimg.com"]');
      if (!img) return;

      pins.push({
        imageUrl: img.src.replace(/\/\d+x\//, '/736x/'),
        pageUrl:  `https://www.pinterest.com/pin/${pinId}/`,
        title:    img.alt || ''
      });
    });

    // ── 第三阶段：逐条收藏 ────────────────────────────────────────────
    let collected = 0;
    for (const pin of pins) {
      await sendMsg({ type: 'COLLECT_IMAGE', data: pin });
      collected++;
      if (label) label.textContent = `${collected} / ${pins.length}`;
    }

    if (label) label.textContent = `✓ ${collected} 张`;
    setTimeout(() => {
      btn.classList.remove('loading');
      if (label) label.textContent = '收藏全部';
    }, 2500);

  } catch (e) {
    console.error('[PinCopy] collect all failed:', e);
    btn.classList.remove('loading');
    if (label) label.textContent = '收藏全部';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 画板 Pin 卡片：在星形按钮旁注入收藏按钮
// ─────────────────────────────────────────────────────────────────────────────

function _injectBoardPinBtns(core) {
  document.querySelectorAll(
    `[data-test-id="favorite-button-star"]:not([${core.PROCESSED_ATTR}])`
  ).forEach(favBtn => {
    favBtn.setAttribute(core.PROCESSED_ATTR, 'true');

    // 外层容器：包含所有操作按钮的行
    const outerRow = favBtn.parentElement?.parentElement;
    if (!outerRow) return;
    if (outerRow.querySelector('.pincopy-pin-card-btn')) return;

    // 向上找 img 和 pin 链接
    let ancestor = outerRow;
    let img = null, pinLink = null;
    for (let i = 0; i < 10; i++) {
      ancestor = ancestor.parentElement;
      if (!ancestor || ancestor === document.body) break;
      if (!img)     img     = ancestor.querySelector('img[src*="pinimg.com"]');
      if (!pinLink) pinLink = ancestor.querySelector('a[href*="/pin/"]');
      if (img && pinLink) break;
    }
    if (!img) return;

    const highResUrl = img.src.replace(/\/\d+x\//, '/736x/');
    const rawUrl     = img.src.replace(/\/\d+x\//, '/').replace(/\?.*$/, '');
    const pageUrl    = pinLink ? pinLink.href : window.location.href;

    // 复用 wrapper 的 className（oRZ5_s），使间距与星形按钮完全一致
    const wrapperClass = favBtn.parentElement.className;

    const btn = document.createElement('div');
    btn.className = 'pincopy-pin-card-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.title = '收藏到 PinCopy';

    const _isCollected = () => btn.getAttribute('data-collected') === 'true';

    function _render(collected) {
      btn.setAttribute('data-collected', collected ? 'true' : 'false');
      btn.innerHTML = collected
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
             <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1z" fill="#E60023"/>
           </svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
             <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1z"
               stroke="#333" stroke-width="2" stroke-linejoin="round"/>
           </svg>`;
    }

    // 从全局已收藏集合判断初始状态（content.js 里的 collectedUrls 不可访问，走消息）
    try {
      chrome.runtime.sendMessage({ type: 'GET_COLLECTED_URLS' }, urls => {
        const norm = rawUrl;
        const collected = Array.isArray(urls) &&
          urls.some(u => u.replace(/\/\d+x\//, '/').replace(/\?.*$/, '') === norm);
        _render(collected);
      });
    } catch (_) { _render(false); }

    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (_isCollected()) {
        try { chrome.runtime.sendMessage({ type: 'UNCOLLECT_IMAGE', imageUrl: highResUrl }); } catch (_) {}
        _render(false);
      } else {
        try { chrome.runtime.sendMessage({ type: 'COLLECT_IMAGE', data: { imageUrl: highResUrl, pageUrl, title: img.alt || '' } }); } catch (_) {}
        _render(true);
      }
    });

    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });

    _render(false); // 初始渲染，等异步消息回来再更新

    const wrapper = document.createElement('div');
    wrapper.className = wrapperClass;
    wrapper.appendChild(btn);
    outerRow.appendChild(wrapper);
  });
}
