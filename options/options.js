// Options 页面逻辑

document.addEventListener('DOMContentLoaded', () => {
  const togglePinterest = document.getElementById('toggle-pinterest');
  const toast = document.getElementById('toast');
  let toastTimer;

  function showToast(msg = '设置已保存') {
    toast.textContent = msg;
    toast.classList.add('toast-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('toast-show');
    }, 2000);
  }

  // 读取已保存的设置（默认开启 pinterest）
  chrome.storage.local.get(['pincopy_settings'], (result) => {
    const settings = result.pincopy_settings || { enable_pinterest: true };
    togglePinterest.checked = settings.enable_pinterest !== false;
  });

  // 保存设置
  togglePinterest.addEventListener('change', (e) => {
    const newSettings = {
      enable_pinterest: e.target.checked
    };
    
    chrome.storage.local.set({ pincopy_settings: newSettings }, () => {
      showToast('设置已保存');
    });
  });

  // ========== 版本更新检测 ==========
  const GITHUB_REPO = 'lipeng/pincopy'; // 用户可以自行通过配置页面或代码更改为实际仓库
  
  const versionSpan = document.getElementById('current-version');
  const btnCheckUpdate = document.getElementById('btn-check-update');
  
  // 获取本地 manifest 版本
  const localVersion = chrome.runtime.getManifest().version;
  versionSpan.textContent = `v${localVersion}`;

  let latestReleaseUrl = '';

  btnCheckUpdate.addEventListener('click', async () => {
    if (btnCheckUpdate.classList.contains('has-update') && latestReleaseUrl) {
      window.open(latestReleaseUrl, '_blank');
      return;
    }

    const originalText = btnCheckUpdate.textContent;
    btnCheckUpdate.textContent = '检测中...';
    btnCheckUpdate.disabled = true;

    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
      if (!response.ok) throw new Error('API Rate Limit or Repo Not Found');
      
      const data = await response.json();
      const latestVersion = data.tag_name.replace(/^v/, ''); // 移除可能的 'v' 前缀
      
      if (latestVersion && isNewerVersion(localVersion, latestVersion)) {
        btnCheckUpdate.textContent = `下载新版 v${latestVersion}`;
        btnCheckUpdate.classList.add('has-update');
        latestReleaseUrl = data.html_url;
        showToast('发现新版本，请点击下载最新构建包！');
      } else {
        btnCheckUpdate.textContent = '已是最新版';
        showToast('当前已是最新版本');
        setTimeout(() => {
          btnCheckUpdate.textContent = originalText;
        }, 3000);
      }
    } catch (e) {
      console.error(e);
      showToast('检查更新失败，该仓库可能不存在或网络异常');
      btnCheckUpdate.textContent = originalText;
    } finally {
      btnCheckUpdate.disabled = false;
    }
  });

  // 简单的语义化版本比对工具 (e.g. 1.0.1 > 1.0.0)
  function isNewerVersion(local, remote) {
    const lParts = local.split('.').map(Number);
    const rParts = remote.split('.').map(Number);
    for (let i = 0; i < Math.max(lParts.length, rParts.length); i++) {
      const l = lParts[i] || 0;
      const r = rParts[i] || 0;
      if (r > l) return true;
      if (l > r) return false;
    }
    return false;
  }
});
