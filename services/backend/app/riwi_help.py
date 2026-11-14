"""Role-scoped, reviewed common questions across the application.

Suggestions contain stable server-owned IDs, never executable URLs or authority.
"""
import re
from functools import lru_cache
from .riwi_uzbek import normalize_query
from .riwi_capabilities import authorize_capability

ALL = ('student', 'teacher', 'admin', 'owner')
LEARNING = ('student', 'teacher', 'owner')


def group(key, aliases, roles, questions, uz, en, followups):
    return {'id': key, 'aliases': aliases, 'roles': roles, 'questions': questions,
        'answer': {'uz': uz, 'en': en}, 'followups': followups}


GROUPS = [
    group('mcq', ('mcq', 'multiple choice', 'kop variantli'), LEARNING,
        ('MCQ qanday ishlaydi?', 'How does MCQ work?'),
        'MCQ — berilgan variantlardan yo‘riqnomadagi miqdorda tanlash mashqi 🙂 Avval savolni, keyin tanlovlar orasidagi farqni o‘qing. Materialdan dalil topib, butun ma’no va inkorni solishtiring; so‘ng talab qilingan sonni belgilang. RIWI siz uchun variantni tanlamaydi. Masalan, “We considered cycling but chose walking”da tilga olingan va tanlangan faoliyat boshqa.',
        'MCQ asks you to select the number of options specified by the instruction 🙂 Read the stem, compare the choices, locate evidence and check the full meaning including negatives. Then select the required number yourself. In “We considered cycling but chose walking”, the mentioned and chosen activities differ.', (3, 4, 12)),
    group('reading', ('reading', 'tfng', 'ynng', 'true false', 'matching headings', 'matching information', 'oqish'), LEARNING,
        ('Reading mashqlarini qanday bajaraman?', 'How do I work through Reading exercises?'),
        'Reading’da avval mashq turi va yo‘riqnomani aniqlang. Savolning asosiy da’vosini toping, matndan dalil qidiring, so‘ng ma’no, cheklov va so‘z limitini solishtiring. Heading butun paragrafga mos bo‘lsin; True/False/Not Given’da dalil yo‘qligini qarama-qarshilik bilan aralashtirmang. Tayyor variantni aytish o‘rniga usulni alohida namuna bilan tushuntiraman.',
        'Identify the task type and instruction, locate the requested claim and compare it with passage evidence. Check qualifiers and word limits. A heading covers the paragraph; absence of evidence is not contradiction in True/False/Not Given. I teach the method using separate examples rather than choose your answer.', (31, 33, 46)),
    group('listening', ('listening', 'tinglash', 'flow chart', 'map listening'), LEARNING,
        ('Listening mashqlarini qanday bajaraman?', 'How do I work through Listening exercises?'),
        'Listening’da audio boshlanishidan oldin yo‘riqnoma, javob soni/so‘z chegarasi va kutilgan ma’lumot turini belgilang. Tinglayotganda asosiy farq va tuzatishlarni kuzating. O‘tgan savolda qolib ketmang. Yakunda ruxsat etilgan vaqtda imlo, birlik/ko‘plik va tanlovlar sonini tekshiring.',
        'Before playback, check the instruction, answer count/word limit and expected information type. Track distinctions and corrections while listening; do not remain stuck on a missed item. During permitted checking time, review spelling, plural endings and selection count.', (19, 24, 28)),
    group('article', ('article', 'articles', 'maqola'), LEARNING,
        ('Articles bilan qanday ishlayman?', 'How do I study an article?'),
        'Maqolaning mos darajasini tanlab, avval asosiy g‘oyani tushuning. Keyin paragraf vazifalari va yangi so‘zlarni tekshiring. Belgilangan so‘zdagi lug‘at oynasidan ma’no tanlab, Add to vocabulary bilan papkaga saqlang. Saqlash yodlash emas; keyin shu so‘z bilan mustaqil gap tuzing.',
        'Choose a suitable article level, understand the main idea, then examine paragraph functions and vocabulary. Use the word panel to check the relevant sense and Add to vocabulary to save it to a folder. Saving is not mastery; use the item independently afterwards.', (59, 60, 62)),
    group('grammar', ('grammar', 'grammatika', 'zamon', 'grammar lesson'), ALL,
        ('Grammar darslarini qanday ishlayman?', 'How do I use Grammar lessons?'),
        'Avval qoidaning ma’nosi va tuzilmasini o‘qing, uchta namunani solishtiring. So‘ng Tushunish → Mustahkamlash → Qo‘llash → Erkin qo‘llash bosqichlaridan o‘ting. Tanlashda dalil toping, tuzatishda sababni ayting, yozish/gapirishda o‘z fikringizni shu qolipga joylang. Mavzu yoki dars nomini yozsangiz qoidani tushuntiraman; mashq kalitini bermayman.',
        'Read the meaning and pattern, compare three examples, then move through Understanding, Consolidation, Application and Free application. Justify a selection, explain a correction and express your own meaning in production tasks. Give a topic or unit name for rule help; I do not provide the exercise key.', (111, 137, 197)),
    group('writing', ('writing', 'essay', 'insho', 'task 1', 'task 2'), LEARNING,
        ('Writing mashqini qanday boshlayman?', 'How do I start a Writing exercise?'),
        'Avval topshiriqning barcha talablarini ajrating. Task 1’da asosiy xususiyatlar va taqqoslashni, Task 2’da pozitsiya, sabab va misollarni rejalang. O‘z matningizni yozib, mazmun, bog‘lanish, lug‘at va grammatikani tekshiring. RIWI tayyor topshiriladigan javob o‘rniga rejalash va qoida usulini o‘rgatadi.',
        'Identify every requirement first. Plan key features/comparisons for Task 1 or a position, reasons and examples for Task 2. Write your own response and check content, coherence, vocabulary and grammar. RIWI teaches planning and rules rather than supply a ready-to-submit exercise answer.', (66, 77, 82)),
    group('speaking', ('speaking', 'gapirish', 'speak or die', 'ai speaking'), LEARNING,
        ('Speaking mashqlarini qanday bajaraman?', 'How do I practise Speaking?'),
        'Savolga bevosita javob bering, sabab va o‘zingizga tegishli misol bilan kengaytiring. Mikrofon ruxsati, recording va submitted holatlari alohida tekshiriladi. Yozuvni qayta tinglab bitta xato turini tanlang va javobni qayta ayting. Matnli chat talaffuzingizni eshitganini yoki rasmiy bandni tasdiqlamaydi.',
        'Answer directly and extend with a reason and your own example. Check microphone permission, recording and submission separately. Listen back, identify one error pattern and repeat the response. Text chat cannot establish your pronunciation or certify an official band.', (92, 95, 99)),
    group('partner', ('partner', 'sherik', 'call', 'qo‘ng‘iroq'), LEARNING,
        ('Speaking partner bilan qanday ishlayman?', 'How do I practise with a Speaking partner?'),
        'Find Partner’da filtr va mavjudlikni tekshiring, taklif yuboring va qabul qilinishini kuting. Suhbatda navbat bilan savol-javob qiling; yakundagi peer rating rasmiy imtihon bahosi emas. Nomaqbul muomalada callni tugatish va Report amallari alohida.',
        'Check filters and availability in Find Partner, send an invitation and wait for acceptance. Take turns asking and answering. A peer rating is not an official examiner score. Ending a call and reporting misconduct are separate actions.', (102, 104, 107)),
    group('vocabulary', ('vocabulary', 'vocab', 'lugat', 'dictionary', 'word family', 'collocation'), ALL,
        ('Vocabulary tizimi qanday ishlaydi?', 'How does Vocabulary work?'),
        'So‘zning aynan shu kontekstdagi ma’nosi va so‘z turkumini tanlang, keyin kerakli folderga saqlang. Revision’da tarjimasiz eslab toping, Games’da mashq qiling va o‘z gapingizda qo‘llang. Bir xil imlo boshqa sense bo‘lishi mumkin. Saqlash soni bilan mastered sonini tenglashtirmang.',
        'Choose the contextual sense and part of speech before saving to a folder. Retrieve it without translation in Revision, practise in Games and use it in your own sentence. Identical spelling can represent different senses. Saved items and mastered items are different counts.', (146, 158, 159)),
    group('retention', ('retention', 'eslab qolish', 'recall'), LEARNING,
        ('Retention qanday ishlaydi?', 'How does Retention work?'),
        'Matnni o‘qing, so‘ng yopiq matn bilan eslash bosqichini mustaqil bajaring. Asosiy g‘oya, sabab va tafsilotlarni xotiradan qaytaring; bilmaganini taxminiy fakt bilan to‘ldirmang. Ruxsatli reviewda xotirangizni matn bilan solishtiring. Faol recallning javoblarini RIWI ochib bermaydi.',
        'Read the text, then complete closed-text recall independently. Retrieve the main idea, reasons and details without inventing uncertain facts. Compare against the text during permitted review. RIWI does not reveal answers during active recall.', (64, 65, 46)),
    group('podcast', ('podcast', 'podkast', 'ted', 'transcript'), LEARNING,
        ('Podcast yoki TED bilan qanday mashq qilaman?', 'How do I practise with Podcasts or TED?'),
        'Avval qisqa bo‘lakni transkriptsiz tinglab asosiy fikrni ayting. Keyin mavjud ruxsatli transkript bilan eshitilmagan joyni tekshiring. Qisqa iborani takrorlab, yangi so‘zning kontekstini lug‘atdan aniqlang. Faqat playerni ochiq qoldirish tushunish yoki reward dalili emas.',
        'Listen to a short section without the transcript and state its main idea. Then use an available permitted transcript to check missed parts. Repeat a short phrase and verify vocabulary in context. An open player alone does not prove comprehension or a reward.', (27, 29, 184)),
    group('stealing', ('language stealing', 'qolip banki'), LEARNING,
        ('Language Stealing qanday ishlatiladi?', 'How do I use Language Stealing?'),
        'Qolipning vazifasini toping: sabab, fikr yoki taqqoslashmi? O‘zgaruvchan qismlarni belgilab, o‘z mavzuingizga moslang. Yangi gapning ma’nosi va grammatikasini tekshiring. Tayyor matnni ko‘chirib topshirish o‘rniga tuzilmani o‘z fikringiz bilan qo‘llang.',
        'Identify the pattern’s function: reason, opinion or comparison. Mark variable slots and adapt them to your own topic. Check the resulting meaning and grammar. Reuse the structure with your ideas rather than copy a complete answer for submission.', (139, 140, 162)),
    group('plan', ('study plan', 'reja', 'placement', 'diagnostic', 'daraja testi'), LEARNING,
        ('Study plan bilan qanday ishlayman?', 'How do I use a Study Plan?'),
        'Maqsad va real kunlik vaqtingizga mos reja tanlang. Vazifa havolasini ochish bilan mashqni tugatish bir xil emas. Completed holatini tekshirib, qiyin joyga kichik takrorlash qo‘shing. Qisqa placement natijasi umumiy til sertifikati emas.',
        'Choose a plan fitting your goal and actual daily time. Opening a task link differs from completing its exercise. Check completion and add short review for difficult points. A short placement result is not a full language certificate.', (166, 169, 175)),
    group('mock', ('mock', 'imtihon'), LEARNING,
        ('Mock test jarayoni qanday ishlaydi?', 'How does a Mock test work?'),
        'Ko‘rsatma va vaqtni o‘qing, urinishni mustaqil bajaring, so‘ng topshirilgan holatni tekshiring. Submitted bilan barcha skilllar graded bo‘lishi farq qiladi. Faol imtihonda javob kaliti yoki materialdan yechimni bermayman; usulni alohida namuna bilan ko‘rsataman.',
        'Read the instructions and timing, complete the attempt independently and confirm submission. Submitted differs from all skills being graded. I do not provide active-exam keys or look up solutions; I can illustrate the method separately.', (176, 178, 179)),
    group('progress', ('progress', 'natijalarim', 'rivojlanishim'), LEARNING,
        ('Progress natijalarini qanday tushunaman?', 'How do I interpret Progress?'),
        'Bir xil sana va skillni tanlab, bajarilgan faoliyat, to‘g‘ri javob ulushi va vaqtni birga solishtiring. Plan tayinlangan ishni, Progress qayd etilgan natijani ko‘rsatadi. Boshqa foydalanuvchining shaxsiy natijasi chat orqali ochilmaydi.',
        'Compare the same date range and skill using recorded activity, accuracy and time. A plan lists assignments; Progress records outcomes. This chat does not reveal another user’s private results.', (168, 175, 177)),
    group('coins', ('coin', 'tanga', 'reward', 'leaderboard', 'market'), LEARNING,
        ('Coin va reward qanday tekshiriladi?', 'How do I check Coins and rewards?'),
        'Reward uchun tegishli faoliyat serverda tasdiqlanishi kerak; shunchaki ochish yoki chatda da’vo qilish yetmaydi. Wallet va activity statusni solishtiring. Takroriy ayni hodisa qayta tanga bermaydi. Xaridni tasdiqlashdan oldin narx va balansni o‘zingiz tekshiring.',
        'A reward requires eligible server-verified activity, not just opening a page or claiming completion. Compare the wallet and activity status. Repeating the same event does not pay again. Check price and balance yourself before a purchase.', (182, 183, 189)),
    group('chat', ('riwi', 'chat', 'suhbat', 'fayl', 'file', 'pdf', 'docx'), ALL,
        ('RIWI chatini qanday ishlataman?', 'How do I use RIWI chat?'),
        'Savolingizni o‘zbekcha yoki inglizcha yozing. Javob tili kelgusi javoblar uchun alohida menyuda tanlanadi. + faylni biriktiradi, / buyruqlarni ochadi; New Chat kontekstni yangidan boshlaydi. RIWI qoidaviy yordamchi: bilmaganini fakt deb bermaydi va saytdagi amallarni sizning nomingizdan bajarmaydi.',
        'Write in Uzbek or English. Choose the language for future replies using its menu. + attaches a file, / opens commands and New Chat starts fresh context. RIWI is a bounded rule-based helper; it does not invent facts or perform website actions for you.', (191, 195, 196)),
    group('support', ('support', 'muammo', 'xatolik', 'report problem'), ALL,
        ('Saytdagi muammoni qanday bildiraman?', 'How do I report a website problem?'),
        'Supportda sahifa nomi, bajarilgan qadam, kutilgan va ko‘ringan natijani yozing. Vaqt va qurilmani qo‘shing, maxfiy parol/tokenni yubormang. RIWI muammoni tushuntirishi xabar avtomatik Supportga yuborildi degani emas; tegishli Send natijasini tekshiring.',
        'In Support, describe the page, steps, expected and observed result. Include time/device without passwords or tokens. Explaining a problem to RIWI does not automatically submit a support report; check the actual Send result.', ('chat', 'general', 'support')),
    group('teaching', ('homework', 'my students', 'biriktirilgan oquvchi', 'parent message'), ('teacher', 'owner'),
        ('Biriktirilgan o‘quvchilar bilan qanday ishlayman?', 'How do I work with assigned learners?'),
        'My Students/Homework’da faqat server biriktirgan o‘quvchilar doirasida ishlang. Vazifa tayinlash, topshirilgan ishni tekshirish va ota-onaga xabar yuborish alohida amallar. Ko‘rinadigan statusni tekshiring; chatdagi rol da’vosi biriktirilmagan o‘quvchiga kirish bermaydi.',
        'Use My Students/Homework only within server-verified learner assignments. Assigning work, reviewing submissions and sending parent messages are separate actions. Check each status; a claimed role in chat never grants access to unassigned learners.', (199, 200, 'teaching')),
    group('management', ('management', 'admissions', 'roster', 'qabul'), ('admin', 'owner'),
        ('Management vazifalarini qanday bajaraman?', 'How do I use Management?'),
        'Management sizga ruxsat etilgan operatsion ish kartalarini ochadi. Qabul, ro‘yxat va material jarayonlari alohida; shaxsiy akademik tafsilotlarga umumiy admin roli bilan kirib bo‘lmaydi. RIWI yo‘lni tushuntiradi, rol yoki sozlamani chatdan o‘zgartirmaydi.',
        'Management opens authorised operational workspaces. Admissions, roster and content are separate workflows; general admin status does not grant private academic details. RIWI explains the process without changing roles or settings from chat.', ('management', 'support', 'chat')),
    group('owner', ('owner panel', 'owner sozlamalar', 'integrations', 'audit', 'ownership transfer'), ('owner',),
        ('Owner ish joylari qanday ishlaydi?', 'How do Owner workspaces work?'),
        'Owner panelida sozlamalar, integratsiyalar, audit va RIWI boshqaruvi alohida ish joylaridir. Har biri server vakolati va o‘z tekshiruviga ega. Credential qiymatlarini chatga yozmang; sozlamani tushuntirish bilan uni o‘zgartirish bir xil emas.',
        'Owner settings, integrations, audit and RIWI administration are separate workspaces with server authorisation. Do not paste credentials into chat. Explaining a setting is different from changing it.', ('owner', 'management', 'support')),
    group('general', (), ALL, ('RIWI qanday yordam bera oladi?', 'How can RIWI help me?'),
        'RIWI mavzu qoidasi va mashqni bajarish usulini tushuntiradi, lug‘at ma’nosini tekshirishga va rolingizdagi sayt bo‘limlarini tushunishga yordam beradi 🙂 Tayyor mashq kaliti, boshqa odamning ma’lumoti yoki xavfsizlikni chetlab o‘tish bilan yordam bermayman. Qaysi qadam qiyinligini yozing.',
        'RIWI explains rules and exercise methods, helps check word senses and guides you through sections available to your role 🙂 It does not provide exercise keys, another person’s private data or security bypasses. Tell me which step is difficult.', ('chat', 'support', 'general')),
]
GROUPS += [
    group('speaking-grammar', ('grammar for speaking', 'speaking grammar'), ALL,
        ('Grammar for Speaking qanday ishlatiladi?', 'How do I use Grammar for Speaking?'),
        'Speaking tabida kerakli qolip darsini tanlang. Qolipning muloqot vazifasini tushuning, namunalarni solishtiring, so‘ng o‘z hayotingizdan javob ayting. To‘rtta bosqichda tanishdan erkin qo‘llashga o‘tiladi. Dars nomini yozsangiz qoidani uch namuna bilan tushuntiraman; mashq javobini bermayman.',
        'Choose a pattern in the Speaking tab. Identify its communicative function, compare examples and speak about your own experience. Four stages move from recognition to free use. Give a unit name for a rule and three examples, rather than an exercise key.', ('speaking-grammar', 'grammar', 'chat')),
    group('writing-grammar', ('grammar for writing', 'writing grammar'), ALL,
        ('Grammar for Writing qanday ishlatiladi?', 'How do I use Grammar for Writing?'),
        'Writing tabida mos guruh va darsni tanlang. Formula nimani ifodalashini tushunib, misollardagi o‘zgaruvchan qismlarni aniqlang. Mashqlarda o‘z gapingizni yozing, keyin fikr va grammatikani tekshiring. Academic diagramma bo‘lsa raqam va birlikni saqlang; misoldagi faktni o‘z diagrammangizga ko‘chirmang.',
        'Choose a group and unit in the Writing tab. Understand the formula’s function and its variable slots. Produce your own sentences, then check meaning and grammar. For an academic diagram, preserve its actual numbers and units instead of copying an example’s facts.', ('writing-grammar', 'grammar', 'chat')),
    group('course', ('ielts course', 'kurs', 'courses', 'lessons', 'video lessons'), ALL,
        ('Kurs va darslarni qanday ochaman?', 'How do I open courses and lessons?'),
        'Kurs yoki Lessons ro‘yxatidan o‘zingizga ochiq darsni tanlang. Tavsif va materialni o‘qing, so‘ng ko‘rsatilgan mashqni mustaqil bajaring. Dars ochilishi, progress saqlanishi va tugallanishi alohida holat. Yopiq kursga chatdagi iltimos ruxsat bermaydi.',
        'Choose an available lesson from the course or Lessons catalogue. Read its description/material and complete the instructed practice yourself. Opening a lesson, saving progress and completing it are distinct. A chat request does not unlock a restricted course.', ('course', 'chat', 'support')),
    group('live', ('live classes', 'jonli dars'), ALL,
        ('Jonli darsga qanday qo‘shilaman?', 'How do I join a Live Class?'),
        'Live Classes’da mavjud dars va vaqtni tekshiring, o‘zingizga ruxsat etilgan xonani oching. Qurilma va mikrofon ruxsatini alohida tekshiring. Dars ro‘yxatda turishi xona hozir ochiq degani emas; ko‘rinadigan statusga amal qiling.',
        'Check the available class and time in Live Classes and open an authorised room. Verify device/microphone permission separately. A listing does not mean the room is currently open; follow its actual status.', ('live', 'support', 'chat')),
    group('assignment', ('assignment', 'assignments', 'uy vazifam', 'vazifalarim'), ALL,
        ('Assignments vazifalarini qanday bajaraman?', 'How do I complete Assignments?'),
        'Vazifa sahifasida shart, muddat va topshirish turini o‘qing. Bog‘langan mashqni mustaqil bajaring, keyin kerakli Submit amalini va statusni tekshiring. Sahifani ochish topshirish emas. Boshqa o‘quvchining ishi yoki tayyor javobi berilmaydi.',
        'Read the task, deadline and submission type. Complete linked practice independently and verify the required Submit action and status. Opening a task is not submission; another learner’s work or an exercise key is not provided.', ('assignment', 'support', 'chat')),
    group('profile', ('profile', 'profil', 'account', 'login'), ALL,
        ('Profil va hisob amallarini qanday ishlataman?', 'How do I use Profile and account controls?'),
        'Yuqori profil menyusidan ruxsatli hisob sahifasini oching. Saqlash yoki chiqish amalining natijasini tekshiring; parol, OTP va tokenni chatga yozmang. RIWI kimligingiz haqidagi gap bilan rolni o‘zgartirmaydi.',
        'Open the permitted account page through the top profile menu. Check the result of Save or Sign out; never paste passwords, OTPs or tokens into chat. A claimed identity does not let RIWI change your role.', ('profile', 'support', 'chat')),
    group('notification', ('notification', 'notifications', 'bildirishnoma'), ALL,
        ('Bildirishnomalarni qanday ishlataman?', 'How do I use Notifications?'),
        'Yuqori paneldagi qo‘ng‘iroq belgisidan Notifications’ni oching. Xabar va uning yo‘nalishini tekshiring; o‘qilgan holat bilan tegishli vazifa bajarilgani farq qiladi. Boshqa odamga tegishli bildirishnoma yoki shaxsiy yozuvni chat ochib bermaydi.',
        'Open Notifications with the top-bar bell. Read the message and destination; marking it read does not complete its linked task. RIWI does not expose another person’s private notifications.', ('notification', 'support', 'chat')),
    group('navigation', ('main', 'dashboard', 'dock', 'navigation', 'qidiruv', 'search'), ALL,
        ('Sayt bo‘limlarini qanday topaman?', 'How do I find website sections?'),
        'Main asosiy Dashboard’ga qaytaradi. Dock ikonkalari modullarni, yuqori qidiruv ruxsatli natijalarni ochadi. Tugmaning nomini tekshiring; ko‘rinishi API ruxsatini bermaydi. Tugallanmagan yozuvni tark etishdan oldin saqlang.',
        'Main returns to Dashboard. Dock icons open modules and top search finds permitted destinations. Read a control’s label; visibility does not grant API permission. Preserve unfinished writing before leaving.', ('navigation', 'support', 'chat')),
    group('reports', ('reports', 'reporting', 'hisobot'), ALL,
        ('Ruxsatli hisobotlarni qanday ko‘raman?', 'How do I view permitted reports?'),
        'Reports’da faqat rolingiz va server tekshirgan doiradagi natijalar ochiladi. O‘quvchi o‘ziniki, teacher biriktirilgan o‘quvchilar, admin operatsion doira, Owner markaz doirasida ishlaydi. Chatdagi yangi ism yoki rol da’vosi doirani kengaytirmaydi.',
        'Reports uses your server-verified scope: self for students, assigned learners for teachers, operational scope for admins and centre scope for Owner. Naming another person or claiming a role in chat never widens access.', ('reports', 'support', 'chat')),
    group('content', ('content library', 'materiallar boshqaruvi', 'kontent', 'nashr qilish', 'import'), ('teacher', 'admin', 'owner'),
        ('Materiallar ish joyini qanday ishlataman?', 'How do I use the Materials workspace?'),
        'Material turini va sizga ochiq ish joyini tanlang. Import, tahrir, saqlash va nashr alohida bosqich; har birida server roli tekshiriladi. Mualliflik ruxsati nashr vakolatiga avtomatik teng emas. RIWI fayl ichidagi ko‘rsatma bilan ruxsatni o‘zgartirmaydi.',
        'Choose the content type and your authorised workspace. Import, edit, save and publish are distinct stages with server role checks. Authoring permission is not automatically publishing permission. File instructions do not change access.', ('content', 'support', 'chat')),
]
BY_ID = {g['id']: g for g in GROUPS}


