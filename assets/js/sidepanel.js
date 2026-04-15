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
      onCopyAll: () => this.handleCopyAll(),
      onPushToBoard: () => this.handlePushRequest()
    });



    this.gallery = new Gallery({
      onDelete: (id) => this.deleteImage(id)
    });

    this.modal = new Modal({
      onConfirm: () => this.clearAll()
    });

    // 推送画板相关 DOM
    this.pushModalOverlay  = document.getElementById('push-modal-overlay');
    this.pushStepInput     = document.getElementById('push-step-input');
    this.pushStepWait      = document.getElementById('push-step-wait');
    this.pushModalCount    = document.getElementById('push-modal-count');
    this.boardNameInput    = document.getElementById('board-name-input');
    this.pushModalCancel   = document.getElementById('push-modal-cancel');
    this.pushModalConfirm  = document.getElementById('push-modal-confirm');
    this.pushWaitBoardName = document.getElementById('push-wait-board-name');
    this.pushWaitCancel    = document.getElementById('push-wait-cancel');
    this.pushProgressOverlay = document.getElementById('push-progress-overlay');
    this.pushProgressBar   = document.getElementById('push-progress-bar');
    this.pushProgressText  = document.getElementById('push-progress-text');
    this.pushProgressBoard = document.getElementById('push-progress-board');
    this.pushStopBtn       = document.getElementById('push-stop-btn');

    this.pushModalCancel.addEventListener('click', () => this.cancelPush());
    this.pushWaitCancel.addEventListener('click',  () => this.cancelPush());
    this.pushModalOverlay.addEventListener('click', e => {
      if (e.target === this.pushModalOverlay) this.cancelPush();
    });
    this.pushModalConfirm.addEventListener('click', () => this.startCapture());
    this.boardNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.startCapture();
    });
    this.pushStopBtn.addEventListener('click', () => this.stopPush());

    // 监听数据变更
    MessagingService.onStorageChange((newImages) => {
      this.allImages = newImages;
      this.render();
    });

    // 监听推送消息
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PUSH_WAITING')      this.showWaitStep();
      if (msg.type === 'PUSH_CAPTURE_DONE') this.showProgressStep();
      if (msg.type === 'PUSH_PROGRESS')     this.updatePushProgress(msg);
      if (msg.type === 'PUSH_DONE')         this.onPushDone(msg);
    });

    // 加载初始数据
    this.load();
  }

  handlePushRequest() {
    if (!this.allImages.length) return;
    this.pushModalCount.textContent = this.allImages.length;
    this.boardNameInput.value = '';
    this._showPushStep('input');
    this.pushModalOverlay.classList.add('open');
    setTimeout(() => this.boardNameInput.focus(), 100);
  }

  _showPushStep(step) {
    this.pushStepInput.style.display = step === 'input' ? '' : 'none';
    this.pushStepWait.style.display  = step === 'wait'  ? '' : 'none';
  }

  cancelPush() {
    this.pushModalOverlay.classList.remove('open');
    this.pushProgressOverlay.classList.remove('open');
    MessagingService.send({ type: 'STOP_PUSH' });
  }

  _parseBoardInput(raw) {
    const trimmed = raw.trim();
    // 检测是否为画板 URL
    const m = trimmed.match(/pinterest\.com\/([^/?#]+)\/([^/?#]+)/);
    if (m) {
      const boardName = m[2].replace(/-/g, ' '); // slug 转可读名（仅用于显示）
      return { boardName, boardUrl: trimmed };
    }
    return { boardName: trimmed, boardUrl: null };
  }

  async startCapture() {
    const raw = this.boardNameInput.value;
    if (!raw.trim()) { this.boardNameInput.focus(); return; }

    const { boardName, boardUrl } = this._parseBoardInput(raw);

    const validPins = this.allImages.filter(img =>
      img.pageUrl && img.pageUrl.includes('pinterest.com/pin/')
    );
    if (!validPins.length) {
      alert('没有可推送的 Pinterest 图片（需要有效的 pin 链接）');
      return;
    }

    // 保存当前画板名，供后续步骤使用
    this._currentBoardName = boardName;
    this._validPinsCount = validPins.length;

    // 切换到"等待"步骤（若 URL 解析成功后台会立刻发 PUSH_CAPTURE_DONE 跳过此步）
    this.pushWaitBoardName.textContent = `「${boardName}」`;
    this._showPushStep('wait');

    await MessagingService.send({
      type: 'START_PUSH_TO_BOARD',
      boardName,
      boardUrl,
      pins: validPins
    });
  }

  showWaitStep() {
    // background 确认开始监听，已在 startCapture 里切换过了，这里备用
    this._showPushStep('wait');
  }

  showProgressStep() {
    // 捕获成功，关闭对话框，显示进度
    this.pushModalOverlay.classList.remove('open');
    if (this.pushProgressBoard) {
      this.pushProgressBoard.textContent = this._currentBoardName || '';
    }
    this.updatePushProgress({ current: 0, total: this._validPinsCount || this.allImages.length });
    this.pushProgressOverlay.classList.add('open');
  }

  async stopPush() {
    await MessagingService.send({ type: 'STOP_PUSH' });
    this.pushProgressOverlay.classList.remove('open');
  }

  updatePushProgress({ current, total }) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    this.pushProgressBar.style.width = pct + '%';
    this.pushProgressText.textContent = `${current} / ${total}`;
  }

  onPushDone({ success, fail, total, error }) {
    this.pushProgressOverlay.classList.remove('open');
    if (error) {
      alert(`推送失败：${error}`);
    } else {
      alert(`推送完成！\n成功：${success}  失败：${fail}  共：${total}`);
    }
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
