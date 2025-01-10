document.addEventListener('DOMContentLoaded', async () => {
  // 加载已保存的配置
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }

  // 保存配置
  document.getElementById('saveConfig').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey) {
      alert('请输入API Key');
      return;
    }

    await chrome.storage.sync.set({ apiKey });
    alert('配置已保存');
  });

  // 添加关闭按钮事件
  document.querySelector('.close-btn').addEventListener('click', () => {
    window.close();
  });
}); 