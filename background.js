// Service Worker - 后台脚本

// ─── 推送到画板（使用 chrome.scripting 在页面主世界执行，绕过 CSP）────
let pushTabId = null;
let stopPushFlag = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractPinId(pageUrl) {
  const m = (pageUrl || '').match(/\/pin\/(\d+)/);
  return m ? m[1] : null;
}

function broadcastPushProgress(current, total) {
  chrome.runtime.sendMessage({ type: 'PUSH_PROGRESS', current, total }).catch(() => {});
}

function broadcastPushDone(success, fail, total, error = null) {
  chrome.runtime.sendMessage({ type: 'PUSH_DONE', success, fail, total, error }).catch(() => {});
}

/** 等待标签页加载完成 */
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const handler = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(handler);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(handler);
  });
}

/** 轮询直到 executeScript 可以正常执行 */
async function waitForScriptingReady(tabId, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
      return;
    } catch (_) {
      await sleep(400);
    }
  }
  throw new Error('页面未就绪，请确认已登录 Pinterest');
}

/** 通过 chrome.cookies API 获取 CSRF token（可读 HttpOnly cookie）*/
function getPinterestCsrfToken() {
  return new Promise(resolve => {
    chrome.cookies.get({ url: 'https://www.pinterest.com', name: 'csrftoken' }, c => {
      resolve(c ? c.value : '');
    });
  });
}

/**
 * 从画板 URL 解析 board_id（通过 BoardResource API）。
 * URL 格式：https://www.pinterest.com/username/board-slug/
 * 返回 board_id 字符串，失败返回 null。
 */
async function resolveBoardIdFromUrl(boardUrl) {
  try {
    const m = boardUrl.match(/pinterest\.com\/([^/]+)\/([^/]+)/);
    if (!m) return null;
    const [, username, slug] = m;

    const apiUrl = `https://www.pinterest.com/resource/BoardResource/get/?` +
      `source_url=/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/` +
      `&data=${encodeURIComponent(JSON.stringify({
        options: { username, slug, field_set_key: 'detailed' },
        context: {}
      }))}`;

    const csrfToken = await getPinterestCsrfToken();
    const resp = await fetch(apiUrl, {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': csrfToken,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      }
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const boardId = json?.resource_response?.data?.id;
    return boardId || null;
  } catch (_) {
    return null;
  }
}

// ── 以下函数序列化后注入页面主世界，不能引用外部变量 ──────────────────

/**
 * [MAIN WORLD] 注入 XHR 钩子，拦截下一次手动 Save 操作，提取 board_id。
 * 结果写入 window.__pincopy_captured_board_id__
 */
function injectBoardCapture() {
  if (window.__pincopy_capture_active__) return;
  window.__pincopy_capture_active__ = true;
  window.__pincopy_captured_board_id__ = null;

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._pcMethod = method;
    this._pcUrl = url;
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._pcMethod === 'POST' &&
        (this._pcUrl || '').includes('RepinResource/create')) {
      try {
        const params = new URLSearchParams(typeof body === 'string' ? body : '');
        const data = JSON.parse(params.get('data') || '{}');
        const boardId = data?.options?.board_id;
        if (boardId) {
          window.__pincopy_captured_board_id__ = boardId;
          // 还原原始方法，避免影响后续请求
          XMLHttpRequest.prototype.open = _open;
          XMLHttpRequest.prototype.send = _send;
          window.__pincopy_capture_active__ = false;
        }
      } catch (_) {}
    }
    return _send.apply(this, arguments);
  };
}

/** [MAIN WORLD] 读取已捕获的 board_id */
function readCapturedBoardId() {
  return window.__pincopy_captured_board_id__ || null;
}

/** [MAIN WORLD] 清理钩子和全局变量 */
function cleanupCapture() {
  window.__pincopy_captured_board_id__ = null;
  window.__pincopy_capture_active__ = false;
}

