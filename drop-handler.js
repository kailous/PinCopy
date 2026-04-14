// PinCopy Drop Handler - 注入到所有页面
// 通过消息机制感知侧边栏拖拽，将图片作为文件注入到目标页面的上传逻辑

(function () {
  'use strict';

  if (window.__pincopyDropLoaded) return;
  window.__pincopyDropLoaded = true;

  // ─── 注入样式 ─────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .pincopy-drop-highlight {
      outline: 2.5px solid #E60023 !important;
      outline-offset: 3px !important;
      border-radius: 6px;
      background-color: rgba(230, 0, 35, 0.04) !important;
    }
    #pincopy-drop-toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(6px);
      background: rgba(20, 20, 20, 0.92);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 500;
      padding: 8px 18px;
      border-radius: 20px;
      white-space: nowrap;
      z-index: 2147483647;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    #pincopy-drop-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // ─── 状态：由 background 广播设置 ────────────────────────────────
  // 不依赖 dataTransfer 类型（跨窗口时自定义类型可能丢失）
  // 改用消息提前告知 content script 当前拖拽的图片 URL
  let pincopyDragUrl = null;
  let activeTarget = null;
  let toastTimer = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PINCOPY_DRAG_ACTIVE') {
      pincopyDragUrl = msg.url;
    } else if (msg.type === 'PINCOPY_DRAG_INACTIVE') {
      pincopyDragUrl = null;
      setHighlight(null);
    }
  });

  // ─── Toast ────────────────────────────────────────────────────────
  function showToast(text, duration = 2000) {
    let toast = document.getElementById('pincopy-drop-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pincopy-drop-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  function setHighlight(el) {
    if (activeTarget && activeTarget !== el) {
      activeTarget.classList.remove('pincopy-drop-highlight');
    }
    activeTarget = el;
    if (el) el.classList.add('pincopy-drop-highlight');
  }

  // ─── dragover：PinCopy 拖拽激活时拦截（消息已到）────────────────
  document.addEventListener('dragover', (e) => {
    if (!pincopyDragUrl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setHighlight(e.target instanceof Element ? e.target : null);
  }, true);

  document.addEventListener('dragleave', (e) => {
    if (!activeTarget) return;
    if (!activeTarget.contains(e.relatedTarget)) setHighlight(null);
  }, true);

  // ─── drop：获取图片文件，派发给页面的上传逻辑 ────────────────────
  document.addEventListener('drop', async (e) => {
    // 主路：消息已提前到达
    let url = pincopyDragUrl;

    // 兜底：消息未到但 dataTransfer 里有 pinimg URL（消息延迟情况）
    if (!url) {
      const plain = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
      if (plain && plain.trim().includes('pinimg.com')) {
        url = plain.trim();
      }
    }

    if (!url) return;

    e.preventDefault();
    e.stopPropagation();

    pincopyDragUrl = null; // 立即清除，防止重复触发
    const dropEl = e.target instanceof Element ? e.target : document.body;
    setHighlight(null);

    // 通过 background 获取图片字节（content script 受 CORS 限制，background 不受限）
    const result = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_BLOB', url }, resolve)
    );

    if (!result?.success) {
      showToast('获取图片失败');
      return;
    }

    const mimeType = result.mimeType || 'image/jpeg';
    const ext = mimeType.split('/')[1] || 'jpg';
    const blob = new Blob([new Uint8Array(result.buffer)], { type: mimeType });
    const file = new File([blob], `pincopy-${Date.now()}.${ext}`, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);

    const isFileInput = dropEl.tagName === 'INPUT' && dropEl.type === 'file';

    if (isFileInput) {
      // <input type="file">：直接赋值，最可靠
      dropEl.files = dt.files;
      dropEl.dispatchEvent(new Event('change', { bubbles: true }));
      dropEl.dispatchEvent(new Event('input',  { bubbles: true }));
      showToast('图片已选择');
    } else {
      // 其他目标：派发携带真实 File 的 drop 事件
      // 让页面自己的上传/附件逻辑处理，和从 Finder 拖入文件效果相同
      dropEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      dropEl.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
      dropEl.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
      showToast('图片已拖入');
    }
  }, true);

})();
