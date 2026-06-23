# 每日解读（Cursor Agent 本地）

工作目录：本仓库。只读文本字段，不要读取图片二进制。

## 定位

输出不是「极简摘要」，而是面向读者的 **信息汇总 + 解析 + 适当精简**：

1. **信息汇总**：忠实整理原文与图表中的事实、数据、时间线、机构观点；**宁可稍长，不要丢关键数字和名词**
2. **解析**：补充背景、因果、与市场/宏观的关联、不同帖子之间的印证或矛盾；说明「这意味着什么」
3. **适当精简**：在汇总与解析之后，用 1–2 句话收束核心判断；**精简的是结论，不是删掉前文信息**

语气：清晰、有条理，像一位懂行的编辑在帮读者读星球；避免空话和过度压缩。

## 输入

- `daily-inbox/{DATE}/summary-input.json`（已去除 base64）

## 输出

写入 `daily-inbox/{DATE}/summary.json`：

```json
{
  "title": "南半球聊财经 · {DATE}",
  "overview": "5–8 句：今日脉络、主要矛盾、跨主题关联",
  "sections": [
    {
      "title": "金融与股市",
      "facts": "本节信息汇总：按子主题串联各帖，保留机构名、关键数据、时间、图表要点",
      "analysis": "本节解析：交叉印证、分歧点、宏观/市场含义",
      "takeaway": "1–3 句：本节最值得记住的判断",
      "bullets": ["较详细的要点条，含数据；引用帖子时句末附 [原文](topic_url)"]
    },
    {
      "title": "世界要闻",
      "facts": "...",
      "analysis": "...",
      "takeaway": "...",
      "bullets": ["..."]
    }
  ],
  "posts": [
    {
      "id": "与输入一致",
      "topic_url": "从 summary-input 原样带入",
      "author": "...",
      "published_at": "...",
      "facts": "该帖信息汇总：正文 + ocr_text + chart_summary 中的事实与数据",
      "analysis": "该帖解析：背景、逻辑链、投资/宏观关联（不给具体买卖建议）",
      "takeaway": "1–2 句收束",
      "images": [{ "file": "images/xxx.jpg", "caption": "图表说明", "chart_summary": "..." }]
    }
  ]
}
```

## 篇幅与深度（硬性要求）

- **禁止**把多条帖子压成一句带过；**每帖** `facts` 通常 **4–10 句**（内容多时可更长），`analysis` **2–6 句**
- **章节** `facts` 应覆盖该分类下所有相关帖子要点，不要只写概括句；`bullets` 每条 **1–2 句**，保留数字
- `overview` **5–8 句**，说明今天「发生了什么、哪里在打架、读者该盯什么」
- 有 `ocr_text` 的截图帖：把 OCR 里的关键信息写进 `facts`，不要省略
- 有 `chart_summary` 的图表：把图中数据、趋势、拐点写进 `facts` 或 `analysis`
- 每条 `posts[]` 必须保留 `id` 与 `topic_url`
- `sections[].bullets` 引用具体帖子时，句末附 Markdown 链接 `[原文](topic_url)`

## 分类

- **金融与股市**：A股/港股/美股、宏观政策、利率汇率、贵金属、行业与公司、国内经济数据
- **世界要闻**：地缘、国际央行、全球贸易、大宗商品、人口与结构性议题等
- 按重要性排序；**删重复，不删信息量**

## 图片规则

- `image_kind=chart` 且有 `chart_summary` → 放入 `posts[].images`（HTML 会嵌图）
- `image_kind=text` → 用 `ocr_text` 写入 `facts`，**不要**放入 `images` 数组
- `photo` / `include_in_summary=false` → 跳过

完成后回复 `SUMMARY_DONE`。
