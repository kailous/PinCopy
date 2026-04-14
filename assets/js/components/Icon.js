/**
 * SVG 图标组件
 * 异步加载独立的可伸缩矢量图形
 */
export class Icon {
  /**
   * 加载并获取 SVG 字符串
   * @param {string} name 图标名称 (例如 'logo', 'search')
   * @returns {Promise<string>}
   */
  static async get(name) {
    try {
      const response = await fetch(chrome.runtime.getURL(`assets/img/${name}.svg`));
      return await response.text();
    } catch (error) {
      console.error(`Failed to load icon: ${name}`, error);
      return '';
    }
  }

  /**
   * 将图标渲染到元素中
   * @param {HTMLElement} element 目标元素
   * @param {string} name 图标名称
   */
  static async render(element, name) {
    const svg = await this.get(name);
    if (element && svg) {
      element.innerHTML = svg;
    }
  }
}
