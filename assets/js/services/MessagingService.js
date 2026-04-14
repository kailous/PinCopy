/**
 * 消息通信服务
 */
export const MessagingService = {
  /**
   * 发送消息给 runtime
   * @param {Object} data 消息内容
   * @returns {Promise<any>}
   */
  async send(data) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(data, resolve);
    });
  },

  /**
   * 监听 storage 变更
   * @param {Function} callback 
   */
  onStorageChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pincopy_images) {
        callback(changes.pincopy_images.newValue || []);
      }
    });
  }
};
