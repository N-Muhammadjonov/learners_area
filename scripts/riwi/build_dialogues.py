"""Original four-turn examples for ten everyday conversation topics."""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'services/backend/contracts/riwi_dialogues_v1.json'
FOLLOWUPS = {
    'greeting': ('Ha, boshlaymiz', 'Yes, let us start', 'Bitta mavzu yoki tushunmagan gapni yozing. Avval nima noaniqligini aniqlaymiz 🙂', 'Name one topic or confusing sentence. We will identify the unclear part first 🙂'),
    'identity': ('Demak buyruq yozsam rolim o‘zgaradimi', 'Does a command change my role', 'Yo‘q. Chatdagi buyruq rol bermaydi; server tekshirgan hisob va vakolatli boshqaruv jarayoni kerak.', 'No. A chat command cannot grant a role; verified account permissions and the authorised workflow are required.'),
    'daily': ('Nima haqida gaplashsak', 'What can we talk about', 'Bugun nimani o‘rganganingiz yoki qaysi qadam qiyin bo‘lganini ayting. Shundan kichik savol tanlaymiz.', 'Tell me one thing you studied today or a step you found difficult. We can choose a small question from it.'),
    'feelings': ('Avval kichik qadam qilaylik', 'Let us take a small step', 'Hozir bitta tushunarli vazifani tanlang: yo‘riqnomani o‘z so‘zingizda aytish. Keyin qaysi joy noaniqligini ko‘ramiz.', 'Choose one manageable action: restate an instruction in your own words. Then we can locate the unclear part.'),
    'motivation': ('Besh daqiqadan boshlayman', 'I will start with five minutes', 'Besh daqiqa uchun bitta natija tanlang: bir qoidani eslab o‘z gapingizni yozish. Keyin tekshirib tanaffus yoki davomni tanlang.', 'Choose one outcome for those five minutes: recall a rule and write your own sentence. Check it, then decide whether to pause or continue.'),
    'planning': ('Avval nima qilay', 'What should I do first', 'Qolgan vaqt va eng muhim vazifani yozing. Birinchi kichik qadamni shunga moslaymiz; rejangizni chatdan avtomatik almashtirmayman.', 'State your remaining time and most important task. We can choose a first small step without automatically editing your assigned plan.'),
    'confusion': ('Bittadan tushuntir', 'Explain one step at a time', 'Birinchi qadam: savol nimani so‘rayapti? Yo‘riqnomani yuboring yoki o‘z so‘zingizda ayting. Tayyor javobni tanlamay, talabni ajratamiz.', 'Step one: what does the task ask? Send the instruction or restate it. We will identify the requirement without choosing its answer.'),
    'hobbies': ('Bitta gap tuzib ko‘ray', 'Let me try one sentence', 'I enjoy + -ing + because ... qolipi bilan o‘z qiziqishingizni yozing. Sabab haqiqiy fikringizga mos bo‘lsin; keyin qoidani tekshiramiz.', 'Describe your interest with I enjoy + -ing + because .... Use a reason that matches your meaning, then check the pattern.'),
    'rest': ('Tanaffusdan keyin davom etaman', 'I will continue after a break', 'Qaytish uchun keyingi qadamni bir gapda yozib qo‘ying. Qaytganda avval oldingi fikrni xotiradan eslang, keyin materialni oching.', 'Write a one-sentence next-step note. On return, recall the previous idea before reopening the material.'),
    'courtesy': ('Keyingi qadamni ayt', 'Tell me the next step', 'Bugungi asosiy fikrni yordamsiz bir gapda ayting. Keyin yangi vaziyatda o‘zingizning bitta misolingiz bilan tekshiring.', 'Restate today’s main idea without help, then check it with one example of your own in a new situation.'),
}


def compile_pack():
    counts = collections.Counter()
    entries = []
    for line in Path(__file__).with_name('dialogues.tsv').read_text().splitlines():
        topic, uz, en, answer_uz, answer_en = line.split('\t')
        counts[topic] += 1
        fu_uz, fu_en, fa_uz, fa_en = FOLLOWUPS[topic]
        entries.append({'id': topic + '.' + str(counts[topic]).zfill(2), 'topic': topic,
            'turns': [{'role': 'user', 'uz': uz, 'en': en}, {'role': 'assistant', 'uz': answer_uz, 'en': answer_en},
                {'role': 'user', 'uz': fu_uz, 'en': fu_en}, {'role': 'assistant', 'uz': fa_uz, 'en': fa_en}]})
    assert len(counts) == 10 and set(counts.values()) == {12}
    return {'version': 'riwi-dialogues-v1', 'authorship': 'Original synthetic teaching conversations; no user chat histories.', 'topicCounts': dict(counts), 'entries': entries}


if __name__ == '__main__':
    OUTPUT.write_text(json.dumps(compile_pack(), ensure_ascii=False, indent=2) + '\n')