/** [MAIN WORLD] 将指定 pin 保存到指定画板 —— 永不 throw，总返回对象 */
async function repinToBoard(pinId, boardId, csrfToken) {
  try {
    const body = new URLSearchParams({
      source_url: '/pin/' + pinId + '/',
      data: JSON.stringify({
        options: {
          pin_id: pinId, board_id: boardId,
          description: '', title: '',
          carousel_slot_index: 0, is_buyable_pin: false,
          is_promoted: false, is_removable: false,
          aux_data: { source: 'deep_linking' }
        },
        context: {}
      })
    }).toString();

    const resp = await fetch('/resource/RepinResource/create/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrfToken,
        'X-Pinterest-AppState': 'active',
        'X-Pinterest-Source-Url': '/pin/' + pinId + '/',
      },
      body
    });
    if (!resp.ok) return { ok: false, status: resp.status };
    const json = await resp.json();
    return { ok: !json?.resource_response?.error };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/** 从 storage 读取已缓存的 board_id */
async function getCachedBoardId(boardName) {
  const key = 'pincopy_board_cache';
  const result = await chrome.storage.local.get([key]);
  const cache = result[key] || {};
  return cache[boardName] || null;
}

/** 将 boardName → boardId 写入缓存 */
async function saveBoardIdCache(boardName, boardId) {
  const key = 'pincopy_board_cache';
  const result = await chrome.storage.local.get([key]);
  const cache = result[key] || {};
  cache[boardName] = boardId;
  await chrome.storage.local.set({ [key]: cache });
}

/**
 * 推送主流程：
 *   第一阶段：检查是否有缓存的 board_id；若无，注入 XHR 钩子等待用户手动 Save 一次，
 *             捕获 board_id 后写入缓存（下次同名画板直接跳过此步骤）。
 *   第二阶段：用 board_id 批量调用 RepinResource，完成推送。
 */
async function executePush(boardName, pins, boardUrl = null) {
  stopPushFlag = false;

  // ── 第一阶段：获取 board_id ──────────────────────────────────────────
  // 优先级：① 缓存  ② URL 解析  ③ XHR 捕获
  let boardId = await getCachedBoardId(boardName);
  let captureTabId = null;

  if (!boardId && boardUrl) {
    // 尝试通过画板 URL 自动解析
    chrome.runtime.sendMessage({ type: 'PUSH_RESOLVING' }).catch(() => {});
    boardId = await resolveBoardIdFromUrl(boardUrl);
    if (boardId) {
      await saveBoardIdCache(boardName, boardId);
    }
  }

  if (boardId) {
    // 有缓存或 URL 解析成功，直接跳到第二阶段
    chrome.runtime.sendMessage({ type: 'PUSH_CAPTURE_DONE' }).catch(() => {});
    await sleep(100);
  } else {
    // 无缓存，需要用户手动 Save 一次
    const pinterestTabs = await chrome.tabs.query({ url: '*://*.pinterest.com/*' });
    if (!pinterestTabs.length) {
      broadcastPushDone(0, pins.length, pins.length, '请先打开 Pinterest 标签页，然后重试');
      return;
    }

    // 向所有 Pinterest 标签页注入 XHR 钩子
    for (const tab of pinterestTabs) {
      try {
        await waitForScriptingReady(tab.id, 3000);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: injectBoardCapture
        });
      } catch (_) {}
    }

    // 通知侧边栏显示"等待用户操作"状态
    chrome.runtime.sendMessage({ type: 'PUSH_WAITING', boardName }).catch(() => {});

    // 轮询捕获结果（最多等待 3 分钟）
    const captureDeadline = Date.now() + 3 * 60 * 1000;

    while (!boardId && !stopPushFlag && Date.now() < captureDeadline) {
      await sleep(600);
      for (const tab of pinterestTabs) {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: readCapturedBoardId
          });
          if (result) { boardId = result; captureTabId = tab.id; break; }
        } catch (_) {}
      }
    }

    // 清理所有钩子
    for (const tab of pinterestTabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: cleanupCapture
      }).catch(() => {});
    }

    if (stopPushFlag) return;

    if (!boardId) {
      broadcastPushDone(0, pins.length, pins.length, '等待超时，请重试');
      return;
    }

    // 缓存这次捕获到的 board_id，下次同名画板直接复用
    await saveBoardIdCache(boardName, boardId);

    // ── 通知侧边栏：捕获完成，切换到进度视图 ─────────────────────────
    chrome.runtime.sendMessage({ type: 'PUSH_CAPTURE_DONE' }).catch(() => {});
  }

  // ── 第二阶段：批量推送 ────────────────────────────────────────────────
  const allPinterestTabs = await chrome.tabs.query({ url: '*://*.pinterest.com/*' });
  if (!allPinterestTabs.length) {
    broadcastPushDone(0, pins.length, pins.length, '请先打开 Pinterest 标签页，然后重试');
    return;
  }

  const csrfToken = await getPinterestCsrfToken();

  // 优先用捕获时的标签页（session 最新），否则用第一个 Pinterest 标签
  const pushTab = captureTabId
    ? allPinterestTabs.find(t => t.id === captureTabId) || allPinterestTabs[0]
    : allPinterestTabs[0];

  let successCount = 0, failCount = 0;

  for (let i = 0; i < pins.length; i++) {
    if (stopPushFlag) break;

    const pinId = extractPinId(pins[i].pageUrl);
    if (!pinId) {
      failCount++;
    } else {
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: pushTab.id },
          world: 'MAIN',
          func: repinToBoard,
          args: [pinId, boardId, csrfToken]
        });
        if (result?.ok) successCount++;
        else failCount++;
      } catch (_) {
        failCount++;
      }
    }

    broadcastPushProgress(i + 1, pins.length);
    if (i < pins.length - 1 && !stopPushFlag) await sleep(350);
  }

  broadcastPushDone(successCount, failCount, pins.length);
}

