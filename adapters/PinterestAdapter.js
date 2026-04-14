window.PinCopyAdapters = window.PinCopyAdapters || [];

window.PinCopyAdapters.push({
  name: 'Pinterest',
  
  // 匹配特定域名的路由判断
  matches: (hostname) => {
    return hostname.includes('pinterest.com') || hostname.includes('pinimg.com');
  },

  // 核心逻辑：在这个平台上如何寻找目标并插入收集按钮
  process: (core) => {
    // 目标结构：找到更多操作按钮的容器
    const containerSelector = `[data-test-id="more-actions-button"]:not([${core.PROCESSED_ATTR}])`;
    document.querySelectorAll(containerSelector).forEach(moreActionsBtn => {
      if (moreActionsBtn.hasAttribute(core.PROCESSED_ATTR)) return;

      const container = moreActionsBtn.parentElement;
      if (!container) return;
      if (container.querySelector('.' + core.BTN_CLASS)) return;

      // 向上溯源寻找图片
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

      // 标记为已处理
      moreActionsBtn.setAttribute(core.PROCESSED_ATTR, 'true');

      // 提取核心数据
      const highResUrl = img.src.replace(/\/\d+x\//, '/736x/');
      const rawUrl = img.src.replace(/\/\d+x\//, '/').replace(/\?.*$/, '');
      const pinLink = img.closest('a[href*="/pin/"]');
      const pageUrl = pinLink ? pinLink.href : window.location.href;

      // 请求核心分发器创建通用按钮
      const btn = core.createButton({
        rawUrl: rawUrl,
        highResUrl: highResUrl,
        pageUrl: pageUrl,
        title: document.title,
        imgElement: img
      });

      // 嵌入目标页面
      container.appendChild(btn);
    });
  }
});
