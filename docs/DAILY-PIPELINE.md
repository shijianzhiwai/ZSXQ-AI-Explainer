# 每日星球总结流水线（本地）

从知识星球抓取 → 本机 OCR → **Cursor Agent CLI** 识图/总结 → HTML 日报。

## 架构

```mermaid
flowchart LR
  A[打开星球页] --> B[导出增量]
  B --> C{Inbox 服务?}
  C -->|是| D[daily-inbox/manifest + images]
  C -->|否| D2[Downloads/daily-inbox]
  D --> E[build-daily-pipeline]
  D2 --> E
  E --> F[enrich OCR]
  F --> G[agent 图表识别]
  G --> H[agent 写总结]
  H --> I[build-daily-summary]
  I --> J[summaries/*.html]
```

## 一键运行（推荐）

扩展导出到 `daily-inbox/YYYY-MM-DD/` 后：

```bash
# 全流程：OCR → 图表 agent → 总结 agent → HTML
node scripts/build-daily-pipeline.mjs --date 2026-06-23

# 自动选 daily-inbox 里最新日期
node scripts/build-daily-pipeline.mjs
```

**前置条件**：本机已安装 Cursor CLI（`agent` 命令可用且已登录）。

## 分步运行

```bash
# 1. 启动 Inbox 桥接（推荐，同时代理 HTML 日报 + WebSocket）
node scripts/local-inbox-server.mjs
# 默认每天 13:00 自动触发增量导出（等同 trigger-export.mjs）
# 关闭定时：node scripts/local-inbox-server.mjs --no-schedule
# 改时间：  node scripts/local-inbox-server.mjs --schedule 09:30
# 浏览器打开 http://127.0.0.1:3921/latest（局域网可用本机 IP 访问）
# 扩展会自动连接 ws://127.0.0.1:3921/ws

# 2. 浏览器扩展 → 导出增量（或远程触发，见下）

# 3. OCR + 图表启发式分类
bash scripts/ocr/setup-pyenv.sh   # 首次
node scripts/enrich-manifest-images.mjs --date 2026-06-23

# 4. Cursor agent 图表摘要（分批读本地图片）
node scripts/run-vision-agent.mjs --date 2026-06-23

# 5. Cursor agent 写 summary.json
node scripts/run-summary-agent.mjs --date 2026-06-23

# 6. 拼 HTML
node scripts/build-daily-summary.mjs --date 2026-06-23
```

## 图片处理分工

| image_kind | 谁处理 | 总结用什么 | HTML |
|------------|--------|------------|------|
| `text` | PaddleOCR | `ocr_text` | 不嵌图 |
| `chart` | Cursor agent 看图 | `chart_summary` | 嵌图 + 说明 |
| `photo` | agent 判定 | 跳过 | 不嵌图 |

## 总结侧重点

Agent prompt 见 `scripts/prompts/daily-summary.md`：

- **金融与股市**：股市、宏观、黄金/白银等贵金属（合并为一节）
- **世界要闻**：地缘、央行、大宗商品
- 简洁易懂；chart 图进 HTML，text 截图只进文字

## 省 Token 策略

- manifest / summary-input 不含 base64
- OCR 本机 PaddleOCR
- agent 视觉阶段只打开 `needs_vision` 的本地 jpg
- 总结 agent 只读 `text`、`image_content`（截图文字）、`chart_summary`

## 扩展 ↔ 本机

| 方式 | 说明 |
|------|------|
| **本地 Inbox HTTP** | 扩展 POST → `local-inbox-server.mjs` 写仓库；同一服务代理 `summaries/*.html` 与图片 |
| **WebSocket 远程触发** | 扩展连接 `ws://{inbox}/ws`；CLI `node scripts/trigger-export.mjs` → `POST /export/trigger` → 刷新星球页并静默导出增量 |
| **Chrome Downloads** | Inbox 不可用时 fallback |

### 远程触发导出

```bash
# 需：inbox 服务运行 + 扩展已加载且连上 WebSocket
node scripts/trigger-export.mjs
node scripts/trigger-export.mjs --no-reload    # 不刷新页面，直接导出
node scripts/trigger-export.mjs --url http://192.168.1.10:3921

# 查看连接状态
curl http://127.0.0.1:3921/export/status
```

导出后在本机终端运行 `node scripts/build-daily-pipeline.mjs` 即可。

## 配置

`scripts/.env.example` — 可选 `CURSOR_AGENT_MODEL`、超时等。

## 重载扩展

`manifest.json` 当前 **0.9.0**，请在 `chrome://extensions` 重新加载。
