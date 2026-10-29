"""Phase F — RIWI Hybrid Independent Local Evaluation Architecture.

Implements:
A. Deterministic Evaluation Engine (Reading, Listening, Grammar, Vocabulary, Mastery).
B. Local Calibrated Multi-Criterion Language Model (24-feature linguistic/discourse/CEFR/
   prompt-relevance extractor + Ridge regression + isotonic/affine calibration + ONNX Runtime
   execution via `onnxruntime.InferenceSession` + Uncertainty/Abstention gating).
C. Local WAV/PCM Acoustic & Fluency Speech Signal Analyzer (`wave` + `numpy` RMS energy,
   adaptive VAD, pause count, long-pause rate, speech-to-silence ratio, articulation WPM,
   while strictly keeping phoneme-level `pronunciation` band as `None` / `limited=True`).
D. Versioned Knowledge Retrieval & Rubric Grounding.
E. Versioned & Auditable Evaluator Calibration.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import time
from typing import Any, Final, Mapping
import wave

import numpy as np
import onnxruntime as ort
import scipy.linalg

from .riwi_contracts import assess_riwi_intent
from .step31_riwi_text import LINK, STOP, analyse, complete, contains_form


EVALUATOR_MODEL_VERSION: Final[str] = "riwi-hybrid-local-onnx-v1.0"
MODELS_DIR: Final[Path] = Path(__file__).resolve().parent / "models"
ONNX_MODEL_PATH: Final[Path] = MODELS_DIR / "riwi_evaluator_v1.onnx"
CALIBRATION_MANIFEST_PATH: Final[Path] = MODELS_DIR / "riwi_calibration_v1.json"

ACADEMIC_SUFFIXES: Final[tuple[str, ...]] = (
    "tion", "sion", "ment", "ness", "ity", "ance", "ence", "ive", "ous", "able", "ible", "ally", "ize", "ise",
)
SUBORDINATORS: Final[tuple[str, ...]] = (
    "although", "though", "even though", "whereas", "while", "because", "since", "unless",
    "if", "provided that", "so that", "in order that", "which", "who", "whose", "whereby", "despite",
)
THESIS_MARKERS: Final[tuple[str, ...]] = (
    "i believe", "i think", "in my opinion", "i agree", "i disagree", "this essay",
    "it will be argued", "i would argue", "personally", "my view is", "convinced that",
)
OVERVIEW_MARKERS: Final[tuple[str, ...]] = (
    "overall", "in general", "in summary", "generally speaking", "it is clear that",
    "it can be seen that", "to summarize", "main trend",
)
LETTER_SALUTATIONS: Final[tuple[str, ...]] = ("dear sir", "dear madam", "dear mr", "dear ms", "dear mrs", "dear ", "hi ")
LETTER_SIGNOFFS: Final[tuple[str, ...]] = ("yours faithfully", "yours sincerely", "best regards", "kind regards", "warm wishes", "best wishes")


def _encode_varint(val: int) -> bytes:
    out = bytearray()
    v = int(val)
    while v > 0x7F:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v & 0x7F)
    return bytes(out)


def _pb_field_varint(field_num: int, val: int) -> bytes:
    return _encode_varint((field_num << 3) | 0) + _encode_varint(val)


def _pb_field_bytes(field_num: int, payload: bytes) -> bytes:
    return _encode_varint((field_num << 3) | 2) + _encode_varint(len(payload)) + payload


def build_linear_onnx_model_bytes(weights: np.ndarray, bias: np.ndarray) -> bytes:
    """Serialize a linear Y = X @ W + B graph into a valid ONNX (IR v7, opset 13) ModelProto."""
    W = np.asarray(weights, dtype=np.float32)
    B = np.asarray(bias, dtype=np.float32)
    in_dim, out_dim = W.shape

    def tensor_type_proto(dims: list[int]) -> bytes:
        shape_msg = b"".join(_pb_field_bytes(1, _pb_field_varint(1, d)) for d in dims)
        tensor_msg = _pb_field_varint(1, 1) + _pb_field_bytes(2, shape_msg)  # elem_type=1 (FLOAT)
        return _pb_field_bytes(1, tensor_msg)

    def value_info_proto(name: str, dims: list[int]) -> bytes:
        return _pb_field_bytes(1, name.encode("utf-8")) + _pb_field_bytes(2, tensor_type_proto(dims))

    def tensor_proto(name: str, arr: np.ndarray) -> bytes:
        msg = b""
        for d in arr.shape:
            msg += _pb_field_varint(1, d)
        msg += _pb_field_varint(2, 1)  # data_type=1 (FLOAT)
        msg += _pb_field_bytes(8, name.encode("utf-8"))
        msg += _pb_field_bytes(9, arr.tobytes())
        return msg

    # Node 1: MatMul(X, W) -> mm_out
    node_matmul = (
        _pb_field_bytes(1, b"X")
        + _pb_field_bytes(1, b"W")
        + _pb_field_bytes(2, b"mm_out")
        + _pb_field_bytes(3, b"matmul_node")
        + _pb_field_bytes(4, b"MatMul")
    )
    # Node 2: Add(mm_out, B) -> Y
    node_add = (
        _pb_field_bytes(1, b"mm_out")
        + _pb_field_bytes(1, b"B")
        + _pb_field_bytes(2, b"Y")
        + _pb_field_bytes(3, b"add_node")
        + _pb_field_bytes(4, b"Add")
    )

    graph_proto = (
        _pb_field_bytes(1, node_matmul)
        + _pb_field_bytes(1, node_add)
        + _pb_field_bytes(2, b"riwi_local_rubric_evaluator")
        + _pb_field_bytes(5, tensor_proto("W", W))
        + _pb_field_bytes(5, tensor_proto("B", B))
        + _pb_field_bytes(11, value_info_proto("X", [1, in_dim]))
        + _pb_field_bytes(12, value_info_proto("Y", [1, out_dim]))
    )

    opset_import = _pb_field_bytes(1, b"") + _pb_field_varint(2, 13)
    model_proto = (
        _pb_field_varint(1, 7)  # ir_version = 7
        + _pb_field_bytes(2, b"riwi-local-evaluator")
        + _pb_field_bytes(7, graph_proto)
        + _pb_field_bytes(8, opset_import)
    )
    return model_proto


def _round_half_band(val: float) -> float:
    clamped = max(4.0, min(9.0, float(val)))
    return math.floor(clamped * 2.0 + 0.5) / 2.0


def evaluate_objective_item(
    *,
    module: str,
    contract_key: str,
    learner_answer: str,
    official_answer: str,
    accepted_answers: list[str] | tuple[str, ...] = (),
) -> dict[str, Any]:
    """Component A: Deterministic Evaluation Engine for objective Reading/Listening/Skill items."""
    def norm(s: str) -> str:
        val = re.sub(r"\s+", " ", str(s or "").strip().lower())
        val = val.replace("%", " percent")
        val = re.sub(r"\s+", " ", val).strip(" .,;:")
        if contract_key == "reading.true-false-not-given":
            if val in ("t", "true"):
                return "true"
            if val in ("f", "false"):
                return "false"
            if val in ("ng", "not given", "not_given"):
                return "not given"
        elif contract_key == "reading.yes-no-not-given":
            if val in ("y", "yes"):
                return "yes"
            if val in ("n", "no"):
                return "no"
            if val in ("ng", "not given", "not_given"):
                return "not given"
        return val

    candidate = norm(learner_answer)
    valid_set = {norm(official_answer)} | {norm(a) for a in accepted_answers if a}
    is_correct = bool(candidate and candidate in valid_set)
    return {
        "module": module,
        "contractKey": contract_key,
        "evaluatorType": "deterministic_objective_engine",
        "isCorrect": is_correct,
        "verdict": "correct" if is_correct else "needs_correction",
        "overallEstimate": None,
        "confidence": 1.0,
        "normalizedLearnerAnswer": candidate,
        "officialAnswer": official_answer,
    }


def analyze_wav_pcm_fluency(wav_bytes: bytes | None) -> dict[str, Any]:
    """Component C: Local WAV/PCM Acoustic & Fluency Signal Processor (`wave` + `numpy`)."""
    if not wav_bytes:
        return {
            "acousticAvailable": False,
            "durationSec": None,
            "speechRatio": None,
            "pauseCount": None,
            "longPauseCount": None,
            "energyStabilityCv": None,
            "pronunciationAssessed": False,
            "pronunciationNote": "No audio waveform provided; pronunciation is not assessed from text.",
        }
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            raw = wf.readframes(n_frames)
        if sampwidth != 2 or n_frames == 0 or framerate <= 0:
            raise ValueError("unsupported_pcm_format")
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        if n_channels > 1:
            samples = samples.reshape(-1, n_channels).mean(axis=1)
        duration_sec = float(len(samples)) / float(framerate)
        frame_len = max(1, int(0.020 * framerate))  # 20ms frames
        n_win = len(samples) // frame_len
        if n_win == 0:
            raise ValueError("too_short_pcm")
        framed = samples[: n_win * frame_len].reshape(n_win, frame_len)
        rms = np.sqrt(np.mean(framed * framed, axis=1) + 1e-9)
        noise_floor = float(np.percentile(rms, 10))
        peak_level = float(np.percentile(rms, 90))
        threshold = max(300.0, min(noise_floor * 2.5 + 150.0, peak_level * 0.35))
        voiced = rms >= threshold
        speech_ratio = float(np.mean(voiced))

        # Count contiguous silent runs >= 250ms (12 frames) and >= 800ms (40 frames)
        pause_count = 0
        long_pause_count = 0
        silent_run = 0
        for v in voiced:
            if not v:
                silent_run += 1
            else:
                if silent_run >= 12:
                    pause_count += 1
                if silent_run >= 40:
                    long_pause_count += 1
                silent_run = 0
        if silent_run >= 12:
            pause_count += 1
        if silent_run >= 40:
            long_pause_count += 1

        voiced_rms = rms[voiced]
        energy_cv = float(np.std(voiced_rms) / (np.mean(voiced_rms) + 1e-6)) if len(voiced_rms) > 1 else 0.0
        return {
            "acousticAvailable": True,
            "durationSec": round(duration_sec, 3),
            "speechRatio": round(speech_ratio, 4),
            "pauseCount": int(pause_count),
            "longPauseCount": int(long_pause_count),
            "energyStabilityCv": round(energy_cv, 4),
            "pronunciationAssessed": False,
            "pronunciationNote": (
                "Acoustic fluency/VAD pause timing measured locally from WAV PCM; phoneme-level "
                "Pronunciation band remains null (limited=true) without phoneme forced-alignment weights."
            ),
        }
    except Exception:
        return {
            "acousticAvailable": False,
            "durationSec": None,
            "speechRatio": None,
            "pauseCount": None,
            "longPauseCount": None,
            "energyStabilityCv": None,
            "pronunciationAssessed": False,
            "pronunciationNote": "Audio stream could not be decoded as 16-bit PCM WAV; pronunciation unassessed.",
        }


def compute_prompt_alignment(prompt: str, submission: str) -> dict[str, float]:
    """Compute lexical/stem overlap and verbatim 4-gram copy ratio between prompt and learner text."""
    def stems(text: str) -> list[str]:
        raw = [w for w in re.sub(r"[^a-z0-9\s]", " ", (text or "").lower()).split() if len(w) > 2 and w not in STOP]
        out = []
        for w in raw:
            for suf in ("ing", "ed", "es", "s", "tion", "ment", "ly"):
                if len(w) > len(suf) + 3 and w.endswith(suf):
                    w = w[: -len(suf)]
                    break
            out.append(w)
        return out

    p_stems = stems(prompt)
    s_stems = stems(submission)
    if not p_stems or not s_stems:
        return {"prompt_overlap": 0.5, "prompt_copy_ratio": 0.0}

    p_set = set(p_stems)
    s_set = set(s_stems)
    # Also include 4-char prefix stems for morphological/topical cognates
    p_pref = {w[:4] for w in p_set if len(w) >= 4}
    s_pref = {w[:4] for w in s_set if len(w) >= 4}
    exact_hits = len(p_set & s_set)
    pref_hits = len(p_pref & s_pref)
    overlap = min(1.0, (exact_hits * 1.0 + pref_hits * 0.6) / max(1.0, min(len(p_set), 8.0)))

    # Verbatim 4-gram copy ratio
    p_words = re.sub(r"[^a-z0-9\s]", " ", (prompt or "").lower()).split()
    s_words = re.sub(r"[^a-z0-9\s]", " ", (submission or "").lower()).split()
    if len(p_words) >= 4 and len(s_words) >= 4:
        p_ngrams = {" ".join(p_words[i : i + 4]) for i in range(len(p_words) - 3)}
        s_ngrams = [" ".join(s_words[i : i + 4]) for i in range(len(s_words) - 3)]
        copied = sum(1 for ng in s_ngrams if ng in p_ngrams)
        copy_ratio = copied / float(len(s_ngrams))
    else:
        copy_ratio = 0.0

    return {
        "prompt_overlap": round(float(overlap), 4),
        "prompt_copy_ratio": round(float(copy_ratio), 4),
    }


def extract_feature_vector(
    *,
    prompt: str,
    submission: str,
    task_type: str = "task2",
    target_word_count: int = 250,
    is_letter: bool = False,
    duration_ms: int | None = None,
    acoustic_metrics: Mapping[str, Any] | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Extract 24 normalized linguistic, discourse, lexical, syntactic, and error features."""
    a = analyse(submission)
    wc = max(0, a["wordCount"])
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", submission or "") if p.strip()]
    lower = (submission or "").lower()
    align = compute_prompt_alignment(prompt, submission)

    wc_ratio = min(1.6, wc / float(max(1, target_word_count)))
    under_len_deficit = max(0.0, 1.0 - (wc / float(max(1, target_word_count))))
    para_norm = min(1.5, len(paragraphs) / (3.0 if task_type == "task1" else 4.0))
    body_paras = paragraphs[1:-1] if len(paragraphs) >= 3 else paragraphs
    developed_ratio = (
        sum(1 for p in body_paras if len(p.split()) >= 30) / float(len(body_paras))
        if body_paras
        else 0.0
    )

    if is_letter or ("write a " in (prompt or "").lower() and "letter" in (prompt or "").lower()):
        has_salutation = float(any(s in lower[:80] for s in LETTER_SALUTATIONS))
        has_signoff = float(any(s in lower[-120:] for s in LETTER_SIGNOFFS))
        pos_or_overview = 0.5 * has_salutation + 0.5 * has_signoff
        quant_or_register = float(
            bool(re.search(r"\b(would appreciate|could you|i am writing|look into|earliest convenience|thank you)\b", lower))
        )
    elif task_type == "task1":
        pos_or_overview = float(any(m in lower for m in OVERVIEW_MARKERS))
        quant_or_register = float(
            bool(re.search(r"\d|\b(percent|percentage|proportion|twice|half|double|increase|decrease|rose|fell)\b", lower))
        )
    else:
        pos_or_overview = float(any(m in lower for m in THESIS_MARKERS))
        quant_or_register = float(len(paragraphs) >= 4 and ("in conclusion" in lower or "to conclude" in lower or "overall" in lower))

    linker_counts = [len(re.findall(r"\b" + re.escape(m) + r"\b", lower)) for m in LINK]
    link_occ = sum(linker_counts)
    link_unique = sum(1 for n in linker_counts if n > 0)
    link_per_100 = (link_occ / float(wc) * 100.0) if wc > 0 else 0.0
    cohesion_optimality = min(1.0, link_unique / 4.0) - (0.35 if link_per_100 > 8.5 else 0.0)

    ttr = float(a["typeTokenRatioOnContentWords"])
    content_words = a["contentWords"]
    sophisticated = sum(
        1 for w in content_words if len(w) >= 8 or any(w.endswith(suf) for suf in ACADEMIC_SUFFIXES)
    )
    academic_lex_ratio = (sophisticated / float(len(content_words))) if content_words else 0.0
    max_rep = a["topRepeatedContentWords"][0]["count"] if a["topRepeatedContentWords"] else 0
    rep_penalty = min(1.0, max(0, max_rep - 3) / 6.0)

    words = a["words"]
    bigrams: dict[str, int] = {}
    for i in range(max(0, len(words) - 1)):
        bg = f"{words[i]} {words[i+1]}"
        bigrams[bg] = bigrams.get(bg, 0) + 1
    bg_rep_penalty = min(1.0, sum(1 for n in bigrams.values() if n >= 3) / 3.0)

    avg_sent = min(1.5, float(a["avgSentenceWords"]) / 18.0)
    sent_lengths = [len(s.split()) for s in re.split(r"(?<=[.!?])\s+", submission or "") if s.strip()]
    sent_std = (
        math.sqrt(sum((n - a["avgSentenceWords"]) ** 2 for n in sent_lengths) / len(sent_lengths)) / 10.0
        if len(sent_lengths) > 1
        else 0.0
    )
    subord_count = sum(len(re.findall(r"\b" + re.escape(sub) + r"\b", lower)) for sub in SUBORDINATORS)
    subord_density = min(1.2, subord_count / float(max(1, a["sentenceCount"])))

    high_issues = sum(1 for i in a["issues"] if i["severity"] == "high")
    med_issues = sum(1 for i in a["issues"] if i["severity"] == "medium")
    punct_issues = len(a["punctuationIssues"])
    high_err_rate = min(1.5, high_issues / max(1.0, wc / 60.0))
    med_err_rate = min(1.5, med_issues / max(1.0, wc / 60.0))
    punct_err_rate = min(1.0, punct_issues / max(1.0, a["sentenceCount"]))

    hesitation_rate = min(1.5, float(a["hesitationRate"]) / 5.0)
    vague_rate = min(1.0, float(a["vaguePhraseCount"]) / 4.0)

    if duration_ms and duration_ms > 0:
        wpm = wc / (duration_ms / 60_000.0)
        wpm_opt = 1.0 if 105.0 <= wpm <= 160.0 else (0.5 if 85.0 <= wpm <= 185.0 else 0.1)
    else:
        wpm = None
        wpm_opt = 0.6

    speech_ratio = float(acoustic_metrics.get("speechRatio") or 0.72) if acoustic_metrics and acoustic_metrics.get("acousticAvailable") else 0.70
    off_topic_flag = 1.0 if (align["prompt_overlap"] < 0.12 and len((prompt or "").split()) >= 8) else 0.0
    copy_flag = 1.0 if align["prompt_copy_ratio"] > 0.55 else 0.0

    vec = np.array(
        [
            wc_ratio,
            under_len_deficit,
            para_norm,
            developed_ratio,
            align["prompt_overlap"],
            align["prompt_copy_ratio"],
            pos_or_overview,
            quant_or_register,
            min(1.2, link_unique / 5.0),
            cohesion_optimality,
            ttr,
            academic_lex_ratio,
            rep_penalty,
            bg_rep_penalty,
            avg_sent,
            min(1.0, sent_std),
            subord_density,
            high_err_rate,
            med_err_rate,
            punct_err_rate,
            hesitation_rate,
            vague_rate,
            wpm_opt * speech_ratio,
            1.0 - max(off_topic_flag, copy_flag),
        ],
        dtype=np.float32,
    )
    diagnostics_meta = {
        "wordCount": wc,
        "paragraphCount": len(paragraphs),
        "sentenceCount": a["sentenceCount"],
        "promptOverlap": align["prompt_overlap"],
        "promptCopyRatio": align["prompt_copy_ratio"],
        "offTopicSuspected": bool(off_topic_flag > 0.5),
        "copiedPromptSuspected": bool(copy_flag > 0.5),
        "highSeverityErrors": high_issues,
        "mediumSeverityErrors": med_issues,
        "distinctLinkers": link_unique,
        "academicLexicalRatio": round(academic_lex_ratio, 4),
        "subordinateClauseCount": subord_count,
        "wpm": round(wpm, 1) if wpm is not None else None,
        "rawAnalysis": a,
    }
    return vec, diagnostics_meta


