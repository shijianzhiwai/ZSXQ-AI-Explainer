# Vision batch（Cursor Agent 本地）

工作目录：本仓库。不要调用外部 Vision API。

## 输入

- 批次任务：`daily-inbox/{DATE}/vision-batch.json`
- 结果模板：`automations/vision-results.example.json`

## 任务

1. 读取 `vision-batch.json` 的 `tasks` 数组。
2. 对每条任务打开 `abs_path` 本地图片（仅处理列表中的图片）。
3. 按 `vision_task` 处理：
   - `chart_summary` → `image_kind=chart`，写 `chart_summary`（1-2 句，保留关键数字/趋势）
   - `classify` → 判定 `image_kind`：
     - `text` → 可补充 `ocr_text`
     - `chart` → 写 `chart_summary`
     - `photo` → `include_in_summary=false`
4. 将本批结果写入 `daily-inbox/{DATE}/vision-results.json`：

```json
{
  "date": "{DATE}",
  "results": [
    { "image_id": "...", "image_kind": "chart", "chart_summary": "...", "include_in_summary": true }
  ]
}
```

5. 只写 `vision-results.json`，不要运行其他命令。完成后回复 `VISION_BATCH_DONE` 和 results 数量。
