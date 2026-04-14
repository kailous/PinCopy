// Service Worker - 后台脚本

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
