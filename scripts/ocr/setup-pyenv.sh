#!/usr/bin/env bash
# Create pyenv-local Python + venv and install PaddleOCR for this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PYTHON_VERSION="$(cat .python-version | tr -d '[:space:]')"
VENV="$ROOT/.venv"

if ! command -v pyenv >/dev/null 2>&1; then
  echo "pyenv not found. Install: brew install pyenv" >&2
  exit 1
fi

eval "$(pyenv init -)"

if ! pyenv versions --bare | rg -x "${PYTHON_VERSION}" >/dev/null 2>&1; then
  echo "Installing Python ${PYTHON_VERSION} via pyenv..."
  pyenv install -s "${PYTHON_VERSION}"
fi

pyenv local "${PYTHON_VERSION}"
echo "Using Python: $(python --version) at $(which python)"

if [[ ! -d "$VENV" ]]; then
  python -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --upgrade pip wheel

export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

echo "Installing PaddlePaddle (CPU, Apple Silicon)..."
python -m pip install paddlepaddle==3.2.1 \
  -i https://www.paddlepaddle.org.cn/packages/stable/cpu/

echo "Installing PaddleOCR..."
python -m pip install -r scripts/ocr/requirements.txt

python -c "import paddle; import paddleocr; print('paddle', paddle.__version__); print('paddleocr ok')"

echo ""
echo "Done. Activate with:"
echo "  source .venv/bin/activate"
echo "Or set:"
echo "  export PADDLE_OCR_PYTHON=$VENV/bin/python"
