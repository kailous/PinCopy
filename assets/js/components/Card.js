import { Icon } from './Icon.js';
import { ImageUtils } from '../utils/ImageUtils.js';
import { MessagingService } from '../services/MessagingService.js';

/**
 * 单张图片卡片组件
 */
export class Card {
  /**
   * 异步工厂方法：创建并返回一个完整的卡片 DOM
   * @param {Object} item
   * @param {{ onDelete: Function }} callbacks
   * @returns {Promise<HTMLElement>}
   */
  static async create(item, { onDelete }) {
    const card = new Card(item, { onDelete });
    await card.buildActions();
    return card.el;
  }

  constructor(item, { onDelete }) {
    this.item = item;
    this.onDelete = onDelete;
    this.el = this.createEl();
  }

  createEl() {
    const card = document.createElement('div');
    card.className = 'pin-card';
    card.dataset.id = this.item.id;

    // 骨架屏
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';

    // 图片
    const img = document.createElement('img');
    img.className = 'loading';
    img.alt = this.item.title || '';
    img.loading = 'lazy';
    img.onload  = () => { img.classList.remove('loading'); skeleton.remove(); };
    img.onerror = () => { img.classList.remove('loading'); skeleton.remove(); };
    img.src = this.item.imageUrl;

    // 遮罩与操作栏
    const overlay = document.createElement('div');
    overlay.className = 'pin-overlay';

    this.actionsContainer = document.createElement('div');
    this.actionsContainer.className = 'pin-actions';

    overlay.appendChild(this.actionsContainer);
    card.append(skeleton, img, overlay);

    card.addEventListener('click', () => {
      if (this.item.pageUrl) chrome.tabs.create({ url: this.item.pageUrl });
    });

    return card;
  }

  /**
   * 异步构建操作按钮并追加到 actions 容器
   */
  async buildActions() {
    // 打开原始链接
    if (this.item.pageUrl) {
      this.actionsContainer.appendChild(await this.createBtn('btn-open', '打开原始 Pin', 'open', (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: this.item.pageUrl });
      }));
    }

    // 下载
    this.actionsContainer.appendChild(await this.createBtn('btn-download', '下载图片', 'download', (e) => {
      e.stopPropagation();
      MessagingService.send({ type: 'DOWNLOAD_IMAGE', imageUrl: this.item.imageUrl });
    }));

    // 复制
    const copyBtn = await this.createBtn('btn-copy', '复制图片', 'copy', async (e) => {
      e.stopPropagation();
      await this.handleCopy(copyBtn);
    });
    this.actionsContainer.appendChild(copyBtn);

    // 删除
    this.actionsContainer.appendChild(await this.createBtn('btn-delete', '删除收藏', 'delete', (e) => {
      e.stopPropagation();
      this.handleDelete(this.el);
    }));
  }

  async createBtn(cls, title, iconName, onClick) {
    const btn = document.createElement('button');
    btn.className = `act-btn ${cls}`;
    btn.title = title;
    await Icon.render(btn, iconName);
    btn.addEventListener('click', onClick);
    return btn;
  }

  async handleCopy(btn) {
    const originalContent = btn.innerHTML;
    const loadingIcon = await Icon.get('loading');
    const checkIcon = await Icon.get('check');

    btn.innerHTML = loadingIcon;
    btn.disabled = true;

    try {
      await ImageUtils.copy(this.item.imageUrl);
      btn.innerHTML = checkIcon;
      btn.classList.add('ok');
      setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.classList.remove('ok');
        btn.disabled = false;
      }, 1500);
    } catch {
      btn.innerHTML = originalContent;
      btn.disabled = false;
    }
  }

  handleDelete(el) {
    el.style.transition = 'transform .15s ease, opacity .15s ease';
    el.style.transform  = 'scale(.88)';
    el.style.opacity    = '0';
    setTimeout(() => this.onDelete(this.item.id), 150);
  }
}
