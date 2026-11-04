"""sft_sample.jsonl (yoki o'zingizning faylingiz) -> train.jsonl / val.jsonl (chat format).

Kirish qatori maydonlari:
  task, level, source, user, assistant, context (ixtiyoriy: sayt matni, RAG uchun)
Ishlatish:  python prepare_data.py sft_sample.jsonl
"""
import collections
import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
ALLOWED_TASKS = {"explain", "translate", "correct", "teach", "exercises", "vocab", "difference",
                 "offtopic", "site", "pronunciation", "idiom", "feedback", "refuse_unknown"}
ALLOWED_SOURCES = {"own", "teacher", "tatoeba", "synthetic_open", "other"}


def load_system() -> str:
    return (HERE / "system_prompt.txt").read_text(encoding="utf-8").strip()


def build_user(context: str | None, user: str) -> str:
    """Trening va baholashda BIR XIL format ishlatilishi shart."""
    if context:
        return f"CONTEXT:\n{context.strip()}\n\nQUESTION:\n{user.strip()}"
    return user.strip()


def validate(row: dict, i: int) -> list[str]:
    errs = []
    for k in ("task", "source", "user", "assistant"):
        if not str(row.get(k, "")).strip():
            errs.append(f"#{i}: '{k}' bo'sh")
    if row.get("task") not in ALLOWED_TASKS:
        errs.append(f"#{i}: noma'lum task {row.get('task')!r}")
    if row.get("source") not in ALLOWED_SOURCES:
        errs.append(f"#{i}: noma'lum source {row.get('source')!r}")
    if len(str(row.get("assistant", "")).strip()) < 20:
        errs.append(f"#{i}: assistant javobi juda qisqa")
    if len(str(row.get("user", "")) + len(str(row.get("assistant", ""))) > 6000:
        errs.append(f"#{i}: juda uzun (>6000 belgi)")
    return errs


def main(path: str) -> int:
    rows = [json.loads(l) for l in pathlib.Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    errors, seen, kept = [], set(), []
    for i, r in enumerate(rows, 1):
        e = validate(r, i)
        key = (r.get("context") or "", r.get("user", "").strip().lower())
        if key in seen:
            e.append(f"#{i}: takror savol")
        seen.add(key)
        (errors.extend(e) if e else kept.append(r))
    if errors:
        print("XATOLAR:\n" + "\n".join(errors))
        return 1

    system = load_system()
    train, val = [], []
    for r in kept:
        item = {"messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": build_user(r.get("context"), r["user"])},
            {"role": "assistant", "content": r["assistant"].strip()},
        ]}
        bucket = int(hashlib.sha1(r["user"].encode()).hexdigest(), 16) % 10
        (val if bucket == 0 else train).append(item)

    for name, data in (("train.jsonl", train), ("val.jsonl", val)):
        with open(HERE / name, "w", encoding="utf-8") as f:
            for it in data:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")

    print(f"OK: {len(kept)} ta namuna -> train {len(train)}, val {len(val)}")
    print("task bo'yicha:", dict(collections.Counter(r["task"] for r in kept)))
    print("source bo'yicha:", dict(collections.Counter(r["source"] for r in kept)))
    if len(kept) < 1000:
        print("OGOHLANTIRISH: sifatli natija uchun odatda minglab namuna kerak; bu hajm faqat formatni sinash uchun.")
    if not val:
        print("OGOHLANTIRISH: val bo'sh (namunalar kam).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "sft_sample.jsonl"))
