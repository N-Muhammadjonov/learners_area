# RIWI: o'z modelingizni o'qitish to'plami

Papkadagi fayllar:
- `system_prompt.txt` : RIWI shaxsiyati va qoidalari (trening va ishlatishda BIR XIL bo'lishi shart)
- `sft_sample.jsonl`  : 17 ta NAMUNA (format uchun, o'qitish uchun yetarli emas)
- `dict_to_sft.py`    : lug'at jadvalidan (CSV/JSONL) o'qitish namunalari yasaydi (format namunasi: `sample_dictionary.csv`)
- `prepare_data.py`   : tekshiradi, takrorlarni topadi, `train.jsonl`/`val.jsonl` yasaydi
- `train_unsloth.py`  : Kaggle/Colab'da LoRA o'qitish + GGUF eksport (GPU'da sinalmagan)
- `eval_set.jsonl`    : 50 ta baholash savoli (8 kategoriya)
- `run_eval.py`       : modelni shu savollarda sinaydi

## Tartib
1. **Baza modelni tanlang.** Qwen3-4B va Gemma 4 E4B ni (yoki xotira yetmasa kichigini) yuklab,
   `eval_set.jsonl` ni `run_eval.py` bilan FINE-TUNINGSIZ ishga tushiring. Natija yaxshiroq bo'lgan
   model bilan davom eting. Bu sizning boshlang'ich chizig'ingiz (baseline).
2. **Ma'lumot yig'ing.** `sft_sample.jsonl` formatida: o'z lug'at/darslaringiz, o'qituvchi yozgan
   javoblar, Tatoeba. Maqsad: avval 1 000, keyin 5 000+ sifatli namuna. Har qatorga `source` yozing.
   Claude/ChatGPT javoblarini ma'lumot qilishdan oldin ularning foydalanish shartlarini tekshiring.
   Lug'atdan: `python dict_to_sft.py lugat.csv --out dict_sft.jsonl --map word=... uz=...`, so'ng uni
   boshqa turdagi namunalar (tushuntirish, xato tuzatish) bilan birlashtiring: shablonli ma'lumotning o'zi yetmaydi.
3. `python prepare_data.py my_data.jsonl` -> `train.jsonl`, `val.jsonl`.
4. **O'qitish:** `train_unsloth.py` ni Kaggle/Colab'da ishga tushiring (skript boshidagi izohga qarang).
5. **Server:** GGUF ni Ollama'ga yuklang. Unsloth chiqarish papkasida `Modelfile` bo'lishi mumkin; yo'q bo'lsa:
       FROM ./model.gguf
       PARAMETER temperature 0.3
   (`SYSTEM` qatoriga `system_prompt.txt` mazmunini qo'ying; chat shabloni model bilan mos bo'lishi kerak.)
       ollama create riwi -f Modelfile
6. **Baholash:** `python run_eval.py --model riwi` va 1-qadamdagi baseline bilan solishtiring.
   Fine-tuned model baseline'dan yaxshi bo'lmasa, ma'lumotni yaxshilang, parametrni emas.
7. **Saytga ulash:** Ollama `http://localhost:11434/v1` da OpenAI-mos API beradi. Backend'ingizda shu
   manzilga `chat/completions` so'rovini yuboring, `system_prompt.txt` ni system xabar qiling va sayt
   bilimini (lug'at, darslar) `CONTEXT:` qismiga qidiruv orqali joylang (`prepare_data.build_user` formati).

## Cheklovlar
- `train_unsloth.py` va Ollama qadamlari bu yerda sinalmagan (GPU yo'q). `prepare_data.py` va `run_eval.py` sinalgan.
- `run_eval.py` kalit so'z bilan tekshiradi: "PASS" to'g'ri javob kafolati emas. Natijalarni qo'lda ham o'qing.
- Kichik model (1-4B) murakkab savollarda xato qiladi; o'zbekcha tushuntirish eng zaif joy bo'lishi mumkin.
