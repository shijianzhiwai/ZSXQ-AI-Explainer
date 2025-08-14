document.addEventListener('DOMContentLoaded', async () => {
  // 获取已保存的配置和模型信息
  const { 
    apiKey, 
    openaiKey, 
    openaiBaseUrl
  } = await chrome.storage.sync.get([
    'apiKey', 
    'openaiKey', 
    'openaiBaseUrl'
  ]);

  let {
    systemPrompt,
    summaryPrompt,
    availableModels,
    selectedModel,
    logseqToken,
    logseqGraphPath
  } = await chrome.storage.local.get([
    'systemPrompt',
    'summaryPrompt',
    'availableModels',
    'selectedModel',
    'logseqToken',
    'logseqGraphPath'
  ]);

  let promptType = 'default';

  // 初始化模型选择器
  const modelSelector = document.getElementById('modelSelector');
  if (availableModels) {
    updateModelSelector(modelSelector, availableModels, selectedModel);
  }

  // 添加模型选择事件监听
  modelSelector.addEventListener('change', async (e) => {
    const selectedModelId = e.target.value;
    selectedModel = await updateSelectedModel(selectedModelId, availableModels);
  });

  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }

  if (openaiKey) {
    document.getElementById('openaiKey').value = openaiKey;
  }

  if (openaiBaseUrl) {
    document.getElementById('openaiBaseUrl').value = openaiBaseUrl;
  }
  
  // 设置提示词类型选择器
  const promptTypeButtons = document.querySelectorAll('.type-btn');
  promptTypeButtons.forEach(btn => {
    if (btn.dataset.type === promptType) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 设置提示词内容
  const textarea = document.getElementById('systemPrompt');
  if (promptType === 'summary') {
    // 汇总模式：优先使用保存的汇总提示词，否则使用默认汇总提示词
    if (summaryPrompt) {
      textarea.value = summaryPrompt;
    } else {
      textarea.value = SUMMARY_SYSTEM_PROMPT;
    }
  } else {
    // 单条模式：优先使用保存的单条提示词，否则使用默认单条提示词
    if (systemPrompt) {
      textarea.value = systemPrompt;
    } else {
      textarea.value = DEFAULT_SYSTEM_PROMPT;
    }
  }

  if (logseqToken) {
    document.getElementById('logseqToken').value = logseqToken;
  }

  if (logseqGraphPath) {
    document.getElementById('logseqGraphPath').value = logseqGraphPath;
  }

  async function saveConfig() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const openaiKey = document.getElementById('openaiKey').value.trim();
    let openaiBaseUrl = document.getElementById('openaiBaseUrl').value.trim();
    const currentPrompt = document.getElementById('systemPrompt').value.trim();
    const logseqToken = document.getElementById('logseqToken').value.trim();
    const logseqGraphPath = document.getElementById('logseqGraphPath').value.trim();
    
    if (!apiKey && !openaiKey) {
      alert('请输入DeepSeek API Key或OpenAI API Key');
      return;
    }

    if (openaiBaseUrl && !openaiBaseUrl.startsWith('http://') && !openaiBaseUrl.startsWith('https://')) {
      alert('OpenAI Base URL 必须以 http:// 或 https:// 开头');
      return;
    }

    openaiBaseUrl = openaiBaseUrl.replace(/\/v1$/, '').replace(/\/$/, '');

    // 保存当前提示词内容到对应的字段
    if (promptType === 'summary') {
      if (currentPrompt !== SUMMARY_SYSTEM_PROMPT) {
        await chrome.storage.local.set({ summaryPrompt: currentPrompt });
      } else {
        await chrome.storage.local.remove('summaryPrompt');
      }
    } else {
      if (currentPrompt !== DEFAULT_SYSTEM_PROMPT) {
        await chrome.storage.local.set({ systemPrompt: currentPrompt });
      } else {
        await chrome.storage.local.remove('systemPrompt');
      }
    }

    // 分别存储到 sync 和 local
    await Promise.all([
      chrome.storage.sync.set({ 
        apiKey,
        openaiKey,
        openaiBaseUrl
      }),
      chrome.storage.local.set({
        logseqToken,
        logseqGraphPath
      })
    ]);
  }

  // 保存配置
  document.getElementById('saveConfig').addEventListener('click', async () => {
    await saveConfig();
    alert('配置已保存');
  });

  // 提示词类型切换事件
  promptTypeButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const newPromptType = e.target.dataset.type;
      const oldPromptType = promptType;
      
      // 如果点击的是当前已激活的按钮，不做任何操作
      if (newPromptType === oldPromptType) {
        return;
      }
      
      promptType = newPromptType;
      
      // 更新按钮状态
      promptTypeButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      // 保存当前提示词内容到内存变量（不保存到存储）
      const textarea = document.getElementById('systemPrompt');
      const currentContent = textarea.value.trim();
      
      if (oldPromptType === 'summary') {
        // 保存汇总提示词到内存变量
        if (currentContent !== SUMMARY_SYSTEM_PROMPT) {
          summaryPrompt = currentContent;
        } else {
          summaryPrompt = null;
        }
      } else {
        // 保存单条提示词到内存变量
        if (currentContent !== DEFAULT_SYSTEM_PROMPT) {
          systemPrompt = currentContent;
        } else {
          systemPrompt = null;
        }
      }
      
      // 加载新类型的提示词内容
      if (newPromptType === 'summary') {
        if (summaryPrompt) {
          textarea.value = summaryPrompt;
        } else {
          textarea.value = SUMMARY_SYSTEM_PROMPT;
        }
      } else {
        if (systemPrompt) {
          textarea.value = systemPrompt;
        } else {
          textarea.value = DEFAULT_SYSTEM_PROMPT;
        }
      }
      
      // 不保存提示词类型到存储，等到点击保存按钮时再保存
    });
  });

  // 重置提示词（根据当前选择的类型）
  document.getElementById('resetPrompt').addEventListener('click', async () => {
    const currentPromptType = document.querySelector('.type-btn.active').dataset.type;
    const promptTypeText = currentPromptType === 'summary' ? '汇总提示词' : '默认提示词';
    
    const confirmed = confirm(`确定要重置${promptTypeText}吗？这将覆盖当前的自定义提示词。`);
    
    if (confirmed) {
      const textarea = document.getElementById('systemPrompt');
      
      if (currentPromptType === 'summary') {
        textarea.value = SUMMARY_SYSTEM_PROMPT;
        // 清除汇总提示词的自定义内容
        await chrome.storage.local.remove('summaryPrompt');
      } else {
        textarea.value = DEFAULT_SYSTEM_PROMPT;
        // 清除单条提示词的自定义内容
        await chrome.storage.local.remove('systemPrompt');
      }
      
      alert(`${promptTypeText}已重置`);
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
    await saveConfig();

    const apiKey = document.getElementById('apiKey').value.trim();
    const openaiKey = document.getElementById('openaiKey').value.trim();
    const openaiBaseUrl = document.getElementById('openaiBaseUrl').value.trim();

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
          models.deepseek = models.deepseek.map(model => ({ ...model, provider: 'deepseek' }));
        } catch (error) {
          console.error('DeepSeek sync failed:', error);
          alert('DeepSeek 模型同步失败: ' + error.message);
        }
      }

      // 同步 OpenAI 模型
      if (openaiKey) {
        try {
          const openaiResult = await syncOpenAIModels(openaiKey, openaiBaseUrl);
          models.openai = openaiResult.models;
          models.openai = models.openai.map(model => ({ ...model, provider: 'openai' }));
        } catch (error) {
          console.error('OpenAI sync failed:', error);
          alert('OpenAI 模型同步失败: ' + error.message);
        }
      }

      // 保存所有模型后更新选择器
      await chrome.storage.local.set({ availableModels: models });
      availableModels = models;
      updateModelSelector(document.getElementById('modelSelector'), availableModels, selectedModel);

      if (models.deepseek.length || models.openai.length) {
        alert('模型同步成功');
      } else {
        alert('没有同步到任何可用模型，请检查 API Key 是否正确');
      }
    } catch (error) {
      console.error('同步失败:', error);
      alert(`同步失败: ${error.message}`);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = '同步可用模型';
    }
  });

  document.getElementById('connectLogseq').addEventListener('click', async () => {
    const logseqToken = document.getElementById('logseqToken').value.trim();
    
    try {
      const response = await fetch('http://127.0.0.1:12315/api', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${logseqToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'logseq.App.getCurrentGraph',
          args: []
        })
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (error) {
          console.error('Error parsing response:', error);
          errorData = { message: 'Failed to connect to Logseq: ' + response.statusText };
        }
        throw new Error(errorData.message);
      }

      const data = await response.json();
      if (data.name) {
        document.getElementById('logseqGraphPath').value = data.name;
        // 自动触发保存配置
        saveConfig();
        alert('连接 Logseq 成功');
      } else {
        throw new Error('Invalid response from Logseq');
      }
    } catch (error) {
      console.error('Error connecting to Logseq:', error);
      alert('连接 Logseq 失败，请确保：\n1. Logseq 已启动\n2. HTTP Server 已开启\n3. Token 配置正确\n\n' + error.message);
    }
  });
});