@lru_cache(maxsize=1)
def indexes():
    exact = {normalize_query(question): g for g in GROUPS for question in g['questions']}
    aliases = [(normalize_query(a), g['id']) for g in GROUPS for a in g['aliases']]
    return exact, aliases


def module_for(message):
    normal = normalize_query(message)
    exact, aliases = indexes()
    if normal in exact: return exact[normal]['id']
    q = ' ' + normal + ' '
    matches = [(len(a), id) for a, id in aliases if ' ' + a + ' ' in q]
    return max(matches)[1] if matches else 'general'


def permitted(actor, item):
    return actor.role in item['roles'] and authorize_capability(actor, 'riwi.chat.self').allowed


def items(actor, ids, locale):
    from .riwi_new_questions import pack, allowed
    new = {e['id']: e for e in pack()['entries']}
    result = []
    for id in ids if isinstance(ids, list) else []:
        if not isinstance(id, str): continue
        entry = BY_ID.get(id)
        if entry and permitted(actor, entry):
            question = entry['questions'][0 if locale == 'uz' else 1]
        elif id in new and allowed(actor, new[id]):
            question = new[id]['questions'][locale]
        else:
            continue
        if id not in [x['id'] for x in result]: result.append({'id': id, 'question': question})
        if len(result) == 3: break
    return result


