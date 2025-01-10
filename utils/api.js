async function fetchAIExplanation(text) {
  // 从存储中获取API密钥
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  
  if (!apiKey) {
    throw new Error('请先配置API Key');
  }

  const API_ENDPOINT = 'https://api.deepseek.com/chat/completions';
  const systemPrompt = `
作为一位经济学解释专家，请按以下结构解释文本内容：

1. 简要总结
- 用通俗易懂的语言概括主要内容
- 点出核心观点和结论

2. 经济学术语解释
- 标记出专业术语
- 给出简明扼要的解释和实际例子

3. 因果关系分析
- 找出文中的经济因果链条
- 用日常生活的类比来解释复杂的经济逻辑
- 解释这些因果关系对普通人的实际影响

4. 延伸思考（如果相关）
- 提供相关的历史案例或现实参考
- 点出可能的发展趋势

请使用 Markdown 格式优化输出：
- 使用标题层级（#）来组织内容
- 使用列表（-）来拆分要点
- 使用引用（>）来强调重要内容
- 使用加粗（**）来突出关键词
`;

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
