async function fetchAIExplanation(text) {
  // 从存储中获取API密钥
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  
  if (!apiKey) {
    throw new Error('请先配置API Key');
  }

  const API_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  const systemPrompt = "通俗解释如下这经济学文字的含义，并摘出经济学名词并解释。内容中可能包含普通人不容易理解的因果关系，例如央行停止购买国债以稳定汇率，要找到这部分因果并适当解释其因果关系。**请使用纯文本回复，不要使用markdown格式**";

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
            content: systemPrompt
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
