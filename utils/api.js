async function fetchAIExplanation(text, prompt, isSummary = false) {

  const {
    systemPrompt,
    summaryPrompt,
  } = await chrome.storage.local.get([
    'systemPrompt',
    'summaryPrompt'
  ]);

  let finalPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  if (isSummary) {
    finalPrompt = summaryPrompt || SUMMARY_SYSTEM_PROMPT;
  }
  if (prompt) {
    finalPrompt = prompt;
  }

  try {
    const response = await requestAIModelByConfig({
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';

    return {
      model: response.selectedModel.id,
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
    return {
      models: data.data
        .filter(model => !model.id.includes('dall-e') &&  // 尝试过滤一些图像、嵌入模型
                        !model.id.includes('image') && 
                        !model.id.includes('vision') && 
                        !model.id.includes('embedding'))
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

async function syncToLogseq(content) {
  const { logseqToken, logseqGraphPath } = await chrome.storage.local.get(['logseqToken', 'logseqGraphPath']);
  
  if (!logseqToken || !logseqGraphPath) {
    throw new Error('请先在插件设置中配置 Logseq Token 和 Graph');
  }

  const { selectedModel } = await chrome.storage.local.get('selectedModel');

  const formatPrompt = `请将以下内容转换为 Logseq 的大纲笔记格式，并以 JSON 格式输出。要求：
1. 提取一句话标题，并添加 #南半球聊财经 标签
2. 保留原文的总结内容
3. 将经济学术用以下 JSON 格式严格生成转换，在末尾添加 #经济学术语
4. 保留因果关系分析
5. 保留延伸思考

输出 JSON 格式示例：
{
  "title": "**标题** #南半球聊财经",
  "summary": "总结内容",
  "terms": ["术语1: 解释内容 #经济学术语", "术语2: 解释内容 #经济学术语"], # 按照此数组结构即可，不要内部扩容新的结构
  "causality": ["因果关系1", "因果关系2"],
  "keyword": ["关键词1", "关键词2"] # 关键词包含「术语」、「其他你认为的关键信息词」
  "thoughts": ["延伸思考1", "延伸思考2"]
}

**不要生成超出以上 JSON 结构之外的字段**

以下是需要转换的内容：
${content}`;

  if (selectedModel.id == "deepseek-reasoner") {
    selectedModel.id = "deepseek-chat"
  }

  try {
    const response = await requestAIModelByConfig({
      model: selectedModel.id,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的笔记格式转换助手'
        },
        {
          role: 'user',
          content: formatPrompt
        }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    })

    const result = await response.json();
    const formattedContent = JSON.parse(result.choices[0].message.content);

    // 生成今天的日记页面标题
    const date = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    const pageTitle = `${month} ${day}${getDaySuffix(day)}, ${year}`;

    // 构建块结构
    const blocks = [
      {
        content: '**总结：**' + createBidirectionalLink(formattedContent.summary, formattedContent.keyword),
      },
      {
        content: '**经济学术语**',
        children: formattedContent.terms.map(term => ({ content: createBidirectionalLink(term, formattedContent.keyword) }))
      },
      {
        content: '**因果关系分析**',
        children: formattedContent.causality.map(cause => ({ content: createBidirectionalLink(cause, formattedContent.keyword) }))
      },
      {
        content: '**延伸思考**',
        children: formattedContent.thoughts.map(thought => ({ content: createBidirectionalLink(thought, formattedContent.keyword) }))
      }
    ];

    const targetBlock = await requestLogseq('logseq.Editor.insertBlock', [pageTitle, formattedContent.title, { before: true }], logseqToken)

    // 使用 insertBatchBlock 插入块
    const createPageResponse = await requestLogseq('logseq.Editor.insertBatchBlock', [targetBlock.uuid, blocks, { sibling: false }], logseqToken)

    return createPageResponse;
  } catch (error) {
    console.error('Format and sync error:', error);
    throw error;
  }
}

// 辅助函数：获取日期的后缀(1st, 2nd, 3rd, 4th等)
function getDaySuffix(day) {
  if (day >= 11 && day <= 13) {
    return 'th';
  }
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

async function requestLogseq(method, args, logseqToken) {
  const errText = 'Logseq 请求失败，请确保 Logseq 已启动且 HTTP Server 正在运行，并且 Token 配置正确';
  try {
    const response = await fetch('http://127.0.0.1:12315/api', {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${logseqToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ method, args })
    });
  
    if (!response.ok) {
      throw new Error(errText + '，错误码：' + response.status);
    }

    return await response.json();
  } catch (error) {
    throw new Error(errText);
  }
}

function createBidirectionalLink(content, keyword) {
  if (keyword.length === 0) {
    return content;
  }
  let result = content;
  
  keyword.forEach(term => {
    const regex = new RegExp(term, 'g');
    result = result.replace(regex, `[[${term}]]`);
  });
  
  return result;
}

async function requestAIModelByConfig(body) {
  const { 
    apiKey, 
    openaiKey, 
    openaiBaseUrl
  } = await chrome.storage.sync.get([
    'apiKey', 
    'openaiKey', 
    'openaiBaseUrl'
  ]);

  const {
    selectedModel
  } = await chrome.storage.local.get([
    'selectedModel'
  ]);
  if (!selectedModel) {
    throw new Error('请先选择模型');
  }

  if (!body.model) {
    body.model = selectedModel.id;
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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 秒超时

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${isOpenAI ? openaiKey : apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal // 添加 AbortSignal
    });

    clearTimeout(timeoutId); // 请求成功后清除超时计时器

    if (!response.ok) {
      throw new Error('API request failed: ' + response.status);
    }
    response.selectedModel = selectedModel;
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw error;
  }
}