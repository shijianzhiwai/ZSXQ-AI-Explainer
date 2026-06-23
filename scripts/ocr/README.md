# PaddleOCR（本机 pyenv + venv）

```bash
# 一键安装（pyenv 3.12.8 + .venv + paddlepaddle + paddleocr）
bash scripts/ocr/setup-pyenv.sh
source .venv/bin/activate
```

仓库根目录 `.python-version` 指定 `3.12.8`；`enrich-manifest-images.mjs` 会优先使用 `.venv/bin/python`。

单张测试：

```bash
.venv/bin/python scripts/ocr/paddle_ocr.py daily-inbox/2026-06-23/images/xxx-1.jpg
```

环境变量：

- `PADDLE_OCR_PYTHON` — 覆盖 Python 路径
- `PADDLE_OCR_TIMEOUT_MS` — 单张超时，默认 120000
