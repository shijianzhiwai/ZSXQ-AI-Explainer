document.addEventListener('DOMContentLoaded', async () => {
  // 加载已保存的配置
  const { apiKey, systemPrompt } = await chrome.storage.sync.get(['apiKey', 'systemPrompt']);
  
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }
  
  if (systemPrompt) {
    document.getElementById('systemPrompt').value = systemPrompt;
  } else {
    document.getElementById('systemPrompt').value = DEFAULT_SYSTEM_PROMPT;
  }

  // 保存配置
  document.getElementById('saveConfig').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const systemPrompt = document.getElementById('systemPrompt').value.trim();
    
    if (!apiKey) {
      alert('请输入API Key');
      return;
    }

    await chrome.storage.sync.set({ 
      apiKey,
      systemPrompt 
    });
    alert('配置已保存');
  });

  // 重置提示词
  document.getElementById('resetPrompt').addEventListener('click', async () => {
    const confirmed = confirm('确定要重置为默认提示词吗？这将覆盖当前的自定义提示词。');
    
    if (confirmed) {
      const textarea = document.getElementById('systemPrompt');
      textarea.value = DEFAULT_SYSTEM_PROMPT;
      await chrome.storage.sync.remove('systemPrompt');
      alert('提示词已重置为默认值');
    }
  });

  // 添加关闭按钮事件
  document.querySelector('.close-btn').addEventListener('click', () => {
    window.close();
  });
}); 