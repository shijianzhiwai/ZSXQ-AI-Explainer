#!/usr/bin/env python3
"""PaddleOCR 3.7 helper — single image or batch JSON on stdin."""
import json
import os
import sys

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

_OCR = None


def get_ocr():
    global _OCR
    if _OCR is None:
        from paddleocr import PaddleOCR

        _OCR = PaddleOCR(
            lang="ch",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    return _OCR


def run_ocr(image_path: str) -> dict:
    try:
        ocr = get_ocr()
        result = ocr.predict(image_path)
        if not result:
            return {"ok": True, "text": "", "confidence": 0.0, "line_count": 0, "char_count": 0}

        item = result[0] if isinstance(result, list) else result
        texts = item.get("rec_texts") or []
        scores = item.get("rec_scores") or []
        lines = [str(t).strip() for t in texts if str(t).strip()]
        text = "\n".join(lines).strip()
        confidence = sum(float(s) for s in scores) / len(scores) if scores else 0.0
        return {
            "ok": True,
            "text": text,
            "confidence": round(confidence, 4),
            "line_count": len(lines),
            "char_count": len(text),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "text": "", "confidence": 0.0, "error": str(exc)}


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: paddle_ocr.py <image> | --batch"}))
        return 1

    if sys.argv[1] == "--batch":
        paths = json.load(sys.stdin)
        out = {path: run_ocr(path) for path in paths}
        print(json.dumps(out, ensure_ascii=False))
        return 0

    print(json.dumps(run_ocr(sys.argv[1]), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
