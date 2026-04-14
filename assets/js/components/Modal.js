/**
 * 确认弹窗组件
 */
export class Modal {
  constructor({ onConfirm }) {
    this.onConfirm = onConfirm;
    this.init();
  }

  init() {
    this.overlay = document.getElementById('modal-overlay');
    this.countLabel = document.getElementById('modal-count');
    this.cancelBtn = document.getElementById('modal-cancel');
    this.confirmBtn = document.getElementById('modal-confirm');

    this.cancelBtn.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.close();
    });
    this.confirmBtn.addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
  }

  open(count) {
    this.countLabel.textContent = count;
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }
}