def suggestions(actor, message, locale):
    selected = BY_ID[module_for(message)]
    if not permitted(actor, selected): return []
    ids = [('RIWI-NEW-' + str(x).zfill(3)) if isinstance(x, int) else x for x in selected['followups']]
    ids += [selected['id'], 'grammar', 'chat', 'support', 'general']
    return items(actor, ids, locale)[:3]


def reply(actor, message, locale):
    q = normalize_query(message)
    entry = indexes()[0].get(q)
    if not entry:
        # Closed conversational wrappers permit dialect around a module keyword.
        module = module_for(message)
        if module == 'general': return None
        aliases = BY_ID[module]['aliases']
        rest = q
        for alias in sorted(aliases, key=len, reverse=True):
            rest = re.sub(r'(?<!\w)' + re.escape(normalize_query(alias)) + r'(?!\w)', '', rest)
        controls = {'qanday','qanaqa','nima','bu','qilib','ishlaydi','ishlidi','ishlashi','ishlayman','ishlatiladi','ishlataman','tushuntir','tizimi','tizim','system','test','testlar','dars','darslari','mashq','mashqlar','how','does','do','work','works','use','i','it','the','a','is','what','menga','iltimos','please'}
        if set(rest.split()) - controls: return None
        entry = BY_ID[module]
    ok = permitted(actor, entry)
    return {'answer': entry['answer'][locale] if ok else (
        'Bu bo‘lim rolingiz vazifalari doirasiga kirmaydi. O‘zingizga ruxsat etilgan bo‘limni tanlang.' if locale == 'uz' else
        'That workflow is outside your role. Choose a section available to your account.'),
        'provenance': 'deterministic_learning_data' if ok else 'policy_refusal', 'citations': [],
        'provider': {'id': 'riwi', 'model': 'riwi-help-v1', 'helpId': entry['id']}}


