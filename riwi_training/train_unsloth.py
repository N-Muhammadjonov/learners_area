"""RIWI: ochiq modelni LoRA/QLoRA bilan o'qitish (Kaggle yoki Colab, bepul GPU).

DIQQAT: bu skript GPU'siz muhitda yozilgan va ISHGA TUSHIRIB SINALMAGAN.
Unsloth/TRL/transformers versiyalari tez o'zgaradi: xato chiqsa, Unsloth'ning
o'sha model uchun rasmiy notebook'idagi chaqiruvlar bilan solishtiring.

Kaggle'da:
  1) Notebook -> Settings -> Accelerator: GPU (T4 x2 yoki P100), Internet: On
  2) train.jsonl va val.jsonl ni Kaggle Dataset qilib yuklang (yo'lni DATA_DIR ga yozing)
  3) Birinchi katakda:  !pip install -q unsloth
  4) Quyidagi muhit o'zgaruvchisini qo'ying va skriptni ishga tushiring:
        BASE_MODEL = Unsloth model katalogidan olingan nom (4-bit versiyasi)
"""
import os

from unsloth import FastLanguageModel, is_bfloat16_supported  # trl/transformers'dan OLDIN import qilinsin

from datasets import load_dataset
from trl import SFTConfig, SFTTrainer

BASE_MODEL = os.environ.get("BASE_MODEL")  # masalan Qwen3-4B yoki Gemma 4 E4B ning Unsloth 4-bit nomi
DATA_DIR = os.environ.get("DATA_DIR", ".")
OUT_DIR = os.environ.get("OUT_DIR", "riwi_out")
MAX_SEQ = int(os.environ.get("MAX_SEQ", "2048"))
EPOCHS = float(os.environ.get("EPOCHS", "2"))

if not BASE_MODEL:
    raise SystemExit("BASE_MODEL o'rnatilmagan (Unsloth katalogidan 4-bit model nomini oling).")

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=BASE_MODEL, max_seq_length=MAX_SEQ, load_in_4bit=True,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16, lora_alpha=16, lora_dropout=0, bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth", random_state=3407,
)

data = load_dataset("json", data_files={
    "train": os.path.join(DATA_DIR, "train.jsonl"),
    "validation": os.path.join(DATA_DIR, "val.jsonl"),
})


def to_text(ex):
    # enable_thinking faqat Qwen3 shabloniga tegishli; boshqa modellarda e'tiborsiz qoldiriladi
    return {"text": tokenizer.apply_chat_template(
        ex["messages"], tokenize=False, add_generation_prompt=False, enable_thinking=False)}


data = data.map(to_text, remove_columns=data["train"].column_names)
print(data["train"][0]["text"][:800])  # shablon to'g'ri qo'llanganini ko'zdan kechiring

trainer = SFTTrainer(
    model=model, tokenizer=tokenizer,
    train_dataset=data["train"], eval_dataset=data["validation"],
    args=SFTConfig(
        dataset_text_field="text", max_seq_length=MAX_SEQ,   # yangi TRL'da max_length deb nomlanishi mumkin
        per_device_train_batch_size=2, gradient_accumulation_steps=8,
        num_train_epochs=EPOCHS, learning_rate=2e-4, lr_scheduler_type="linear",
        warmup_ratio=0.05, weight_decay=0.01, optim="adamw_8bit",
        fp16=not is_bfloat16_supported(), bf16=is_bfloat16_supported(),
        logging_steps=10, eval_strategy="steps", eval_steps=50,
        seed=3407, output_dir=OUT_DIR, report_to="none",
    ),
)
trainer.train()

model.save_pretrained(f"{OUT_DIR}/lora")
tokenizer.save_pretrained(f"{OUT_DIR}/lora")
try:  # Ollama/llama.cpp uchun GGUF
    model.save_pretrained_gguf(f"{OUT_DIR}/gguf", tokenizer, quantization_method="q4_k_m")
except Exception as e:  # noqa: BLE001
    print("GGUF eksport xatosi (LoRA saqlandi, keyin alohida eksport qiling):", e)
