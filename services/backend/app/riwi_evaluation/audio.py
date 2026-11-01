"""Local PCM energy telemetry. Energy is not speech or pronunciation evidence."""
from __future__ import annotations

from array import array
import io
import math
import sys
import wave


def analyze_pcm_wav(raw: bytes, *, rms_threshold: int = 200) -> dict:
    if not isinstance(raw, bytes) or not 44 <= len(raw) <= 16_000_000:
        raise ValueError("invalid_audio_bytes")
    if type(rms_threshold) is not int or not 1 <= rms_threshold <= 32767:
        raise ValueError("invalid_energy_threshold")
    try:
        with wave.open(io.BytesIO(raw), "rb") as recording:
            channels, width, rate, frames = (recording.getnchannels(), recording.getsampwidth(),
                                              recording.getframerate(), recording.getnframes())
            if channels not in (1, 2) or width != 2 or not 8000 <= rate <= 48000 or not 1 <= frames <= rate * 60:
                raise ValueError("unsupported_audio_format_or_duration")
            pcm = recording.readframes(frames)
            if len(pcm) != frames * channels * width:
                raise ValueError("truncated_audio")
    except (wave.Error, EOFError) as exc:
        raise ValueError("invalid_wav") from exc
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    frame_samples = max(1, rate // 50) * channels
    inactive_samples = 0
    inactive_runs = 0
    in_silence = False
    for start in range(0, len(samples), frame_samples):
        chunk = samples[start:start + frame_samples]
        rms = math.sqrt(sum(int(value) ** 2 for value in chunk) / len(chunk))
        silent = rms < rms_threshold
        if silent:
            inactive_samples += len(chunk)
            if not in_silence:
                inactive_runs += 1
        in_silence = silent
    return {"duration_ms": round(frames / rate * 1000), "energy_inactive_ratio": round(inactive_samples / len(samples), 4),
            "energy_inactive_runs": inactive_runs, "rms_threshold": rms_threshold,
            "pronunciation_band": None, "speech_recognition_performed": False,
            "limitation": "Silence and background noise affect energy. This does not identify speech, phonemes or pronunciation quality."}
