async function fetchAIExplanation(text) {
  // 从存储中获取API密钥和自定义提示词
  const { apiKey, systemPrompt } = await chrome.storage.sync.get(['apiKey', 'systemPrompt']);
  
  if (!apiKey) {
    throw new Error('请先配置API Key');
  }

  const API_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  // 使用自定义提示词或默认提示词
  const finalPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
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
      })
    });

    if (!response.ok) {
      throw new Error('API request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';

    return {
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
                console.error('Error parsing chunk:', e);
              }
            }
          }
        }
      }
    };
  } catch (error) {
    throw error;
  }
}
