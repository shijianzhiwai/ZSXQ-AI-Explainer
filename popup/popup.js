document.addEventListener('DOMContentLoaded', async () => {
  // 加载已保存的配置
  const { apiKey, openaiKey, openaiBaseUrl, systemPrompt } = await chrome.storage.sync.get(['apiKey', 'openaiKey', 'openaiBaseUrl', 'systemPrompt']);
  
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }

  if (openaiKey) {
    document.getElementById('openaiKey').value = openaiKey;
  }

  if (openaiBaseUrl) {
    document.getElementById('openaiBaseUrl').value = openaiBaseUrl;
  }
  
  if (systemPrompt) {
    document.getElementById('systemPrompt').value = systemPrompt;
  } else {
    document.getElementById('systemPrompt').value = DEFAULT_SYSTEM_PROMPT;
  }

  // 保存配置
  document.getElementById('saveConfig').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const openaiKey = document.getElementById('openaiKey').value.trim();
    let openaiBaseUrl = document.getElementById('openaiBaseUrl').value.trim();
    const systemPrompt = document.getElementById('systemPrompt').value.trim();
    
    if (!apiKey && !openaiKey) {
      alert('请输入DeepSeek API Key或OpenAI API Key');
      return;
    }

    if (openaiBaseUrl && !openaiBaseUrl.startsWith('http://') && !openaiBaseUrl.startsWith('https://')) {
      alert('OpenAI Base URL 必须以 http:// 或 https:// 开头');
      return;
    }

    openaiBaseUrl = openaiBaseUrl.replace(/\/v1$/, '').replace(/\/$/, '');

    await chrome.storage.sync.set({ 
      apiKey,
      openaiKey,
      openaiBaseUrl,
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

  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // 移除所有活动状态
      tabButtons.forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      
      // 设置当前选中的 tab
      button.classList.add('active');
      const tabId = button.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });

  document.getElementById('syncModels').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const openaiKey = document.getElementById('openaiKey').value.trim();
    const openaiBaseUrl = document.getElementById('openaiBaseUrl').value.trim();

    if (!apiKey && !openaiKey) {
      alert('请至少输入一个 API Key');
      return;
    }

    const syncBtn = document.getElementById('syncModels');
    syncBtn.disabled = true;
    syncBtn.textContent = '同步中...';

    try {
      const models = { deepseek: [], openai: [] };

      // 同步 DeepSeek 模型
      if (apiKey) {
        try {
          const deepseekResult = await syncDeepseekModels(apiKey);
          models.deepseek = deepseekResult.models;
        } catch (error) {
          console.error('DeepSeek sync failed:', error);
        }
      }

      // 同步 OpenAI 模型
      if (openaiKey) {
        try {
          const openaiResult = await syncOpenAIModels(openaiKey, openaiBaseUrl);
          models.openai = openaiResult.models;
        } catch (error) {
          console.error('OpenAI sync failed:', error);
        }
      }

      // 保存所有模型
      await chrome.storage.sync.set({ availableModels: models });

      if (models.deepseek.length || models.openai.length) {
        alert('模型同步成功');
      } else {
        alert('没有同步到任何可用模型，请检查 API Key 是否正确');
      }
    } catch (error) {
      alert(`同步失败: ${error.message}`);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = '同步可用模型';
    }
  });
}); 