// 点击扩展图标时打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// 处理来自内容脚本和侧边栏的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'COLLECT_IMAGE':
      collectImage(message.data).then(sendResponse);
      return true;

    case 'UNCOLLECT_IMAGE':
      uncollectImage(message.imageUrl).then(sendResponse);
      return true;

    case 'GET_COLLECTED_URLS':
      getCollectedUrls().then(sendResponse);
      return true;

    case 'GET_ALL_IMAGES':
      getAllImages().then(sendResponse);
      return true;

    case 'DELETE_IMAGE':
      deleteImage(message.id).then(sendResponse);
      return true;

    case 'CLEAR_ALL':
      clearAll().then(sendResponse);
      return true;

    case 'START_PUSH_TO_BOARD':
      executePush(message.boardName, message.pins, message.boardUrl || null);
      sendResponse({ ok: true });
      return true;

    case 'STOP_PUSH':
      stopPushFlag = true;
      if (pushTabId) {
        chrome.tabs.remove(pushTabId).catch(() => {});
        pushTabId = null;
      }
      sendResponse({ ok: true });
      return true;

    case 'FETCH_BOARD_FEED':
      fetchBoardFeed(message.boardId, message.sourceUrl, message.bookmark)
        .then(sendResponse);
      return true;

    case 'FETCH_IMAGE_BLOB':
      fetchImageAsBlob(message.url).then(sendResponse);
      return true;

    case 'DOWNLOAD_IMAGE':
      chrome.downloads.download({
        url: message.imageUrl,
        filename: `pincopy/${Date.now()}.jpg`
      }, (downloadId) => {
        sendResponse({ success: true, downloadId });
      });
      return true;
  }
});

