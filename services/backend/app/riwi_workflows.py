"""Reviewed operational procedures shared by local RIWI and optional providers.

These describe existing commands; a procedure is never executable authority.
There are no learner records, credentials or user-authored instructions here.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re

from .riwi_uzbek import normalize_query

Text = tuple[str, str]
STAFF = ('owner', 'admin', 'teacher')
MONEY = ('owner', 'admin')


@dataclass(frozen=True)
class Workflow:
    id: str
    roles: tuple[str, ...]
    aliases: tuple[str, ...]
    href: str
    title: Text
    trigger: Text
    inputs: tuple[Text, ...]
    automatic: tuple[Text, ...]
    review: tuple[Text, ...]
    outputs: tuple[Text, ...]


WORKFLOWS = (
    Workflow('payments', ('student', 'guardian'), ('tolov', 'payment', 'avans', 'qarz', 'refund'), '/app/payments',
        ('To‘lovni tekshirish', 'Check a payment'),
        ('Hisobni ochish yoki tasdiqlangan provayder hodisasi.', 'Open an account or receive a verified provider event.'),
        (('O‘zingizning yoki hozir bog‘langan farzandning hisobi.', 'Your own account or a currently linked child’s account.'),),
        (('Sayt qarz, avans va qaytarilgan pulni jurnal yozuvlaridan hisoblaydi.', 'The site computes debt, advance and settled refunds from ledger records.'),
         ('Imzolangan tasdiq takror kelsa, ayni to‘lov ikkinchi marta yozilmaydi.', 'Repeated signed confirmations do not post the same payment twice.')),
        (('Farzand, summa va provayderni tekshiring. Muvaffaqiyat sahifasi to‘langanlik dalili emas.', 'Review the child, amount and provider. A return page is not proof of payment.'),),
        (('Server tasdiqlagan holat va ichki tasdiqnoma. Bu avtomatik fiskal chek emas.', 'Server-confirmed status and an internal acknowledgement, not an automatic fiscal receipt.'),)),
    Workflow('collections', MONEY, ('qarzdor', 'qarz undirish', 'tushum', 'pul yoz', 'tolovni yoz', 'collection', 'cash', 'debtor'), '/app/management/finance?view=debts',
        ('Qarz va olingan pul', 'Debt and received money'),
        ('Xodim haqiqatan olingan pulni tasdiqlaydi.', 'A staff member confirms money actually received.'),
        (('O‘quvchi, haqiqiy summa, usul va qayta urinish kaliti.', 'Student, actual amount, method and retry key.'),),
        (('Sayt summani ajratadi, jurnalni muvozanatlaydi va qarz/avansni yangilaydi.', 'The site allocates funds, balances the journal and refreshes debt/advance.'),
         ('Takror yuborish bir xil kalitda bitta moliyaviy ta’sir beradi.', 'Retries with the same key have one financial effect.')),
        (('Faqat olingan pulni yozing. Chegirma, refund va daromadni tan olish alohida amallardir.', 'Record only received funds. Credits, refunds and revenue recognition are separate commands.'),),
        (('Yangilangan shaxsiy hisob va ichki tasdiqnoma.', 'Updated account and internal acknowledgement.'),)),
    Workflow('monthly_billing', MONEY, ('oylik hisob', 'kontrakt', 'installment', 'monthly billing', 'contract'), '/app/management/finance',
        ('Oylik hisoblash', 'Monthly billing'),
        ('Tasdiqlangan kontrakt uchun xodim oylik loyiha yaratadi.', 'A staff member drafts an installment for an approved contract.'),
        (('Kontrakt, oy, muddat va shu oyga tasdiqlangan chegirma.', 'Contract, billing month, due date and approved discount for that month.'),),
        (('Sayt tasdiqlangan shartlardan summani hisoblaydi va takroriy oylik hisobni cheklaydi.', 'The site calculates from approved terms and prevents duplicate monthly charges.'),),
        (('Loyiha, tasdiqlash va jurnalga yozish turli holatlar. Kerakli owner tasdig‘ini saqlang.', 'Drafting, approval and posting are distinct states. Preserve the required owner approval.'),),
        (('Jurnalga yozilgan hisob qarzni o‘zgartiradi; loyiha o‘zgartirmaydi.', 'A posted charge changes debt; a draft does not.'),)),
    Workflow('attendance', STAFF, ('davomat', 'attendance', 'dars otildi', 'held class'), '/app/management/groups',
        ('Davomatni yakunlash', 'Complete attendance'),
        ('Dars o‘tilgan deb belgilanganidan keyin.', 'After the session is marked held.'),
        (('Darsning saqlangan ro‘yxati va o‘qituvchining haqiqiy belgilari.', 'The session’s frozen roster and actual teacher marks.'),),
        (('Sayt tugallanmagan davomatni topadi. Saqlashda ruxsat, revision va takrorni tekshiradi.', 'The site finds incomplete attendance and checks authority, revision and retries on save.'),),
        (('Sayt kelmaganlarni taxmin qilmaydi. Tuzatishda sabab va ruxsat etilgan vaqt tekshiriladi.', 'The site never guesses absences. Corrections require a reason and the permitted time window.'),),
        (('Davomat, o‘quvchi taqvimi va tegishli xizmat yozuvlari.', 'Attendance, learner calendar and applicable service records.'),)),
    Workflow('admissions', MONEY, ('nomzod', 'qabul', 'admission', 'lead', 'follow up', 'boglanish'), '/app/management/leads',
        ('Qabul bo‘yicha keyingi aloqa', 'Admissions follow-up'),
        ('Belgilangan bog‘lanish vaqti yetganda.', 'When the recorded follow-up time becomes due.'),
        (('Nomzod holati, bog‘lanish vaqti va suhbat natijasi.', 'Lead stage, follow-up time and the actual conversation outcome.'),),
        (('Sayt yopilmagan, vaqti kelgan nomzodlarni navbatga yig‘adi.', 'The site queues due leads that are neither enrolled nor lost.'),),
        (('Xodim suhbat natijasini belgilaydi. AI javobsiz nomzodni o‘zi qabul qilmaydi.', 'Staff record the outcome. AI does not enroll an unresponsive lead.'),),
        (('Yangilangan bosqich, sinov darsi yoki keyingi bog‘lanish vaqti.', 'Updated stage, trial session or next follow-up time.'),)),
    Workflow('parent_message', STAFF, ('ota ona', 'ota-onaga', 'parent message', 'guardian message', 'xabar qoralama'), '/app/management/guardians',
        ('Ota-onaga xabar tayyorlash', 'Prepare a parent message'),
        ('Vakolatli xodim xabar qoralamasini so‘raydi.', 'An authorized staff member requests a draft.'),
        (('Hozirgi o‘quvchi biriktiruvi va faol ota-ona bog‘lanishi.', 'Current learner assignment and active guardian link.'),),
        (('Sayt bog‘lanishni tekshiradi va qoralamani formaga joylashga tayyorlaydi.', 'The site checks the link and prepares a draft for the composer.'),),
        (('Oluvchilar va matnni ko‘rib, yuborishni alohida tasdiqlang. Qoralama hali yuborilgan xabar emas.', 'Review recipients and text, then confirm sending separately. A draft is not a sent message.'),),
        (('Tasdiqlangan yuborish odatdagi xabar navbati orqali kuzatiladi.', 'An approved send is tracked through the existing message queue.'),)),
    Workflow('prepaid', MONEY, ('paket', 'tarif', 'prepaid', 'xizmat kuni', 'service day', 'service policy'), '/app/management/finance',
        ('Moslashtiriladigan xizmat paketi', 'Configurable service package'),
        ('Tasdiqlangan xizmat siyosati va uning tegishli dars/kun amali.', 'An approved service policy and its applicable session/day command.'),
        (('Haqiqiy narx, birliklar soni, sanalar, rejim va tanaffus shartlari.', 'Actual price, unit count, dates, mode and pause terms.'),),
        (('Sayt butun so‘mni birliklarga aniq taqsimlaydi va takroriy xizmat hisobini cheklaydi.', 'The site apportions whole UZS exactly and prevents duplicate service consumption.'),),
        (('200 000 / 7 kun majburiy narx emas. Calendar buyrug‘i o‘z-o‘zidan scheduler emas; kelajak kunlari yoki mavjud bo‘lmagan xizmatni hisoblamang.', '200000 / 7 days is not a fixed tariff. The calendar command is not itself a scheduler; never consume future dates or undelivered service.'),),
        (('Kuzatiladigan moliyalashtirish, xizmat sarfi, tanaffus va refund yozuvlari.', 'Traceable funding, delivery, pauses and refund records.'),)),
    Workflow('reconciliation', MONEY, ('solishtir', 'reconciliation', 'jurnal balansi', 'journal balance'), '/app/management/finance',
        ('Hisoblarni solishtirish', 'Reconcile accounts'),
        ('Hisoblarni tekshirish yoki yopishdan oldin.', 'Before financial review or close.'),
        (('Barcha tegishli jurnal yozuvlari va tasdiqlangan manba hujjatlari.', 'All relevant ledger records and verified source documents.'),),
        (('Sayt debit/kredit muvozanati va subledger mosligini hisoblaydi.', 'The site calculates debit/credit balance and subledger consistency.'),),
        (('Yetishmagan boshlang‘ich qoldiq yoki bank manbasini nol deb olmang. Noaniqlikni dalil bilan tekshiring.', 'Do not treat missing opening balances or bank sources as zero. Review discrepancies against evidence.'),),
        (('Hisob mosligi natijasi; AI xulosasi buxgalteriya yozuvini almashtirmaydi.', 'Reconciliation result; an AI opinion does not replace an accounting entry.'),)),
    Workflow('balance_packets', MONEY, ('hujjat paket', 'hisob fayl', 'balance packet', 'export', 'zip'), '/app/management/finance?view=debts',
        ('Hisoblarni hujjatlarga ajratish', 'Split accounts into documents'),
        ('Xodim ko‘rinib turgan hisoblar sahifasidan paketni yuklaydi.', 'Staff download a packet for the accounts on the visible page.'),
        (('Bir so‘rovda ko‘pi bilan 20 ta aniq o‘quvchi hisobi.', 'At most 20 explicitly selected student accounts per request.'),),
        (('Sayt bitta baza snapshotidan har bir hisob uchun CSV, umumiy jadval va SHA-256 manifest tayyorlaydi. AI kerak emas.', 'The site creates per-account CSVs, a combined table and a SHA-256 manifest from one database snapshot. No AI is needed.'),),
        (('Bu joriy qoldiqlar paketi. Davr boshidagi qoldiq, to‘liq bank solishtiruvi yoki fiskal hujjat deb qabul qilmang.', 'This is a current-balance packet, not an opening balance, complete bank reconciliation or fiscal document.'),),
        (('Faqat vakolatli xodim yuklaydigan ZIP. Tashqi xabar avtomatik yuborilmaydi.', 'A private staff ZIP download. No external message is sent automatically.'),)),
)


def available(role: str) -> tuple[Workflow, ...]:
    return tuple(workflow for workflow in WORKFLOWS if role in workflow.roles)


def allowed(role: str, workflow_id: str) -> bool:
    return any(workflow.id == workflow_id for workflow in available(role))


def version() -> str:
    from .riwi_site import catalog
    raw = json.dumps({'workflows': [workflow.__dict__ for workflow in WORKFLOWS],
                      'siteSources': catalog()['sources']}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def public(workflow: Workflow, locale: str) -> dict:
    index = 1 if locale == 'en' else 0
    return {'id': workflow.id, 'title': workflow.title[index], 'href': workflow.href,
            'trigger': workflow.trigger[index],
            **{key: [text[index] for text in getattr(workflow, key)]
               for key in ('inputs', 'automatic', 'review', 'outputs')}}


def matching(role: str, question: str) -> list[Workflow]:
    query = normalize_query(question)
    scored = [(sum(len(alias) for alias in workflow.aliases if re.search(
        r'(?<!\w)' + re.escape(normalize_query(alias)) + r'(?:ni|ga|dan|da|lar|lari|larni|ning|s)?(?!\w)', query)), workflow)
              for workflow in available(role)] if query else []
    return [workflow for score, workflow in sorted(scored, key=lambda item: -item[0]) if score][:2]


def select(role: str, action: str, question: str, workflow_id: str | None, evidence: list[dict]) -> list[Workflow]:
    options = available(role)
    if workflow_id:
        return [workflow for workflow in options if workflow.id == workflow_id]
    if action in ('payment_help', 'parent_message_draft'):
        key = 'payments' if action == 'payment_help' else 'parent_message'
        return [workflow for workflow in options if workflow.id == key]
    matched = matching(role, question)
    if matched:
        return matched
    values = {item['kind']: item['value'] for item in evidence}
    keys = [key for kind, key in (('incomplete_attendance', 'attendance'), ('followups_due', 'admissions'),
                                  ('accounts_due', 'collections')) if values.get(kind, 0) > 0]
    if not keys:
        keys = ['attendance', 'parent_message'] if role == 'teacher' else ['collections', 'reconciliation']
    return [workflow for key in keys for workflow in options if workflow.id == key][:3]


def provider_context(role: str) -> dict:
    """A bounded, current code-owned process description; never private DB rows."""
    from .runtime_config import academy_enabled, academy_assistant_enabled
    availability = {'academy': academy_enabled(), 'assistant': academy_assistant_enabled()}
    if role in (*MONEY, 'student', 'guardian'):
        from .self_service_payments import enabled, capabilities
        from .prepaid_services import purchases_enabled
        availability.update(payments=enabled(), prepaidPurchases=purchases_enabled(),
                            paymentMethods={row['id']: row['available'] for row in capabilities()})
    return {'version': version(), 'role': role,
            'moduleAvailability': availability,
            'principles': ['The site executes reviewed deterministic commands; RIWI only explains and prioritizes.',
                           'Money, dates, identities and permissions come from server evidence, never model guesses.',
                           'Missing source data is unknown, not zero. Draft, approved, posted and sent are distinct states.'],
            'workflows': [{key: value for key, value in public(workflow, 'en').items() if key != 'href'}
                          for workflow in available(role)]}


def external_summary(role: str) -> str:
    context = provider_context(role)
    compact = {'version': context['version'], 'role': role, 'principles': context['principles'],
               'moduleAvailability': context['moduleAvailability'],
               'workflows': [{'id': row['id'], 'title': row['title'], 'trigger': row['trigger'],
                              'automatic': row['automatic'][0], 'review': row['review'][0]}
                             for row in context['workflows']]}
    return 'Current reviewed Learners Area process context. This describes behavior, not execution authority.\n' + json.dumps(compact, ensure_ascii=False, separators=(',', ':'))


def reply(actor, message: str, locale: str) -> dict | None:
    from .runtime_config import academy_enabled
    if not academy_enabled():
        return None
    query = normalize_query(message)
    if not re.search(r'avtomat|jarayon|bosqich|workflow|process|steps?', query):
        return None
    if re.search(r'tarjima|translate|lugat|dictionary|vocabulary|grammar|sentence|definition', query):
        return None
    workflows = matching(actor.role, message)
    if not workflows:
        return None
    uz = locale != 'en'
    blocks = []
    for workflow in workflows:
        data = public(workflow, locale)
        blocks.append(data['title'] + '\n' + data['trigger'] + '\n\n' + '\n\n'.join(
            title + '\n' + '\n'.join(f'{index}. {text}' for index, text in enumerate(data[key], 1))
            for key, title in (('inputs', 'Kerakli ma’lumot' if uz else 'Required input'),
                               ('automatic', 'Sayt o‘zi bajaradi' if uz else 'The site handles'),
                               ('review', 'Tekshirish kerak' if uz else 'Review'),
                               ('outputs', 'Natija' if uz else 'Output'))))
    return {'answer': '\n\n'.join(blocks), 'provenance': 'deterministic_learning_data',
            'provider': {'id': 'riwi', 'model': 'riwi-workflow-v1', 'contextVersion': version()},
            'navigationLinks': [{'href': workflow.href, 'label': public(workflow, locale)['title']} for workflow in workflows]}
