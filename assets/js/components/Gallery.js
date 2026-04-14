import { Icon } from './Icon.js';
import { Card } from './Card.js';

/**
 * 瀑布流画廊管理组件
 */
export class Gallery {
  constructor({ onDelete }) {
    this.onDelete = onDelete;

    // 同步查询 DOM — 确保 render() 被调用时这些已就绪
    this.container = document.getElementById('gallery');
    this.emptyState = document.getElementById('empty-state');
    this.noResults = document.getElementById('no-results');

    // 异步加载占位图标（不阻塞）
    this.loadIcons();
  }

  async loadIcons() {
    const emptyIconWrap = this.emptyState.querySelector('.icon-wrap');
    const noResultsIconWrap = this.noResults.querySelector('.icon-wrap');

    await Promise.all([
      emptyIconWrap ? Icon.render(emptyIconWrap, 'empty') : Promise.resolve(),
      noResultsIconWrap ? Icon.render(noResultsIconWrap, 'no_results') : Promise.resolve(),
    ]);
  }

  /**
   * 渲染图片列表
   * @param {Array} list 过滤并排序后的列表
   * @param {boolean} isEmpty 全局是否为空
   */
  async render(list, isEmpty) {
    const noMatch = !isEmpty && list.length === 0;
    const hasCards = list.length > 0;

    this.emptyState.style.display = isEmpty ? 'flex' : 'none';
    this.noResults.style.display = noMatch ? 'flex' : 'none';
    this.container.style.display = hasCards ? '' : 'none';

    this.container.innerHTML = '';

    // 使用 Card.create() 异步工厂方法，确保操作按钮正确加载
    const cardEls = await Promise.all(
      list.map(item => Card.create(item, { onDelete: this.onDelete }))
    );
    cardEls.forEach(el => this.container.appendChild(el));
  }
}
