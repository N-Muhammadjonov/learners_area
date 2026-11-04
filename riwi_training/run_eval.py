"""Modelni eval_set.jsonl bo'yicha sinaydi (OpenAI-mos endpoint: Ollama, llama.cpp server...).

  python run_eval.py --base-url http://localhost:11434/v1 --model riwi --out results.jsonl

Avtomatik tekshiruv QO'POL (kalit so'zlar): "o'tdi" = to'g'ri degani emas.
Har ishga tushirishdan keyin results.jsonl dan kamida 10 ta javobni qo'lda o'qing.
"""
import argparse
import collections
import json
import pathlib

import httpx

from prepare_data import build_user, load_system

HERE = pathlib.Path(__file__).parent


def check(output: str, item: dict) -> list[str]:
    low, fails = output.lower(), []
    for s in item.get("all_of", []):
        if s.lower() not in low:
            fails.append(f"yo'q: {s}")
    any_of = item.get("any_of", [])
    if any_of and not any(s.lower() in low for s in any_of):
        fails.append("hech biri yo'q: " + " | ".join(any_of))
    for s in item.get("none_of", []):
        if s.lower() in low:
            fails.append(f"taqiqlangan: {s}")
    return fails


def ask(client, base_url, model, system, item) -> str:
    r = client.post(f"{base_url.rstrip('/')}/chat/completions", json={
        "model": model, "temperature": 0.2, "max_tokens": 900,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": build_user(item.get("context"), item["prompt"])}],
    })
    r.raise_for_status()
    return (r.json()["choices"][0]["message"].get("content") or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:11434/v1")
    ap.add_argument("--model", required=True)
    ap.add_argument("--api-key", default="none")
    ap.add_argument("--eval", default=str(HERE / "eval_set.jsonl"))
    ap.add_argument("--out", default="results.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    items = [json.loads(l) for l in pathlib.Path(a.eval).read_text(encoding="utf-8").splitlines() if l.strip()]
    if a.limit:
        items = items[: a.limit]
    system = load_system()
    stats = collections.defaultdict(lambda: [0, 0])
    with httpx.Client(timeout=120, headers={"Authorization": f"Bearer {a.api_key}"}) as c, \
            open(a.out, "w", encoding="utf-8") as out:
        for it in items:
            try:
                text = ask(c, a.base_url, a.model, system, it)
                fails = check(text, it)
            except httpx.HTTPError as e:
                text, fails = "", [f"so'rov xatosi: {e}"]
            stats[it["category"]][1] += 1
            stats[it["category"]][0] += not fails
            out.write(json.dumps({**it, "output": text, "fails": fails}, ensure_ascii=False) + "\n")
            print(("PASS " if not fails else "FAIL ") + it["id"], fails[:1] or "")
    tot_p = sum(p for p, _ in stats.values())
    tot_n = sum(n for _, n in stats.values())
    print("\nKategoriya bo'yicha:")
    for k, (p, n) in sorted(stats.items()):
        print(f"  {k:12s} {p}/{n}")
    print(f"JAMI: {tot_p}/{tot_n}  ({100 * tot_p / max(tot_n, 1):.0f}%)")


if __name__ == "__main__":
    main()