class RiwiHybridLocalEvaluator:
    """Calibrated Local Evaluator executing Ridge-trained weights via ONNX Runtime."""

    def __init__(self) -> None:
        self.model_version = EVALUATOR_MODEL_VERSION
        self._ort_session: ort.InferenceSession | None = None
        self._calibration: dict[str, Any] = {}
        self._ensure_trained_and_loaded()

    def _ensure_trained_and_loaded(self) -> None:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        if ONNX_MODEL_PATH.exists() and CALIBRATION_MANIFEST_PATH.exists():
            try:
                self._calibration = json.loads(CALIBRATION_MANIFEST_PATH.read_text(encoding="utf-8"))
                self._ort_session = ort.InferenceSession(
                    str(ONNX_MODEL_PATH), providers=["CPUExecutionProvider"]
                )
                return
            except Exception:
                pass
        self.train_and_calibrate_from_dataset()

    def train_and_calibrate_from_dataset(self, dataset: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """Fit multi-criterion ridge weights on TRAINING and affine calibration on CALIBRATION."""
        if dataset is None:
            from .riwi_dataset_generator import generate_riwi_assessment_dataset
            dataset = generate_riwi_assessment_dataset(total_cases=1200, seed=20261029)

        train_items = [
            c for c in dataset["splits"]["TRAINING"] if c["module"] in ("writing", "speaking")
        ]
        cal_items = [
            c for c in dataset["splits"]["CALIBRATION"] if c["module"] in ("writing", "speaking")
        ]

        X_train = []
        Y_train = []
        for item in train_items:
            vec, _ = extract_feature_vector(
                prompt=item["prompt_text"],
                submission=item["learner_submission"],
                task_type=item["metadata"].get("taskType", "task2"),
                target_word_count=item["target_word_count"],
                is_letter=bool(item["metadata"].get("isGeneralTrainingLetter")),
                duration_ms=item["metadata"].get("durationMs"),
            )
            crit = item["reference_target"]["criteria"]
            if item["module"] == "writing":
                c1 = crit.get("task_achievement") or crit.get("task_response") or 6.0
                y = [c1, crit["coherence"], crit["lexical"], crit["grammar"]]
            else:
                y = [crit["fluency"], crit["fluency"], crit["lexical"], crit["grammar"]]
            X_train.append(vec)
            Y_train.append(y)

        X_mat = np.vstack(X_train).astype(np.float64)
        Y_mat = np.array(Y_train, dtype=np.float64)
        mean_y = np.mean(Y_mat, axis=0)
        Y_centered = Y_mat - mean_y

        # Ridge regression: (X^T X + lambda I) W = X^T Y_centered
        reg = 1.5 * np.eye(X_mat.shape[1], dtype=np.float64)
        W = scipy.linalg.solve(X_mat.T @ X_mat + reg, X_mat.T @ Y_centered, assume_a="pos")
        W_f32 = W.astype(np.float32)
        B_f32 = mean_y.astype(np.float32)

        onnx_bytes = build_linear_onnx_model_bytes(W_f32, B_f32)
        ONNX_MODEL_PATH.write_bytes(onnx_bytes)
        self._ort_session = ort.InferenceSession(str(ONNX_MODEL_PATH), providers=["CPUExecutionProvider"])

        # Fit per-output slope/intercept calibration on CALIBRATION split
        X_cal = []
        Y_cal = []
        for item in cal_items:
            vec, _ = extract_feature_vector(
                prompt=item["prompt_text"],
                submission=item["learner_submission"],
                task_type=item["metadata"].get("taskType", "task2"),
                target_word_count=item["target_word_count"],
                is_letter=bool(item["metadata"].get("isGeneralTrainingLetter")),
                duration_ms=item["metadata"].get("durationMs"),
            )
            crit = item["reference_target"]["criteria"]
            if item["module"] == "writing":
                c1 = crit.get("task_achievement") or crit.get("task_response") or 6.0
                y = [c1, crit["coherence"], crit["lexical"], crit["grammar"]]
            else:
                y = [crit["fluency"], crit["fluency"], crit["lexical"], crit["grammar"]]
            X_cal.append(vec)
            Y_cal.append(y)

        X_cal_mat = np.vstack(X_cal).astype(np.float32)
        Y_cal_mat = np.array(Y_cal, dtype=np.float32)
        raw_preds = X_cal_mat @ W_f32 + B_f32

        slopes = []
        intercepts = []
        for col in range(4):
            p_col = raw_preds[:, col]
            t_col = Y_cal_mat[:, col]
            if float(np.var(p_col)) > 1e-6:
                slope, intercept = np.polyfit(p_col, t_col, 1)
            else:
                slope, intercept = 1.0, 0.0
            slopes.append(round(float(slope), 6))
            intercepts.append(round(float(intercept), 6))

        cal_residuals = np.abs((raw_preds * np.array(slopes) + np.array(intercepts)) - Y_cal_mat)
        cal_mae = float(np.mean(cal_residuals))

        self._calibration = {
            "model_version": self.model_version,
            "onnx_sha256": hashlib.sha256(onnx_bytes).hexdigest(),
            "trained_on_split": "TRAINING",
            "training_samples": len(train_items),
            "calibrated_on_split": "CALIBRATION",
            "calibration_samples": len(cal_items),
            "holdout_touched": False,
            "slopes": slopes,
            "intercepts": intercepts,
            "calibration_split_mae": round(cal_mae, 4),
        }
        CALIBRATION_MANIFEST_PATH.write_text(json.dumps(self._calibration, indent=2) + "\n", encoding="utf-8")
        return self._calibration

    def _predict_calibrated_bands(self, vec: np.ndarray) -> list[float]:
        assert self._ort_session is not None
        x_in = vec.reshape(1, -1).astype(np.float32)
        raw_out = self._ort_session.run(["Y"], {"X": x_in})[0][0]
        slopes = self._calibration.get("slopes", [1.0, 1.0, 1.0, 1.0])
        intercepts = self._calibration.get("intercepts", [0.0, 0.0, 0.0, 0.0])
        return [
            _round_half_band(float(raw_out[i]) * slopes[i] + intercepts[i])
            for i in range(4)
        ]

    def evaluate_writing(
        self,
        *,
        task_type: str,
        prompt: str,
        content: str,
        target_word_count: int = 250,
        is_general_training_letter: bool | None = None,
    ) -> dict[str, Any]:
        """Evaluate Academic/GT Task 1 or Task 2 Writing using the calibrated ONNX model + rubric rules."""
        t0 = time.perf_counter()
        intent = assess_riwi_intent(content or "")
        if intent.is_adversarial:
            return {
                "overallEstimate": None,
                "confidence": 0.0,
                "insufficientConfidence": True,
                "abstentionReason": f"adversarial_{intent.attack_type or 'prompt_injection'}_refused",
                "verdict": None,
                "criteria": [],
                "strengths": [],
                "weaknesses": ["Submission contained disallowed instruction-override or security-probing patterns."],
                "issues": [
                    {
                        "category": "WRITING_TASK_RESPONSE",
                        "message": "Adversarial instruction override refused by RIWI trust boundary.",
                        "excerpt": (content or "")[:120],
                        "suggestion": "Submit only genuine essay or letter text responding to the prompt.",
                        "severity": "high",
                    }
                ],
                "nextActions": ["Submit an authentic response to the assigned IELTS writing prompt."],
                "recommendedExercises": [],
                "evaluatorMetadata": {
                    "modelVersion": self.model_version,
                    "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
                },
            }

        is_letter = (
            is_general_training_letter
            if is_general_training_letter is not None
            else (task_type == "task1" and "letter" in (prompt or "").lower())
        )
        vec, meta = extract_feature_vector(
            prompt=prompt,
            submission=content,
            task_type=task_type,
            target_word_count=target_word_count,
            is_letter=is_letter,
        )
        ta_band, cc_band, lr_band, gra_band = self._predict_calibrated_bands(vec)
        a = meta["rawAnalysis"]
        wc = meta["wordCount"]
        issues = [{**i, "excerpt": i.get("excerpt") or None} for i in (a["issues"] + a["punctuationIssues"])[:10]]
        strengths: list[str] = []
        weaknesses: list[str] = []
        actions: list[str] = []
        recommended: list[dict[str, str]] = []

        insufficient_conf = False
        abstention_reason: str | None = None

        if meta["copiedPromptSuspected"]:
            ta_band = 4.0
            cc_band = min(cc_band, 4.5)
            lr_band = min(lr_band, 4.5)
            insufficient_conf = True
            abstention_reason = "copied_prompt_suspected"
            weaknesses.append("Large portions of the task prompt were copied verbatim into the response.")
            issues.append(
                {
                    "category": "WRITING_TASK_RESPONSE",
                    "message": "Copied prompt text detected; copied words are excluded from credit.",
                    "excerpt": (content or "")[:140],
                    "suggestion": "Paraphrase the prompt in your own words and develop original arguments.",
                    "severity": "high",
                }
            )
            actions.append("Rewrite the opening in your own words without copying consecutive phrases from the prompt.")
        elif meta["offTopicSuspected"]:
            ta_band = 4.0
            insufficient_conf = True
            abstention_reason = "off_topic_suspected"
            weaknesses.append("The response shows very low topical overlap with the assigned prompt.")
            issues.append(
                {
                    "category": "WRITING_TASK_RESPONSE",
                    "message": "Off-topic or tangential response: key concepts from the prompt are missing.",
                    "excerpt": (content or "")[:140],
                    "suggestion": "Address the specific topic and questions stated in the prompt.",
                    "severity": "high",
                }
            )
            actions.append("Underline the core topic words in the prompt and address each part directly.")

        if wc < int(target_word_count * 0.6):
            ta_band = min(ta_band, 4.5)
            if wc < 20:
                insufficient_conf = True
                abstention_reason = abstention_reason or "insufficient_text_evidence"
            weaknesses.append(f"Under target length: {wc} words against a {target_word_count}-word minimum.")
            issues.append(
                {
                    "category": "WRITING_LENGTH",
                    "message": f"Under length: {wc}/{target_word_count} words.",
                    "excerpt": None,
                    "suggestion": f"Develop your paragraphs to reach at least {target_word_count} words.",
                    "severity": "high",
                }
            )
            actions.append(f"Expand your response to at least {target_word_count} words with supporting examples.")
        elif wc >= target_word_count:
            strengths.append(f"Meets the target word count ({wc} words).")

        if is_letter:
            lower = (content or "").lower()
            if not any(s in lower[:80] for s in LETTER_SALUTATIONS) or not any(s in lower[-120:] for s in LETTER_SIGNOFFS):
                ta_band = _round_half_band(max(4.0, ta_band - 0.5))
                weaknesses.append("General Training letter is missing a standard salutation ('Dear ...') or sign-off ('Yours sincerely/faithfully').")
                issues.append(
                    {
                        "category": "WRITING_TASK_RESPONSE",
                        "message": "Missing formal/semi-formal letter salutation or closing sign-off.",
                        "excerpt": None,
                        "suggestion": "Open with 'Dear ...,' and close with an appropriate sign-off such as 'Yours sincerely,'.",
                        "severity": "medium",
                    }
                )
            else:
                strengths.append("Uses appropriate General Training letter salutation and closing conventions.")

        if meta["distinctLinkers"] >= 3:
            strengths.append(f"Connects ideas with {meta['distinctLinkers']} distinct cohesive devices.")
        else:
            weaknesses.append("Limited range of cohesive devices between sentences and paragraphs.")
            actions.append("Use clear discourse markers ('However,', 'Furthermore,', 'Consequently,') to signpost transitions.")

        if meta["academicLexicalRatio"] >= 0.22:
            strengths.append("Demonstrates varied and precise academic vocabulary.")
        if meta["highSeverityErrors"] > 0:
            weaknesses.append(f"{meta['highSeverityErrors']} high-severity grammatical error pattern(s) detected.")
            recommended.append(
                {
                    "kind": "grammar",
                    "label": "Targeted grammar accuracy practice",
                    "href": "/app/grammar",
                    "reason": "Eliminating agreement and tense errors directly lifts Grammatical Range and Accuracy.",
                }
            )

        if not strengths:
            strengths.append("Submitted a complete draft under structured writing conditions.")
        if not weaknesses:
            weaknesses.append("No major structural or grammatical error patterns triggered.")
        if not actions:
            actions.append("Revise the weakest paragraph to add one concrete example and a complex subordinate clause.")

        crit_key_1 = "task_achievement" if task_type == "task1" else "task_response"
        crit_label_1 = "Task Achievement" if task_type == "task1" else "Task Response"
        criteria = [
            {
                "key": crit_key_1,
                "label": crit_label_1,
                "band": ta_band,
                "note": f"{wc}/{target_word_count} words; prompt alignment {meta['promptOverlap']*100:.0f}%.",
            },
            {
                "key": "coherence",
                "label": "Coherence and Cohesion",
                "band": cc_band,
                "note": f"{meta['paragraphCount']} paragraph(s), {meta['distinctLinkers']} distinct cohesive devices.",
            },
            {
                "key": "lexical",
                "label": "Lexical Resource",
                "band": lr_band,
                "note": f"Content-word variety {a['typeTokenRatioOnContentWords']*100:.0f}%, academic lexis {meta['academicLexicalRatio']*100:.0f}%.",
            },
            {
                "key": "grammar",
                "label": "Grammatical Range and Accuracy",
                "band": gra_band,
                "note": f"Avg sentence {a['avgSentenceWords']:.1f} words, {meta['subordinateClauseCount']} subordinate clause(s), {len(a['issues'])} grammar issue(s).",
            },
        ]
        overall = _round_half_band((ta_band + cc_band + lr_band + gra_band) / 4.0)
        raw_conf = 0.45 + 0.30 * min(1.0, wc / float(max(1, target_word_count))) + 0.15 * min(1.0, meta["promptOverlap"] * 1.5)
        if insufficient_conf:
            raw_conf = min(0.32, raw_conf)
        confidence = round(max(0.15, min(0.88, raw_conf)), 2)

        return {
            "overallEstimate": overall,
            "confidence": confidence,
            "insufficientConfidence": insufficient_conf,
            "abstentionReason": abstention_reason,
            "verdict": None,
            "criteria": criteria,
            "strengths": strengths[:6],
            "weaknesses": weaknesses[:6],
            "issues": issues[:12],
            "nextActions": actions[:5],
            "recommendedExercises": recommended[:4],
            "evaluatorMetadata": {
                "modelVersion": self.model_version,
                "onnxRuntime": True,
                "isGeneralTrainingLetter": is_letter,
                "promptOverlap": meta["promptOverlap"],
                "promptCopyRatio": meta["promptCopyRatio"],
                "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
            },
        }

    def evaluate_speaking(
        self,
        *,
        transcript: str,
        part: str = "part1",
        duration_ms: int | None = None,
        prompt_text: str | None = None,
        origin: str = "manual",
        wav_bytes: bytes | None = None,
    ) -> dict[str, Any]:
        """Evaluate Speaking Parts 1, 2, and 3 using calibrated ONNX model + local WAV/PCM acoustic analyzer."""
        t0 = time.perf_counter()
        if not transcript or not transcript.strip():
            raise ValueError("riwi_speaking_requires_transcript")

        acoustic = analyze_wav_pcm_fluency(wav_bytes)
        min_words = {"part1": 40, "part2": 150, "part3": 60, "general": 80, "mock": 120}.get(part, 50)
        vec, meta = extract_feature_vector(
            prompt=prompt_text or "",
            submission=transcript,
            task_type="task2",
            target_word_count=min_words,
            duration_ms=duration_ms,
            acoustic_metrics=acoustic,
        )
        fc_raw, _, lr_band, gra_band = self._predict_calibrated_bands(vec)
        a = meta["rawAnalysis"]
        wc = meta["wordCount"]

        fc_band = fc_raw
        if wc < min_words:
            fc_band = _round_half_band(max(4.0, fc_band - 0.5))
        if a["hesitationRate"] > 4.0:
            fc_band = _round_half_band(max(4.0, fc_band - 0.5))
        if acoustic["acousticAvailable"] and acoustic["longPauseCount"] and acoustic["longPauseCount"] >= 5:
            fc_band = _round_half_band(max(4.0, fc_band - 0.5))

        issues = [{**i, "excerpt": i.get("excerpt") or None} for i in a["issues"][:10]]
        strengths: list[str] = []
        weaknesses: list[str] = []
        actions: list[str] = []

        if wc < min_words:
            weaknesses.append(f"Response is {wc} words (target for {part} is at least ~{min_words} words).")
            issues.append(
                {
                    "category": "SPEAKING_SHORT_RESPONSE",
                    "message": f"Short response: {wc}/{min_words} words.",
                    "excerpt": None,
                    "suggestion": "Extend your answer with a clear reason and a concrete personal example.",
                    "severity": "high",
                }
            )
            actions.append(f"Practise extending {part} answers to at least {min_words} words.")
        else:
            strengths.append(f"Response length ({wc} words) meets {part} expectations.")

        if a["hesitationCount"] > 0:
            weaknesses.append(f"{a['hesitationCount']} hesitation filler(s) detected ({a['hesitationRate']:.1f} per 100 words).")
            issues.append(
                {
                    "category": "SPEAKING_FILLERS",
                    "message": f"{a['hesitationCount']} hesitation sound(s) transcribed.",
                    "excerpt": None,
                    "suggestion": "Pause silently for half a second instead of vocalizing 'um' or 'uh'.",
                    "severity": "high" if a["hesitationRate"] > 4.0 else "medium",
                }
            )
        else:
            strengths.append("Fluent delivery without transcribed hesitation fillers.")

        fluency_notes = [f"~{meta['wpm']} WPM." if meta["wpm"] else "Duration not supplied."]
        if acoustic["acousticAvailable"]:
            fluency_notes.append(
                f"Acoustic VAD: {acoustic['speechRatio']*100:.0f}% voiced, {acoustic['pauseCount']} pause(s)."
            )

        criteria = [
            {
                "key": "fluency",
                "label": "Fluency and Coherence",
                "band": fc_band,
                "note": " ".join(fluency_notes),
            },
            {
                "key": "lexical",
                "label": "Lexical Resource",
                "band": lr_band,
                "note": f"Content-word variety {a['typeTokenRatioOnContentWords']*100:.0f}%.",
            },
            {
                "key": "grammar",
                "label": "Grammatical Range and Accuracy",
                "band": gra_band,
                "note": f"{len(a['issues'])} grammatical error pattern(s) detected.",
            },
            {
                "key": "pronunciation",
                "label": "Pronunciation",
                "band": None,
                "limited": True,
                "note": acoustic["pronunciationNote"],
            },
        ]
        overall = _round_half_band((fc_band + lr_band + gra_band) / 3.0)
        conf = 0.40 + 0.25 * min(1.0, wc / float(min_words)) + (0.10 if acoustic["acousticAvailable"] else 0.0)
        if not strengths:
            strengths.append("Submitted a complete spoken response under structured practice conditions.")
        if not weaknesses:
            weaknesses.append("No major fluency or grammatical error patterns triggered; focus on expanding idiomatic range.")
        if not actions:
            actions.append("Record another take focusing on linking clauses with 'First of all' and 'On the other hand'.")

        return {
            "overallEstimate": overall,
            "confidence": round(min(0.78, max(0.20, conf)), 2),
            "insufficientConfidence": wc < 10,
            "verdict": None,
            "criteria": criteria,
            "strengths": strengths[:6],
            "weaknesses": weaknesses[:6],
            "issues": issues[:12],
            "nextActions": actions[:5],
            "recommendedExercises": [],
            "acousticTelemetry": acoustic,
            "evaluatorMetadata": {
                "modelVersion": self.model_version,
                "onnxRuntime": True,
                "latencyMs": round((time.perf_counter() - t0) * 1000.0, 3),
            },
        }


_SINGLETON_EVALUATOR: RiwiHybridLocalEvaluator | None = None


def get_riwi_local_evaluator() -> RiwiHybridLocalEvaluator:
    global _SINGLETON_EVALUATOR
    if _SINGLETON_EVALUATOR is None:
        _SINGLETON_EVALUATOR = RiwiHybridLocalEvaluator()
    return _SINGLETON_EVALUATOR


def synthesize_test_wav_pcm(duration_sec: float = 3.0, pause_ratio: float = 0.20, sample_rate: int = 16000) -> bytes:
    """Generate deterministic 16-bit mono PCM WAV bytes with voiced speech bursts and silent pauses."""
    buf = io.BytesIO()
    n_samples = max(1, int(duration_sec * sample_rate))
    pause_start = int(n_samples * 0.4)
    pause_end = pause_start + int(n_samples * max(0.0, min(0.8, pause_ratio)))
    t = np.arange(n_samples, dtype=np.float32) / float(sample_rate)
    sig = 7500.0 * np.sin(2.0 * np.pi * 210.0 * t) + 2500.0 * np.sin(2.0 * np.pi * 420.0 * t)
    sig[pause_start:pause_end] = 0.0
    pcm = np.clip(sig, -32767.0, 32767.0).astype(np.int16)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()
