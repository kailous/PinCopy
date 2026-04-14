import { MessagingService } from '../services/MessagingService.js';

/**
 * 图片处理工具
 */
export const ImageUtils = {
  /**
   * 下载图片
   * @param {string} imageUrl 
   */
  async download(imageUrl) {
    return MessagingService.send({ type: 'DOWNLOAD_IMAGE', imageUrl });
  },

  /**
   * 复制图片到剪贴板
   * @param {string} url 
   * @returns {Promise<void>}
   */
  async copy(url) {
    const res  = await fetch(url);
    const blob = await res.blob();
    const burl = URL.createObjectURL(blob);
    
    try {
      const im = new Image();
      await new Promise((res, rej) => { 
        im.onload = res; 
        im.onerror = rej; 
        im.src = burl; 
      });
      
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth; 
      cv.height = im.naturalHeight;
      cv.getContext('2d').drawImage(im, 0, 0);
      
      const png = await new Promise(r => cv.toBlob(r, 'image/png'));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': png })
      ]);
    } finally {
      URL.revokeObjectURL(burl);
    }
  },

  /**
   * 将所有图片排版为一张拼图（Moodboard），解决系统剪贴板无法存储多分离图片的问题，从而支持微信等各种软件直接粘贴图片。
   * @param {Array<string>} urls 
   */
  async copyAll(urls) {
    // 1. 并发请求加载所有图片
    const loadPromises = urls.map(async (url) => {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const burl = URL.createObjectURL(blob);
        return await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve({ im, burl });
          im.onerror = reject;
          im.src = burl;
        });
      } catch (e) {
        return null;
      }
    });

    const loaded = (await Promise.all(loadPromises)).filter(Boolean);
    if (!loaded.length) throw new Error('No images loaded');

    // 2. 瀑布流自适应布局计算
    let cols = 1;
    if (loaded.length > 2) cols = 2;
    if (loaded.length > 7) cols = 3;
    if (loaded.length > 15) cols = 4;

    const colWidth = 500;
    const spacing = 24;
    const canvasWidth = cols * colWidth + (cols + 1) * spacing;
    
    const colHeights = Array(cols).fill(spacing);
    const drawList = [];

    for (const { im } of loaded) {
      let minCol = 0;
      for(let i = 1; i < cols; i++) {
        if(colHeights[i] < colHeights[minCol]) minCol = i;
      }

      const drawWidth = colWidth;
      const scale = drawWidth / im.naturalWidth;
      const drawHeight = im.naturalHeight * scale;

      const x = spacing + minCol * (colWidth + spacing);
      const y = colHeights[minCol];
      
      drawList.push({ im, x, y, drawWidth, drawHeight });
      colHeights[minCol] += drawHeight + spacing;
    }

    const totalHeight = Math.max(...colHeights);

    // 3. 将排版结果绘制到 Canvas
    const cv = document.createElement('canvas');
    cv.width = canvasWidth;
    cv.height = totalHeight;
    const ctx = cv.getContext('2d');
    
    // 背景色设定
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, canvasWidth, totalHeight);

    for (const item of drawList) {
      // 绘制卡片阴影
      ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 6;
      
      // 绘制带圆角的容器背景
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(item.x, item.y, item.drawWidth, item.drawHeight, 16);
      } else {
        ctx.rect(item.x, item.y, item.drawWidth, item.drawHeight);
      }
      ctx.fill();
      
      // 清除阴影，裁剪圆角并绘制图片
      ctx.shadowColor = 'transparent';
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(item.x, item.y, item.drawWidth, item.drawHeight, 16);
      } else {
        ctx.rect(item.x, item.y, item.drawWidth, item.drawHeight);
      }
      ctx.clip();
      ctx.drawImage(item.im, item.x, item.y, item.drawWidth, item.drawHeight);
      ctx.restore();
    }

    // 4. 导出图以 PNG 写入剪贴板
    const pngBlob = await new Promise(r => cv.toBlob(r, 'image/png'));
    
    for (const { burl } of loaded) {
      URL.revokeObjectURL(burl);
    }

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlob })
    ]);
  }
};
