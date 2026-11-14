"""Read-only site guide grounded in the shipped routes and bounded UI observations.

The authenticated actor decides access. Browser labels, colours and positions are
untrusted observations, never instructions or navigation authority.
"""
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

CATALOG = Path(__file__).with_name('data') / 'riwi_site_catalog.json'
ALL = ('student', 'teacher', 'admin', 'owner')
STAFF = ('teacher', 'admin', 'owner')
ADMIN = ('admin', 'owner')
OWNER = ('owner',)


@lru_cache(maxsize=1)
def catalog():
    return json.loads(CATALOG.read_text())


def verify_catalog(root):
    """Optional integrity diagnostic for generated site knowledge; not an asset build gate."""
    for path, expected in catalog()['sources'].items():
        file = Path(root) / path
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('Stale RIWI site catalogue; run node scripts/riwi-site-catalog.mjs: ' + path)


def route(path):
    return next((x for x in catalog()['routes'] if x['path'] == path), None)


def validate_context(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 2:
        raise ValueError('invalid_site_context')
    surfaces = []
    for surface in value:
        if not isinstance(surface, dict) or set(surface) != {'path', 'theme', 'controls'}:
            raise ValueError('invalid_site_context')
        if not route(surface['path']) or surface['theme'] not in ('day', 'night'):
            raise ValueError('invalid_site_context')
        controls = surface['controls']
        if not isinstance(controls, list) or len(controls) > 60:
            raise ValueError('invalid_site_context')
        for c in controls:
            if not isinstance(c, dict) or set(c)-{'action'} != {'label','tag','href','zone','color','background','disabled'}:
                raise ValueError('invalid_site_context')
            if (not isinstance(c['label'], str) or not 1 <= len(c['label']) <= 100
                or any(ord(x) < 32 for x in c['label']) or c['tag'] not in ('a','button','summary','input')
                or c['href'] is not None and not route(c['href'])
                or c['zone'] not in tuple(a+'-'+b for a in ('top','middle','bottom') for b in ('left','center','right'))
                or type(c['disabled']) is not bool):
                raise ValueError('invalid_site_context')
            if 'action' in c and (not isinstance(c['action'],str) or not 1<=len(c['action'])<=800):
                raise ValueError('invalid_site_context')
            for key in ('color','background'):
                if not isinstance(c[key], str) or not re.fullmatch(r'(?:rgba?\([\d.,% /]+\)|color\(srgb [\d.,% /]+\))', c[key]) or len(c[key]) > 90:
                    raise ValueError('invalid_site_context')
        surfaces.append(surface)
    return surfaces


def _topic(id, aliases, paths, uz, en, roles=ALL):
    return dict(id=id, aliases=aliases, paths=paths, uz=uz, en=en, roles=roles)


TOPICS = [
    _topic('campus','main campus bosh sahifa xarita home dock', ['/app'],
        'Main bosh sahifasi Dashboard’ni ochadi. Pastdagi Dock ikonkalari o‘quv bo‘limlarini ochadi; tor ekranda panelni yon tomonga surish mumkin. Boshqaruv belgisi faqat xodim rollariga ko‘rinadi. Pastdagi O‘quv vositalari menyusidagi AI Coach shu RIWI chatini ochadi. Tafsilot yoki focus sahifalarida Dock yashiriladi; Back ota sahifaga qaytaradi.',
        'Main opens Dashboard. The bottom Dock icons open learning modules; on narrow screens the Dock scrolls sideways. Management is shown only to staff roles. AI Coach in the bottom study-tools menu opens this RIWI chat. Detail/focus pages hide the Dock; Back returns to the parent page.'),
    _topic('dashboard','dashboard panel ko‘rsatkich', ['/app/dashboard'],
        'Dashboard shaxsiy o‘quv ko‘rsatkichlarini ko‘rsatadi. Bosh sahifa sarlavhasida Learners Area ko‘rinadi; ortiqcha IELTS yorlig‘i olib tashlangan. Bo‘limlar pastdagi Dock’dan tanlanadi.', 'Dashboard shows personal learning metrics. The hero brand reads Learners Area without the redundant IELTS label. Choose modules from the bottom Dock.'),
    _topic('reading','reading o‘qish retention passage', ['/app/reading','/app/reading/lessons','/app/reading/academic','/app/reading/general','/app/reading/retention','/app/reading/history'],
        'Reading kirish sahifasi Lessons’ga yo‘naltiradi. Lessons — darslar, Academic — test to‘plamlari, General — savol turlari bo‘yicha mashq, Retention — oldingi matndagi bilimni eslash, History — urinishlar. Matndagi bog‘langan so‘z lug‘at panelini ochadi. Vaqtli mashqda javoblar topshirilgach natija va tahlil ochiladi; faol testning tayyor javoblarini RIWI bermaydi.',
        'Reading opens Lessons. Lessons contains teaching material; Academic has test sets; General practises question types; Retention revisits passage knowledge; History lists attempts. Bound words open the dictionary panel. Timed work is submitted before results and analysis; RIWI does not disclose active-test answers.'),
    _topic('listening','listening tinglash audio podcast transcript', ['/app/listening','/app/listening/lessons','/app/listening/tests','/app/listening/mcq','/app/listening/history'],
        'Listening kirishi darslar yo‘liga o‘tadi. Darslar, to‘liq testlar, MCQ va History alohida sahifalar. Audio/player tinglashni boshqaradi; study, test va revision holatlari bir xil vazifa emas. Transcript va javoblar server ruxsat bergan o‘quv/tahlil holatida ochiladi. Faol baholashdagi yopiq javobni RIWI chetlab o‘tib bermaydi.',
        'Listening has lessons, full tests, MCQ and History. The player controls audio. Study, test and revision are distinct activities. Transcripts and answers follow the server-authorized study/review state; RIWI cannot bypass an active assessment.'),
    _topic('writing','writing yozish insho essay language stealing translation', ['/app/writing','/app/writing/history'],
        'Writing’da topshiriq tanlab matn yoziladi. Language Stealing foydali til birliklari bilan ishlaydi, Translation tarjima mashqiga xizmat qiladi, Submissions/History oldingi ishlarni ochadi. Saqlash va topshirish alohida holatlar: topshirilgan ish baholash jarayoniga kiradi. RIWI biriktirilgan matn yoki ruxsat etilgan o‘quv materiali bilan yordam beradi.',
        'Writing lets you select a task and write a response. Language Stealing works with useful language; Translation provides translation practice; Submissions/History opens earlier work. Saving and submitting are distinct: submission enters assessment. RIWI can assist with supplied text or permitted study material.'),
    _topic('speaking','speaking gapirish talaffuz recorder recording mikrofon', ['/app/speaking','/app/speaking/lessons','/app/speaking/practice','/app/speaking/ai','/app/speaking/speak-or-die','/app/speaking/live-partner','/app/speaking/history'],
        'Speaking’da Lessons — darslar, Practice Alone — mustaqil mashq, AI — baholash yo‘li, Speak or Die — ravonlik mashqi, Live Partner — sherik bilan mashq va History — oldingi urinishlar bor. Practice ichida qism, keyin mavzu tanlanadi. Mikrofon yozuvi uchun brauzer ruxsati kerak; yozuvni boshlash, to‘xtatish va topshirish alohida amallar. AI baholashi tashqi xizmat sozlamalariga bog‘liq; xizmat tayyor bo‘lmasa baho uydirilmaydi. Ruxsat/yozuv xatosini RIWI natija sifatida ko‘rsatmaydi.',
        'Speaking has Lessons, Practice Alone, AI evaluation, Speak or Die fluency practice, Live Partner and History. Practice selects a part and then a topic. Recording requires browser microphone permission; start, stop and submit are separate actions. AI evaluation depends on configured external services; an unavailable service never produces an invented score. A permission/recording failure is not a completed assessment.'),
    _topic('grammar','grammar grammatika dars lesson author', ['/app/grammar','/app/grammar/lessons'],
        'Grammar Lessons asosiy grammatika kutubxonasi. Grammar for Speaking sahifasida 77 ta, Grammar for Writing sahifasida 120 ta dars bor; Speaking va Writing uchun Grammar sahifasidagi tegishli tabni tanlang. Har bir dars to‘rt bosqichli mashqlarni ochadi, day/night rejimi saytga mos. Writing Academic Task 1 mavzularida diagrammalar mavjud. Darsni ochish to‘g‘ridan-to‘g‘ri coin yoki baho bermaydi; o‘quv natijalari server qoidalariga bog‘liq. Mualliflik va nashr xodim vakolatini talab qiladi.',
        'Grammar Lessons is the core grammar library. Grammar for Speaking contains 77 units and Grammar for Writing contains 120 units, selectable from the relevant tabs on the Grammar page. Lessons use four exercise stages and follow the site theme; Academic Writing Task 1 includes diagrams. Opening a lesson does not award coins or grades; verified outcomes follow server rules. Authoring and publishing require staff permission.'),
    _topic('leaderboard','leaderboard reyting ranking tanga coin coins yulduz stars ochko', ['/app/study-plan/leaderboard'],
        'Reyting Dock ichidagi alohida bo‘limdir: eng yuqori uchta o‘quvchi podiumda, keyingi o‘rinlar jadvalda ko‘rinadi. Shu hafta, Oxirgi 30 kun va Barcha vaqt davrlarini tanlash mumkin. «Qanday qilib tanga to‘plashim mumkin?» shu sahifadagi to‘rtinchi tabni ochadi; alohida modal emas. Online o‘quvchilar ro‘yxati ko‘rsatilmaydi. Yulduz, tanga va mashq vaqti faqat server tasdiqlagan faoliyatga asoslanadi. Aniq tanga qoidasini sahifadagi server siyosatidan tekshiring; RIWI taxminiy tanga bermaydi.',
        'Leaderboard lives in the Dock. The first three learners appear on the podium and remaining places in a table. Choose This week, Last 30 days or All time. How can I earn coins? is a fourth inline tab, not a modal. Online-student presence is not shown. Stars, coins and practice duration reflect server-verified activity; rely on the server policy tab for current coin rules.', ('student','owner')),
    _topic('vocabulary','vocabulary vocab lug‘at dictionary revision flashcard game so‘z', ['/app/vocabulary','/app/vocabulary/games'],
        'Vocabulary — shaxsiy so‘z va iboralar kutubxonangiz 📚\n\n1. Dictionary’da inglizcha yoki o‘zbekcha so‘z qidiring. Natijada kerakli ma’no va so‘z turkumini tanlang; bir so‘zning hamma ma’nosi bir xil emas.\n2. Kerakli so‘zni papkaga saqlang. Saqlangan so‘zlar Words’da turadi; matndagi bog‘langan so‘zni bosib ham lug‘at panelini ochish mumkin.\n3. Revision’da avval saqlagan so‘zlarni eslab, takrorlang. Eski Review havolasi shu joyga olib keladi.\n4. Use’da so‘zlarni qo‘llashni mashq qiling; Games’da esa turli o‘yinlar bilan mustahkamlang. Board qayd etilgan natijalarni ko‘rsatadi.\n\nMasalan, yangi so‘z topdingiz → ma’nosini tekshirasiz → papkaga saqlaysiz → keyin Revision’da eslaysiz. So‘zning boshqa gapda ishlatilishini uning kontekstiga qarab tekshiring.',
        'Vocabulary is your personal word and phrase library 📚\n\n1. Search English or Uzbek words in Dictionary. Choose the intended meaning and part of speech; different senses are not interchangeable.\n2. Save the chosen word to a folder. Saved entries appear in Words. Bound words in reading material also open a dictionary panel.\n3. Recall saved words in Revision. The old Review link redirects there.\n4. Practise using them in Use and reinforce them in Games. Board shows recorded results.\n\nFor example: find a word → check its meaning → save it to a folder → recall it later in Revision. Check the context before using a different sense.'),
    _topic('course','course roadmap kurs ielts yo‘l xaritasi', ['/app/courses/ielts'], 'Kurs xaritasi bo‘lim va darslarga olib boradi. Dars ochilganda shu dars sahifasi yuklanadi; mavjudlik va ruxsat serverdan keladi.', 'The course roadmap links to sections and lessons. Opening a lesson loads its page; availability and access come from the server.'),
    _topic('video','video lesson videodars', ['/app/video-lessons'], 'Videodarslar kutubxonasidan dars tanlanadi, batafsil sahifadagi player video ijrosini boshqaradi.', 'Select a video in the lesson library; its detail-page player controls playback.'),
    _topic('mocks','mock mocks imtihon exam', ['/app/mocks'], 'Mock testlar sahifasi mavjud sinovlarni ochadi. Faol sinovning vaqt va topshirish qoidalari server holatiga bog‘liq; RIWI yashirin javob kalitini bermaydi.', 'Mocks opens available assessments. Timing and submission depend on server state; RIWI does not reveal hidden answer keys.'),
    _topic('assignments','assignment assignments homework uy vazifa topshiriq', ['/app/assignments'], 'Assignments biriktirilgan topshiriqlar uchun. O‘quvchi o‘z topshirig‘ini ochadi; o‘qituvchi boshqaruvi Management’dagi tegishli ish joyida.', 'Assignments opens assigned work. Learners see their own tasks; teacher management has its own workspace in Management.'),
    _topic('coach','coach reja maslahat', ['/app/coach'], 'Coach o‘quv yo‘nalishi va mashq tavsiyalarini ko‘rsatadi. Tavsiya havolasi tegishli mashqqa olib boradi; bu avtomatik baho o‘zgartirish emas.', 'Coach presents learning directions and practice recommendations. Links open the relevant practice; recommendations do not change grades.'),
    _topic('progress','progress rivojlanish natijalar', ['/app/progress'], 'Progress shaxsiy o‘quv rivojlanishini ko‘rsatadi. Faqat yozib olingan faoliyat bo‘yicha xulosa chiqariladi.', 'Progress shows personal learning activity. Conclusions depend on recorded activity.'),
    _topic('live','live classes jonli dars xona room', ['/app/live-classes'], 'Jonli darslar ro‘yxatidan xona ochiladi. Xonaga kirish va qurilma ruxsatlari darsning mavjudligi hamda server ruxsatiga bog‘liq.', 'Open a room from Live Classes. Room access and device permissions depend on class availability and server authorization.'),
    _topic('support','support yordam murojaat report problem', ['/app/support'], 'Support orqali muammo haqida murojaat yuboriladi. O‘quv vositalaridagi muammo bildirish ham tegishli sahifa kontekstiga bog‘lanadi.', 'Support submits a problem report. Reporting from Study Tools also relates the issue to its page context.'),
    _topic('reports','report reports hisobot', ['/app/reports'], 'Reports ruxsat etilgan doiradagi hisobotlarni tayyorlaydi. O‘quvchi o‘ziniki, o‘qituvchi biriktirilgan o‘quvchilar, admin operatsion doira, Owner markaz doirasida ishlaydi. RIWI boshqa foydalanuvchining yashirin ma’lumotini bermaydi.', 'Reports uses authorized scope: self for learners, assigned learners for teachers, operational scope for admins, centre scope for Owner. RIWI does not expose another user’s private data.'),
    _topic('profile','profile profil account hisob', ['/app/profile'], 'Profil menyusi yuqori panelda; shaxsiy profil va hisob amallariga olib boradi. Maxfiy parol va sessiya qiymatlarini RIWI o‘qib bermaydi.', 'The top-bar profile menu opens profile/account actions. RIWI does not disclose passwords or session values.'),
    _topic('notifications','notification bildirishnoma bell qo‘ng‘iroq', ['/app/notifications'], 'Bildirishnoma belgisi yuqori panelda. U bildirishnomalar sahifasiga olib boradi; o‘qilgan/o‘qilmagan holat server bilan saqlanadi.', 'The top-bar bell opens Notifications; read/unread state is stored through the server.'),
    _topic('management','management boshqaruv staff admin teacher', ['/app/management'], 'Management’da faqat rolingizga tegishli ish kartalari ko‘rinadi. O‘qituvchi biriktirilgan o‘quvchilar va uy vazifalari bilan, admin qabul/ro‘yxat/kontent bilan, Owner umumiy boshqaruv bilan ishlaydi. Sahifa ko‘rinishi API ruxsatini almashtirmaydi.', 'Management shows work cards for your role. Teachers manage assigned learners/homework, admins handle admissions/roster/content, and Owner has centre administration. A visible page never replaces API authorization.', STAFF),
    _topic('people','people users foydalanuvchi xodim', ['/app/admin/people','/app/admin/roster','/app/admin/admissions'], 'Bu ish joylari foydalanuvchilar, ro‘yxatlar va qabul jarayonini boshqaradi. Admin o‘zidan yuqori rolga vakolat bera olmaydi; Owner topshirilishi alohida nazoratli jarayon.', 'These workspaces manage people, rosters and admissions. Admin cannot grant a higher role; ownership transfer is a separate controlled process.', ADMIN),
    _topic('teacher-work','students o‘quvchilar homework tekshirish baholash', ['/app/teacher/students','/app/teacher/homework'], 'My Students va Homework biriktirilgan o‘quvchilar, vazifalar va baholashga xizmat qiladi. O‘quvchi tafsiloti va topshiriq sahifasi alohida yo‘lga ega; biriktirilmagan o‘quvchiga kirish server tomonidan cheklanadi.', 'My Students and Homework handle assigned learners, work and assessment. Learner detail and assignment pages are distinct; the server restricts unassigned learners.', ('teacher','owner')),
    _topic('content','content kontent material materials import publish nashr muallif', ['/app/admin/materials'], 'Materiallar ish joyida ruxsat etilgan turdagi material tanlanib tahrirlanadi. O‘qituvchi mualliflik qilishi mumkin, lekin nashr qilish alohida server vakolatini talab qiladi. Yuklash muvaffaqiyati bilan materialning nashr qilinishi bir xil hodisa emas.', 'Materials opens authorized content types for editing. Teachers may author material; publishing requires a separate server permission. Successful upload is distinct from publication.', STAFF),
    _topic('admin-content','content workspace import nashr kutubxona', ['/app/admin/reading','/app/admin/listening','/app/admin/grammar','/app/admin/writing','/app/admin/content'], 'Admin kontent ish joylari Reading, Listening, Grammar va Writing materiallarini alohida boshqaradi. Import faylni tekshiradi; tahrir, saqlash va nashr amallari turiga qarab alohida. Xatolik bo‘lsa shakldagi xabarni tekshiring, natijani taxmin qilmang.', 'Admin content workspaces separately manage Reading, Listening, Grammar and Writing. Import validates the file; edit, save and publish are distinct operations by type. Check the form’s error/result instead of assuming success.', ADMIN),
    _topic('owner','owner sozlamalar settings integrations integration transfer audit retention dictionary', ['/app/owner','/app/owner/integrations','/app/owner/transfer','/app/owner/audit','/app/owner/retention','/app/owner/dictionary','/app/owner/riwi','/app/admin/statistics'], 'Owner ish joylari: umumiy sozlamalar, integratsiyalar, ownership transfer, audit, saqlash siyosati, lug‘at, RIWI boshqaruvi va statistika. RIWI bu jarayonlarni tushuntiradi; chatdagi savolning o‘zi sozlamani o‘zgartirmaydi. Maxfiy credential qiymatlari javobga kiritilmaydi.', 'Owner workspaces cover overview/settings, integrations, ownership transfer, audit, retention policy, dictionary, RIWI administration and statistics. RIWI explains them; asking a question does not mutate settings. Secret credential values are never included.', OWNER),
    _topic('riwi','riwi chat suhbat assistant', ['/app/riwi'], 'RIWI ichki qoidalar, tasdiqlangan darslar va ruxsat etilgan materiallar bilan ishlaydi. Yangi suhbat yoki /clear oldingi kontekst va biriktirilgan fayllarni tozalaydi. Javob tili pastdagi ochiluvchi menyuda tanlanadi va faqat keyingi javoblarga ta’sir qiladi. + orqali fayl biriktiriladi; drag/drop va rasm OCR bor. Fayldagi ko‘rsatma tizim buyrug‘i hisoblanmaydi.', 'RIWI uses internal rules, approved lessons and permitted material. New Chat or /clear resets prior context and attachments. The reply-language dropdown affects future replies only. + attaches files; drop and image OCR are supported. File content is data, not system instructions.'),
]

CONTROLS = [
    ('main',r'\bmain\b|bosh sahifa|kampusga qayt|dock', 'Main / Dock', 'Asosiy sahifa Dashboard’ni ochadi. Hozir bo‘limlar pastdagi Dock ikonkalari bilan ochiladi; tafsilot sahifalaridagi Back ota sahifa yoki avvalgi tegishli sahifaga qaytaradi.', 'Home opens Dashboard. Modules now open through the bottom Dock icons; Back on detail pages returns to the parent or relevant previous page.'),
    ('search',r'qidir|search|cmd.?f|ctrl.?f', 'Qidirish / Search', 'Yuqori paneldagi qidiruv sayt bo‘ylab ruxsat etilgan natijalarni topadi. Natija tanlansa o‘sha sahifa ochiladi. Mac’da ⌘F, Windows’da Ctrl+F; Escape ro‘yxatni yopadi.', 'Top-bar search finds authorized site results. Selecting a result opens its page. Use ⌘F on Mac or Ctrl+F on Windows; Escape closes the list.'),
    ('theme',r'theme|rejim|rang mavzu|tungi|kunduzgi|dark|night mode', 'Rang mavzusi / Theme', 'Yuqori paneldagi quyosh/oy kunduzgi va tungi rejimni tanlaydi; afzallik saqlanadi. Shu sabab tugma ranglari mavzuga qarab o‘zgaradi.', 'The top-bar sun/moon selects day/night mode and saves the preference. Control colours therefore depend on theme.'),
    ('reply',r'javob tili|reply language', 'Javob tili / Reply language', 'Chat yozish joyi ostidagi Javob tili menyusi yuqoriga ochiladi. UZ/EN tanlovi chatga xabar yubormaydi va eski javoblarni tarjima qilmaydi; keyingi javoblar tilini belgilaydi.', 'Reply language below the composer opens upward. UZ/EN sends no chat message and does not retranslate history; it selects the language for future replies.'),
    ('locale',r'sayt tili|interface language|website language', 'Til / Language', 'Yuqori paneldagi UZ/EN sayt interfeysi tilini almashtiradi. RIWI javob tili chat pastida alohida tanlanadi.', 'Top-bar UZ/EN changes the interface language. RIWI reply language is chosen separately below its composer.'),
    ('new',r'yangi suhbat|new chat|/clear|/new', 'Yangi suhbat / New chat', 'Chat yuqorisidagi Yangi suhbat yoki /clear eski suhbat kontekstini, fayllar va yuklab olish havolalarini tozalab yangidan boshlaydi. Javob tili tanlovi saqlanadi.', 'New Chat at the top or /clear resets conversation context, files and download links. The chosen reply language remains.'),
    ('attach',r'fayl biriktir|attach|drop|sudra|\+ tugma', '+ / Fayl biriktirish', '+ yozish maydonining yonida. PNG/JPG/WebP, PDF, DOCX, TXT, MD, HTML, CSV va JSON qabul qilinadi; ZIP qabul qilinmaydi. Matn brauzerda o‘qiladi, rasm/skan uchun OCR ishlaydi. Savol yuborilganda ajratilgan matn RIWI serveriga boradi. Rasmdagi murakkab sahnani erkin tushunish imkoniyati yo‘q.', '+ beside the input accepts PNG/JPG/WebP, PDF, DOCX, TXT, MD, HTML, CSV and JSON; not ZIP. Text extraction and image/scan OCR run in the browser. Extracted text accompanies your question to RIWI. It does not freely understand complex photo scenes.'),
    ('send',r'yuborish|send button|jo‘natish', 'Yuborish / Send', 'Yozish maydoni yonidagi yuborish tugmasi savolni RIWI’ga jo‘natadi. Javob yoki fayl o‘qilishi davomida takror yuborish o‘chiriladi. O‘ylayapman… — ishlov holati; u cheksiz til modeli mavjudligini anglatmaydi.', 'Send beside the input submits your question. Duplicate sends are disabled while answering/reading files. Thinking… indicates processing; it does not imply an unrestricted language model.'),
    ('commands',r'buyruq|commands|/help|/simple|/examples', 'Buyruqlar / Commands', 'Pastdagi Buyruqlar / menyusi yuqoriga ochiladi: /clear, /new chat, /help, /examples va /simple. /examples va /simple avvalgi mavzuga bog‘lanadi. Javob tili uchun alohida menyu bor.', 'Commands below the composer opens upward: /clear, /new chat, /help, /examples and /simple. Examples and Simple use the previous topic. Reply language has its own menu.'),
    ('tools',r'oquv vosita|study tools', 'O‘quv vositalari / Study Tools', 'Pastdagi suzuvchi O‘quv vositalari tugmasi yordamchi menyuni ochadi; undan muammo haqida xabar berish mumkin. Escape yoki tashqariga bosish menyuni yopadi.', 'The floating Study Tools button opens utilities, including problem reporting. Escape or an outside click closes it.'),
]


def is_site_question(message):
    if re.search(r'sayt|website|web\s*site|tugma|button|sahifa|bo[‘\x27’ʻ]?lim|navigation|navigats|interfeys|interface|qidiruv|search|yuklash|upload|menu|menyu|architecture|arxitektur|/app\b',message,re.I): return True
    q=_normal(message)
    module=re.search(r'\b(?:vocabulary|vocab|lugat|dictionary|reading|listening|writing|speaking|grammar|retention|podcast|dashboard|riwi|assignment|homework|mock|progress|live class|leaderboard|reyting|coin|tanga)\w*',q)
    return bool(module and re.search(r'(?:qanday|qanaqa).{0,30}(?:ishla|foydalan|och|kir)|qayer|nima qil|nima uchun kerak|tizim|system|how.{0,30}(?:work|use|open|access)|where|ochish|ishlat|foydalan',q))


def _normal(text):
    from .riwi_uzbek import normalize_query
    return normalize_query(text)


# Only reviewed, concrete application destinations can become chat links.
_LABELS={'app':'Main','dashboard':'Dashboard','reading':'Reading','listening':'Listening',
    'writing':'Writing','speaking':'Speaking','grammar':'Grammar','vocabulary':'Vocabulary',
    'games':'Games','lessons':'Lessons','academic':'Academic','general':'General','retention':'Retention',
    'history':'History','tests':'Tests','mcq':'MCQ','practice':'Practice',
    'ielts':'IELTS course','video-lessons':'Video lessons','mocks':'Mock tests','assignments':'Assignments',
    'coach':'Coach','progress':'Progress','leaderboard':'Reyting','live-classes':'Live Classes','support':'Support','reports':'Reports',
    'profile':'Profile','notifications':'Notifications','management':'Management','people':'People',
    'roster':'Roster','admissions':'Admissions','students':'My Students','homework':'Homework',
    'materials':'Materials','content':'Content','owner':'Owner','integrations':'Integrations',
    'transfer':'Ownership transfer','audit':'Audit','dictionary':'Dictionary','riwi':'RIWI','statistics':'Statistics'}


def safe_navigation(role, values):
    result=[]
    for item in values if isinstance(values,list) else []:
        if not isinstance(item,dict): continue
        path=item.get('href');label=item.get('label')
        if not isinstance(path,str) or not isinstance(label,str) or not 1<=len(label)<=100: continue
        page=route(path)
        if not page or ':' in path or role not in page['roles'] or any(x['href']==path for x in result): continue
        result.append({'href':path,'label':label})
        if len(result)==32: break
    return result


def site_response(role,message,locale,context=()):
    links=[];answer=answer_site_question(role,message,locale,context,_navigation=links)
    return {'answer':answer,'navigationLinks':safe_navigation(role,links)} if answer else None


def answer_site_question(role, message, locale, context=(), *, _navigation=None):
    if not is_site_question(message): return None
    # Quoted example sentences and dictionary terms are learning requests, even
    # when they contain words such as "button", "website" or "search".
    from .riwi_understanding import text_request
    if text_request(message) or re.search(r'nima degani|so.zining ma.nosi|meaning of|what does .+ mean|\bdefine\b',message,re.I): return None
    uz = locale == 'uz'
    q = _normal(message)
    denied = 'Bu ma’lumot rolingiz vazifalari doirasiga kirmaydi. O‘zingizga ruxsat etilgan ish joyi haqida yordam beraman.' if uz else 'That is outside your role’s duties. I can help with your authorized workspace.'
    architecture = bool(re.search(r'arxitektur|architecture|backend|frontend|api\b|navigation tizim|router|kod.*ishla|tuzilishi',q))
    architecture_text=None
    if architecture:
        if role != 'owner': return denied
        architecture_text = ('Sayt tuzilishi 🧭\n\nBrauzer interfeysi native JavaScript ESM modullaridan iborat. Python FastAPI backend autentifikatsiya, ma’lumotlar va API vakolatini tekshiradi. Sahifalar js/routes.js’da, navigatsiya js/router.js’da boshqariladi. Ichki havola History API bilan o‘tadi; back/forward popstate orqali tiklanadi. Eski manzillar canonical yo‘lga yo‘naltiriladi. Himoyalangan modul ma’lumotidan oldin sessiya tekshiriladi; API esa rol va obyekt doirasini mustaqil tekshiradi.\n\nMain — /app Dashboard sahifasi; bo‘limlar pastdagi Dock’dan ochiladi. Oddiy sahifalarda umumiy yuqori panel saqlanadi; vaqtli/focus mashqlari alohida ko‘rinishga ega. UI holati ruxsat bermaydi. RIWI ichki qoidalar va tasdiqlangan bilimlar bilan javob beradi; sayt qo‘llanmasi shu kod versiyasidagi marshrutlar bilan tekshiriladi.' if uz else
                'Site architecture 🧭\n\nThe browser uses native JavaScript ESM modules; the Python FastAPI backend verifies authentication, data access and API permissions. js/routes.js defines pages and js/router.js handles navigation. Internal links use the History API; back/forward uses popstate. Legacy addresses canonicalize. Protected module data follows session checks; APIs independently verify roles and object scope.\n\nMain is the /app Dashboard page; the bottom Dock opens modules. Ordinary pages retain the shared top bar; timed/focus activities have separate layouts. UI state grants no authority. RIWI uses internal rules/approved knowledge; the site guide is checked against this code version’s routes.')
    explicit_paths = re.findall(r'/app(?:/[A-Za-z0-9_:\-]+)*',message)
    for path in explicit_paths:
        r=route(path)
        if r and role not in r['roles']: return denied
    # Explicit privileged-area questions are denied before any generic button match.
    if role!='owner' and re.search(r'\bowner\b|integrats|integration|ownership|audit|statistika|statistics',q): return denied
    if role not in ADMIN and re.search(r'\badmin\b|admission|qabul|roster|foydalanuvchi.*boshqar',q) and not any(route(p) and role in route(p)['roles'] for p in explicit_paths): return denied
    if role not in ('teacher','owner') and re.search(r'teacher students|my students|oquvchilar.*(?:bahola|tekshir)|homework.*(?:manage|grade)',q): return denied
    if role not in STAFF and re.search(r'material.*(?:nashr|publish|muallif)|content.*(?:publish|author)|import.*(?:reading|listening)|(?:reading|listening).*import',q): return denied
    if role not in ADMIN and re.search(r'(?:reading|listening).*import|import.*(?:reading|listening)|(?:material|content|dars).*(?:nashr|publish)',q): return denied
    parts=[architecture_text] if architecture_text else []
    link_paths=[]
    control=next((c for c in CONTROLS if re.search(c[1],q,re.I)),None)
    if control: parts.append(control[3 if uz else 4])
    matches=[]
    for topic in TOPICS:
        if role not in topic['roles']: continue
        score=sum(1 for word in set(_normal(topic['aliases']).split()) if len(word)>2 and word not in {'sahifa','bolim','dars','lesson','settings','sozlamalar','page','site','sayt'} and re.search(r'\b'+re.escape(word)+r'\w*',q))
        if score and topic['id'] in ('content','admin-content') and re.search(r'import|nashr|publish|muallif|author',q): score+=5 if topic['id']=='admin-content' else 4
        if any(path in topic['paths'] for path in explicit_paths): score+=20
        if score: matches.append((score,topic))
    matches.sort(key=lambda x:x[0],reverse=True)
    selected=matches[0][1] if matches else None
    if selected and not control:
        parts.append(selected['uz' if uz else 'en'])
    paths=[r for r in catalog()['routes'] if role in r['roles']]
    if re.search(r'sayt.*(?:hamma|barcha|bolim|tuzil)|site map|all.*(?:page|module)|qaysi.*bolim',q) and not parts:
        visible=[t for t in TOPICS if role in t['roles']]
        parts.append(('Sizga tegishli bo‘limlar 🧭' if uz else 'Your site areas 🧭')+'\n\n'+' · '.join(_LABELS.get(t['paths'][0].split('/')[-1],t['id'].title()) for t in visible))
        link_paths.extend(t['paths'][0] for t in visible)
    # A label match can describe the observed control, never execute it or trust its role claims.
    observed=[]
    for surface in context:
        r=route(surface['path'])
        if not r or role not in r['roles']: continue
        if selected and not control and not any(surface['path'].startswith(p) for p in selected['paths']): continue
        for c in surface['controls']:
            if c['href'] and role not in route(c['href'])['roles']: continue
            label=_normal(c['label'])
            overlap=set(label.split()) & set(q.split())
            if len(label)>1 and (label in q or len([x for x in overlap if len(x)>3])>=1):
                observed.append((len(label) if label in q else len(overlap),surface,c))
    observed.sort(key=lambda x:x[0],reverse=True)
    if observed:
        _,surface,c=observed[0]
        zones={'top':'yuqori','middle':'o‘rta','bottom':'past','left':'chap','center':'markaz','right':'o‘ng'}
        zone=' '.join(zones[x] for x in c['zone'].split('-')) if uz else c['zone'].replace('-',' ')
        page_label=_LABELS.get(surface['path'].split('/')[-1],'Sahifa' if uz else 'Page')
        detail=(f'Brauzerning shu sessiyada ko‘rilgan holati: «{c["label"]}», {page_label}, {zone}. Matn rangi: {c["color"]}; fon: {c["background"]}. ' if uz else
                f'Browser observation in this session: “{c["label"]}”, {page_label}, {zone}. Text: {c["color"]}; background: {c["background"]}. ')
        if c['disabled']: detail+=('Hozir faol emas. ' if uz else 'Currently disabled. ')
        if c['href']: link_paths.append(c['href'])
        if role=='owner' and c.get('action') and re.search(r'kod|code|orqa|behind|navigation|navigats|amal|action|qanday.*ishla|how.*work',q):
            detail+=(' Brauzerda ulangan handler kodi (qiymatlar bajarilmagan): ' if uz else ' Attached browser handler (not executed, no closure values): ')+c['action']
        if not parts and not c['href']: detail+=('Bu tugmaning ichki amalini faqat nomidan taxmin qilmayman; qaysi vazifani bajarayotganingizni yozing.' if uz else 'I cannot infer its internal action from its label alone; describe the task you are doing.')
        detail+=(' Ekran/mavzu o‘zgarsa joylashuv va rang ham o‘zgaradi.' if uz else 'Layout and colours change with screen size/theme.')
        parts.append(detail)
    elif re.search(r'rang|colou?r|qayer|where|joylash|position|background',q):
        parts.append('Aniq rang va joyni aytish uchun shu brauzerda tegishli sahifani ochib, keyin RIWI’ga qayting. Ko‘rmagan holatimni taxmin qilmayman.' if uz else 'For exact colour/location, open that page in this browser and return to RIWI. I will not invent an unseen state.')
    if not parts:
        return 'Qaysi sahifa yoki tugmani nazarda tutyapsiz? Uning ko‘rinib turgan nomi yoki /app/… manzilini yozing; bilmagan vazifani taxmin qilib bermayman.' if uz else 'Which page or control do you mean? Give its visible label or /app/… path; I will not guess unknown behaviour.'
    if selected and not control:
        allowed=[p for p in selected['paths'] if any(r['path']==p for r in paths)]
        link_paths.extend(allowed)
    if control and not link_paths:
        if control[0]=='main': link_paths.append('/app')
        elif control[0] in ('reply','new','attach','send','commands'): link_paths.append('/app/riwi')
    if _navigation is not None:
        for path in dict.fromkeys(link_paths):
            segments=path.split('/');leaf=segments[-1]
            label=_LABELS.get(leaf,leaf.replace('-',' ').title())
            if leaf in ('lessons','history','academic','general','retention','tests','mcq','practice','games') and len(segments)>3:
                label=_LABELS.get(segments[-2],segments[-2].title())+' · '+label
            _navigation.append({'href':path,'label':label})
    return '\n\n'.join(parts)[:6000]
