async function fetchAIExplanation(text) {
  // 获取存储的配置
  const { 
    apiKey, 
    openaiKey, 
    openaiBaseUrl, 
    systemPrompt,
    selectedModel 
  } = await chrome.storage.sync.get([
    'apiKey', 
    'openaiKey', 
    'openaiBaseUrl', 
    'systemPrompt',
    'selectedModel'
  ]);

  if (!selectedModel) {
    throw new Error('请先选择模型');
  }

  const isOpenAI = selectedModel.provider === 'openai';
  
  if (isOpenAI && !openaiKey) {
    throw new Error('使用 OpenAI 模型需要配置 OpenAI API Key');
  }
  
  if (!isOpenAI && !apiKey) {
    throw new Error('使用 DeepSeek 模型需要配置 DeepSeek API Key');
  }

  const API_ENDPOINT = isOpenAI 
    ? `${openaiBaseUrl || 'https://api.openai.com'}/v1/chat/completions`
    : 'https://api.deepseek.com/v1/chat/completions';

  const finalPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 秒超时

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${isOpenAI ? openaiKey : apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel.id || (isOpenAI ? 'gpt-3.5-turbo' : 'deepseek-chat'),
        messages: [
          {
            role: 'system',
            content: finalPrompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        stream: true
      }),
      signal: controller.signal // 添加 AbortSignal
    });

    clearTimeout(timeoutId); // 请求成功后清除超时计时器

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';

    return {
      model: selectedModel.id,
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') return;
              
              try {
                const parsed = JSON.parse(data);
                const text = parsed.choices[0]?.delta?.content || '';
                if (text) {
                  content += text;
                  yield text;
                }
              } catch (e) {
                console.error('Error parsing chunk: ' + e.message);
                throw new Error('Error parsing chunk: ' + e.message);
              }
            }
          }
        }
      }
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw error;
  }
}

async function syncDeepseekModels(apiKey) {
  const API_ENDPOINT = 'https://api.deepseek.com/v1/models';

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch DeepSeek models');
    }

    const data = await response.json();
    return {
      models: data.data.map(model => ({
        id: model.id,
        name: model.id,
        provider: 'deepseek'
      }))
    };
  } catch (error) {
    console.error('DeepSeek models sync error:', error);
    throw new Error('无法获取 DeepSeek 模型列表，请检查 API Key 是否正确');
  }
}

async function syncOpenAIModels(apiKey, baseUrl = 'https://api.openai.com') {
  const API_ENDPOINT = `${baseUrl}/v1/models`;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch OpenAI models');
    }

    const data = await response.json();
    console.log(data);
    return {
      models: data.data
        .filter(model => model.id.includes('gpt') || model.id.includes('claude'))  // 只返回 GPT 或 Claude 相关模型
        .map(model => ({
          id: model.id,
          name: model.id,
          provider: 'openai'
        }))
    };
  } catch (error) {
    console.error('OpenAI models sync error:', error);
    throw new Error('无法获取 OpenAI 模型列表，请检查 API Key 和 Base URL 是否正确');
  }
}