async function fetchImageAsBlob(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    return { success: true, buffer: Array.from(new Uint8Array(buffer)), mimeType: blob.type };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function normalizeUrl(url) {
  if (!url) return '';
  return url.replace(/\/\d+x\//, '/').replace(/\?.*$/, '');
}

function broadcastDataChanged(images) {
  chrome.runtime.sendMessage({ type: 'PINCOPY_DATA_CHANGED', images }).catch(() => {});
}

async function collectImage(data) {
  const result = await chrome.storage.local.get(['pincopy_images']);
  const images = result.pincopy_images || [];

  const normalizedNew = normalizeUrl(data.imageUrl);
  const exists = images.some(img => normalizeUrl(img.imageUrl) === normalizedNew);

  if (!exists) {
    const newImage = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      imageUrl: data.imageUrl,
      pageUrl: data.pageUrl || '',
      title: data.title || '',
      timestamp: Date.now()
    };
    images.unshift(newImage);
    await chrome.storage.local.set({ pincopy_images: images });
    broadcastDataChanged(images);
    return { success: true, exists: false };
  }

  return { success: true, exists: true };
}

async function uncollectImage(imageUrl) {
  const result = await chrome.storage.local.get(['pincopy_images']);
  const images = result.pincopy_images || [];
  const normalizedUrl = normalizeUrl(imageUrl);
  const filtered = images.filter(img => normalizeUrl(img.imageUrl) !== normalizedUrl);
  await chrome.storage.local.set({ pincopy_images: filtered });
  broadcastDataChanged(filtered);
  return { success: true };
}

async function getCollectedUrls() {
  const result = await chrome.storage.local.get(['pincopy_images']);
  const images = result.pincopy_images || [];
  return images.map(img => img.imageUrl);
}

async function getAllImages() {
  const result = await chrome.storage.local.get(['pincopy_images']);
  return result.pincopy_images || [];
}

async function deleteImage(id) {
  const result = await chrome.storage.local.get(['pincopy_images']);
  const images = result.pincopy_images || [];
  const filtered = images.filter(img => img.id !== id);
  await chrome.storage.local.set({ pincopy_images: filtered });
  broadcastDataChanged(filtered);
  return { success: true };
}

async function clearAll() {
  await chrome.storage.local.set({ pincopy_images: [] });
  broadcastDataChanged([]);
  return { success: true };
}

/**
 * [MAIN WORLD] 在页面内部调用 BoardFeedResource（绕过 403）
 * 所有参数通过 args 注入，不能引用外部变量。
 */
async function fetchBoardFeedInPage(boardId, sourceUrl, bookmark) {
  try {
    const options = { board_id: boardId, page_size: 25, prepend: true, add_vase: true };
    if (bookmark) options.bookmarks = [bookmark];

    const apiUrl = `/resource/BoardFeedResource/get/` +
      `?source_url=${encodeURIComponent(sourceUrl)}` +
      `&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}`;

    const resp = await fetch(apiUrl, {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      }
    });

    if (!resp.ok) return { pins: [], bookmark: null, error: `HTTP ${resp.status}` };

    const json = await resp.json();
    const data = json?.resource_response?.data || [];
    const nextBookmark = json?.resource_response?.bookmark;

    const pins = [];
    for (const item of data) {
      if (!item?.id) continue;
      const imgData = item.images?.orig || item.images?.['736x'] || item.images?.['474x'];
      if (!imgData?.url) continue;
      pins.push({
        imageUrl: imgData.url.replace(/\/\d+x\//, '/736x/'),
        pageUrl: `https://www.pinterest.com/pin/${item.id}/`,
        title: item.title || item.description || ''
      });
    }

    const nextBm = (nextBookmark && nextBookmark !== '-end-') ? nextBookmark : null;
    return { pins, bookmark: nextBm, error: null };
  } catch (e) {
    return { pins: [], bookmark: null, error: e.message };
  }
}

/**
 * 通过 executeScript MAIN world 拉取 BoardFeedResource 一页数据。
 * 返回 { pins: [...], bookmark: string|null, error: string|null }
 */
async function fetchBoardFeed(boardId, sourceUrl, bookmark) {
  // 找到正在访问该画板的 Pinterest 标签页
  const tabs = await chrome.tabs.query({ url: '*://*.pinterest.com/*' });
  if (!tabs.length) return { pins: [], bookmark: null, error: '没有打开的 Pinterest 标签页' };

  // 优先用 URL 匹配的标签页，否则用第一个
  const boardTab = tabs.find(t => t.url && t.url.includes(sourceUrl.replace(/\/$/, ''))) || tabs[0];

  try {
    await waitForScriptingReady(boardTab.id, 5000);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: boardTab.id },
      world: 'MAIN',
      func: fetchBoardFeedInPage,
      args: [boardId, sourceUrl, bookmark || null]
    });
    return result || { pins: [], bookmark: null, error: 'no result' };
  } catch (e) {
    return { pins: [], bookmark: null, error: e.message };
  }
}