def fallback(actor, message, locale):
    choices = suggestions(actor, message, locale)
    if not choices:
        return {'answer': 'Bu bo‘lim rolingiz vazifalari doirasiga kirmaydi.' if locale == 'uz' else 'That workflow is outside your role.',
            'provenance': 'policy_refusal', 'citations': [], 'provider': {'id': 'riwi', 'model': 'riwi-help-v1'}}
    return {'answer': ('Bilimlarim orasidan bu savolga ishonchli mos javob topa olmadim 🤔\n\nUzur savolingizni tushunmadim quyidagi 3 ta variantdan birini tanlashingiz mumkin.' if locale == 'uz' else
        'I could not find a reliable answer to this question 🤔\n\nSorry, I did not understand your question. You can choose one of these three questions.'),
        'provenance': 'unavailable', 'citations': [], 'questionSuggestions': choices,
        'provider': {'id': 'riwi', 'model': 'riwi-help-v1', 'suggestionIds': [x['id'] for x in choices], 'suggestionLocale': locale}}


def navigation(actor, message, provider):
    module = provider.get('helpId') or module_for(message)
    if provider.get('model') == 'riwi-site-grammar-v1': module = 'grammar'
    routes = {
        'mcq': ('/app/listening/mcq', 'MCQ'), 'reading': ('/app/reading', 'Reading'),
        'listening': ('/app/listening', 'Listening'), 'article': ('/app/reading/articles', 'Articles'),
        'grammar': ('/app/grammar', 'Grammar'), 'speaking-grammar': ('/app/grammar', 'Grammar'),
        'writing-grammar': ('/app/grammar', 'Grammar'), 'writing': ('/app/writing', 'Writing'),
        'speaking': ('/app/speaking', 'Speaking'), 'partner': ('/app/speaking/live-partner', 'Find Partner'),
        'vocabulary': ('/app/vocabulary', 'Vocabulary'), 'retention': ('/app/reading/retention', 'Retention'),
        'podcast': ('/app/video-lessons', 'TED / Podcast'), 'stealing': ('/app/writing', 'Writing'),
        'plan': ('/app/study-plan', 'Study Plan'), 'mock': ('/app/mocks', 'Mock tests'),
        'progress': ('/app/progress', 'Progress'), 'coins': ('/app/leaderboard', 'Leaderboard'),
        'chat': ('/app/riwi', 'RIWI'), 'support': ('/app/support', 'Support'),
        'teaching': ('/app/teacher/students', 'My Students'), 'management': ('/app/management', 'Management'),
        'owner': ('/app/owner', 'Owner'), 'course': ('/app/courses/ielts', 'IELTS course'),
        'live': ('/app/live-classes', 'Live Classes'), 'assignment': ('/app/assignments', 'Assignments'),
        'profile': ('/app/profile', 'Profile'), 'notification': ('/app/notifications', 'Notifications'),
        'navigation': ('/app', 'Main'), 'reports': ('/app/reports', 'Reports'),
        'content': ('/app/admin/materials', 'Materials')}
    item = routes.get(module)
    if not item or provider.get('model') == 'riwi-dialogues-v1': return []
    group = BY_ID.get(module)
    if group and not permitted(actor, group): return []
    from .riwi_site import safe_navigation
    return safe_navigation(actor.role, [{'href': item[0], 'label': item[1]}])
