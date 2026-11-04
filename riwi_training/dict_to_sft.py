"""Lug'at jadvalidan (CSV yoki JSONL) RIWI o'qitish namunalarini yasaydi.

Ustun nomlari sizning faylingizdagidan farq qilsa, --map bilan ko'rsating:
  python dict_to_sft.py my_dictionary.csv --out dict_sft.jsonl \
      --map word=headword uz=uzbek definition_en=definition example_en=example

Standart ustunlar: word, pos, definition_en, uz, example_en, example_uz  (faqat word va uz majburiy)

Chiqish: prepare_data.py formatidagi qatorlar (source="own").
DIQQAT: bu shablonli ma'lumot. Faqat shundan o'qitsangiz, model shablonga ko'nikib qoladi.
Uni boshqa turdagi namunalar (o'qituvchi yozgan tushuntirish, xato tuzatish, suhbat) bilan
aralashtiring. Uzbekcha tarjimalar sifati lug'atingiz sifatiga teng bo'ladi.
"""
import argparse
import collections
import csv
import json
import pathlib
import random
import re

DEFAULT_COLS = ["word", "pos", "definition_en", "uz", "example_en", "example_uz"]


def read_rows(path: str, colmap: dict[str, str]) -> list[dict]:
    p = pathlib.Path(path)
    if p.suffix.lower() == ".jsonl":
        raw = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        with open(p, encoding="utf-8-sig", newline="") as f:
            raw = list(csv.DictReader(f))
    rows = []
    for r in raw:
        row = {c: str(r.get(colmap.get(c, c), "") or "").strip() for c in DEFAULT_COLS}
        if row["word"] and row["uz"]:
            rows.append(row)
    return rows


def cloze(example: str, word: str) -> str | None:
    pat = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
    return pat.sub("___", example, count=1) if pat.search(example) else None


def pos_txt(r: dict) -> str:
    return f" ({r['pos']})" if r["pos"] else ""


def make_vocab(r: dict, rng: random.Random) -> dict:
    ask = rng.choice([f"{r['word']} so'zi haqida ayt.", f"{r['word']} nima degani?",
                      f"What does '{r['word']}' mean?", f"{r['word']} so'zining ma'nosi va misoli."])
    lines = [f"**{r['word']}**{pos_txt(r)}: {r['uz']}."]
    if r["definition_en"]:
        lines.append(f"**Definition:** {r['definition_en']}")
    if r["example_en"]:
        ex = f"**Misol:** {r['example_en']}"
        lines.append(ex + (f" ({r['example_uz']})" if r["example_uz"] else ""))
        c = cloze(r["example_en"], r["word"])
        if c:
            lines.append(f"\n**Mashq:** to'ldiring: {c} (Javob: {r['word']})")
    return dict(task="vocab", level="", source="own", user=ask, assistant="\n".join(lines))


def make_en_uz(r: dict, rng: random.Random) -> dict:
    ask = rng.choice([f"Tarjima qil: {r['word']}", f"{r['word']} o'zbekcha nima?"])
    return dict(task="translate", level="", source="own", user=ask,
                assistant=f"**{r['word']}**{pos_txt(r)}: {r['uz']}.")


def make_uz_en(r: dict, rng: random.Random) -> dict:
    ask = rng.choice([f"'{r['uz']}' inglizcha qanday aytiladi?", f"Inglizchaga tarjima qil: {r['uz']}"])
    ans = f"**{r['word']}**{pos_txt(r)}."
    if r["example_en"]:
        ans += f"\n\n**Misol:** {r['example_en']}"
    return dict(task="translate", level="", source="own", user=ask, assistant=ans)


def make_sentence(r: dict, rng: random.Random) -> dict:
    ask = rng.choice([f"Tarjima qil: {r['example_en']}", f"Bu gapni o'zbekchaga o'gir: {r['example_en']}"])
    return dict(task="translate", level="", source="own", user=ask,
                assistant=f"{r['example_uz']}\n\nMuhim so'z: **{r['word']}**{pos_txt(r)}: {r['uz']}.")


def make_exercise(group: list[dict]) -> dict | None:
    items = [(cloze(r["example_en"], r["word"]), r["word"]) for r in group if r["example_en"]]
    items = [(c, w) for c, w in items if c]
    if len(items) < 3:
        return None
    qs = "\n".join(f"{i}. {c}" for i, (c, _) in enumerate(items, 1))
    bank = ", ".join(sorted(w for _, w in items))
    ans = "\n".join(f"{i}. {w}" for i, (_, w) in enumerate(items, 1))
    return dict(task="exercises", level="", source="own",
                user=f"Shu so'zlar bilan {len(items)} ta bo'sh joyni to'ldirish mashqi tuz: {bank}",
                assistant=f"So'zlar bankidan foydalanib to'ldiring ({bank}):\n{qs}\n\n**Javoblar:**\n{ans}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out", default="dict_sft.jsonl")
    ap.add_argument("--map", nargs="*", default=[], help="standart=sizning_ustun")
    ap.add_argument("--max-per-type", type=int, default=0, help="har tur uchun yuqori chegara (0 = cheklovsiz)")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    colmap = dict(m.split("=", 1) for m in a.map)
    rng = random.Random(a.seed)
    rows = read_rows(a.input, colmap)

    # bir xil o'zbekcha tarjima bir nechta so'zda bo'lsa, uz->en savoli noaniq: o'sha qatorlarni uz->en dan chiqaramiz
    uz_count = collections.Counter(r["uz"].lower() for r in rows)
    out = []
    for r in rows:
        out.append(make_vocab(r, rng))
        out.append(make_en_uz(r, rng))
        if uz_count[r["uz"].lower()] == 1:
            out.append(make_uz_en(r, rng))
        if r["example_en"] and r["example_uz"]:
            out.append(make_sentence(r, rng))
    with_ex = [r for r in rows if r["example_en"]]
    rng.shuffle(with_ex)
    for i in range(0, len(with_ex) - 4, 5):
        ex = make_exercise(with_ex[i:i + 5])
        if ex:
            out.append(ex)

    if a.max_per_type:
        by = collections.defaultdict(list)
        for o in out:
            by[o["task"]].append(o)
        out = [o for lst in by.values() for o in rng.sample(lst, min(len(lst), a.max_per_type))]
    rng.shuffle(out)
    with open(a.out, "w", encoding="utf-8") as f:
        for o in out:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    print(f"{len(rows)} ta lug'at qatori -> {len(out)} ta namuna: {a.out}")
    print("tur bo'yicha:", dict(collections.Counter(o["task"] for o in out)))


if __name__ == "__main__":
    main()
