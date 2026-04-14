import { MessagingService } from './services/MessagingService.js';
import { Header } from './components/Header.js';
import { Gallery } from './components/Gallery.js';
import { Modal } from './components/Modal.js';
import { ImageUtils } from './utils/ImageUtils.js';

/**
 * PinCopy 侧边栏主应用
 */
class App {
  constructor() {
    this.allImages = [];
    this.sortOrder = 'newest';


    // 组件构造器内同步完成 DOM 查询和事件绑定
    this.header = new Header({
      onSort: () => this.toggleSort(),
      onClear: () => this.handleClearRequest(),
      onCopyAll: () => this.handleCopyAll()
    });



    this.gallery = new Gallery({
      onDelete: (id) => this.deleteImage(id)
    });

    this.modal = new Modal({
      onConfirm: () => this.clearAll()
    });

    // 监听数据变更
    MessagingService.onStorageChange((newImages) => {
      this.allImages = newImages;
      this.render();
    });

    // 加载初始数据
    this.load();
  }

  handleClearRequest() {
    if (!this.allImages.length) return;
    this.modal.open(this.allImages.length);
  }

  async load() {
    this.allImages = await MessagingService.send({ type: 'GET_ALL_IMAGES' }) || [];
    await this.render();
  }



  async handleCopyAll() {
    if (!this.allImages.length) return;
    
    await this.header.setCopyAllLoading(true);
    try {
      const urls = this.allImages.map(img => img.imageUrl);
      await ImageUtils.copyAll(urls);
      await this.header.setCopyAllLoading(false, true);
    } catch (e) {
      console.error('Copy all failed:', e);
      await this.header.setCopyAllLoading(false, false);
    }
  }

  toggleSort() {
    this.sortOrder = this.sortOrder === 'newest' ? 'oldest' : 'newest';
    this.header.updateSortTitle(this.sortOrder);
    this.render();
  }

  async deleteImage(id) {
    await MessagingService.send({ type: 'DELETE_IMAGE', id });
  }

  async clearAll() {
    await MessagingService.send({ type: 'CLEAR_ALL' });
  }

  filtered() {
    let list = [...this.allImages];
    if (this.sortOrder === 'oldest') list.reverse();
    return list;
  }

  async render() {
    const filteredList = this.filtered();
    const isEmpty = this.allImages.length === 0;

    this.header.updateCount(this.allImages.length);
    await this.gallery.render(filteredList, isEmpty);
  }
}

// 启动应用
new App();
