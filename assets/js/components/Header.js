import { Icon } from './Icon.js';

/**
 * 顶部导航栏组件
 */
export class Header {
  constructor({ onSort, onClear, onCopyAll }) {
    this.onSort = onSort;
    this.onClear = onClear;
    this.onCopyAll = onCopyAll;

    this.el = document.querySelector('.header');
    this.countBadge = this.el.querySelector('#count-badge');
    this.copyAllBtn = this.el.querySelector('#copy-all-btn');
    this.sortBtn = this.el.querySelector('#sort-btn');
    this.clearBtn = this.el.querySelector('#clear-btn');
    this.logo = this.el.querySelector('.logo');

    // 绑定事件（同步）
    this.copyAllBtn.addEventListener('click', () => this.onCopyAll());
    this.sortBtn.addEventListener('click', () => this.onSort());
    this.clearBtn.addEventListener('click', () => this.onClear());

    // 异步加载图标（不阻塞）
    this.loadIcons();
  }

  async loadIcons() {
    await Promise.all([
      Icon.render(this.logo, 'logo'),
      Icon.render(this.copyAllBtn, 'copy'),
      Icon.render(this.sortBtn, 'sort'),
      Icon.render(this.clearBtn, 'clear'),
    ]);
  }

  updateCount(count) {
    this.countBadge.textContent = count;
    this.countBadge.classList.toggle('zero', count === 0);
  }

  updateSortTitle(order) {
    this.sortBtn.title = order === 'newest' ? '当前：最新优先' : '当前：最早优先';
  }

  async setCopyAllLoading(isLoading, isSuccess = false) {
    if (isLoading) {
      this.copyAllBtn.disabled = true;
      await Icon.render(this.copyAllBtn, 'loading');
    } else if (isSuccess) {
      await Icon.render(this.copyAllBtn, 'check');
      this.copyAllBtn.style.color = '#00a854';
      setTimeout(async () => {
        await Icon.render(this.copyAllBtn, 'copy');
        this.copyAllBtn.style.color = '';
        this.copyAllBtn.disabled = false;
      }, 1500);
    } else {
      await Icon.render(this.copyAllBtn, 'copy');
      this.copyAllBtn.disabled = false;
    }
  }
}
