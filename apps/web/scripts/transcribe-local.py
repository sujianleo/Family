#!/usr/bin/env python3
"""Offline speech-to-text fallback for the family app."""

from __future__ import annotations

import argparse
import json
import os
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe one audio file with faster-whisper.")
    parser.add_argument("audio", help="Path to the audio file")
    parser.add_argument("--language", default="zh", help="ISO language code")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        from faster_whisper import WhisperModel

        model_name = os.environ.get("LOCAL_TRANSCRIBE_MODEL", "Systran/faster-whisper-small")
        device = os.environ.get("LOCAL_TRANSCRIBE_DEVICE", "cpu")
        compute_type = os.environ.get("LOCAL_TRANSCRIBE_COMPUTE_TYPE", "int8")
        allow_download = os.environ.get("LOCAL_TRANSCRIBE_ALLOW_DOWNLOAD", "0") == "1"

        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            local_files_only=not allow_download,
        )
        segments, _ = model.transcribe(
            args.audio,
            language=args.language,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = "".join(segment.text for segment in segments).strip()
        print(json.dumps({"text": text, "model": f"faster-whisper:{model_name}"}, ensure_ascii=False))
        return 0
    except Exception as error:  # Keep stdout reserved for the JSON protocol.
        print(f"Local transcription failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