// 添加更新模型选择器的函数
function updateModelSelector(selector, availableModels, selectedModel) {
  const options = [];
  
  if (availableModels.deepseek?.length) {
    options.push('<optgroup label="DeepSeek">');
    availableModels.deepseek.forEach(model => {
      const selected = selectedModel?.id === model.id && selectedModel?.provider === 'deepseek' ? 'selected' : '';
      options.push(`<option value="${model.id}" ${selected}>${model.name}</option>`);
    });
    options.push('</optgroup>');
  }

  if (availableModels.openai?.length) {
    options.push('<optgroup label="OpenAI">');
    availableModels.openai.forEach(model => {
      const selected = selectedModel?.id === model.id && selectedModel?.provider === 'openai' ? 'selected' : '';
      options.push(`<option value="${model.id}" ${selected}>${model.name}</option>`);
    });
    options.push('</optgroup>');
  }

  selector.innerHTML = options.length ? options.join('') : '<option value="">请先同步模型</option>';
  
  // 如果有可用模型但没有选中的模型，自动选择第一个模型
  if (options.length && !selectedModel) {
    const firstModelId = selector.querySelector('option[value]').value;
    updateSelectedModel(firstModelId, availableModels);
  }
}

async function updateSelectedModel(selectedModelId, availableModels) {
  const selectedModel = [
    ...(availableModels?.deepseek || []),
    ...(availableModels?.openai || [])
  ].find(model => model.id === selectedModelId);
  
  await chrome.storage.local.set({ selectedModel });

  return selectedModel;
}
