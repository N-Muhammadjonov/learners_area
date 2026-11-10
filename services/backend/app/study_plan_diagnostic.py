"""Server-owned question bank for the optional planning assessment."""
from __future__ import annotations

import re
from urllib.parse import quote

SKILLS = ("listening", "reading", "writing", "grammar")
FORM_VERSION = "monthly-v1"

PASSAGES = (
    "The town library tested later opening hours for six weeks. Instead of staying open every evening, it opened until nine on Tuesdays and Thursdays. Visitor numbers rose most on Thursdays, when nearby evening classes finished. The library kept both late evenings because Tuesday visitors borrowed more books on average, even though fewer people came.",
    "A university garden used two methods to reduce water use. One plot was covered with a layer of dry leaves, while a second plot was watered less often. The covered plot stayed moist for longer and produced almost the same amount of vegetables as before. The second plot used even less water, but its harvest fell. The team decided to test the leaf cover across a larger area next year.",
)
WRITING_PROMPT = (
    "A local library can either extend its opening hours or add more online resources. "
    "Choose one option. Write 45–110 words. Give your opinion, one reason, and an example or explanation."
)


def item(key: str, topic: str, prompt: str, choices: tuple[str, ...], answer: int, passage: int | None = None) -> dict:
    return {"id": key, "topic": topic, "prompt": prompt, "options": list(choices), "answer": answer, "passage": passage}


BANK = {
    "reading": (
        item("r1", "detail", "On which days did the library stay open late?", ("Monday and Thursday", "Tuesday and Thursday", "Every weekday"), 1, 0),
        item("r2", "inference", "What can be inferred about Tuesday visitors?", ("They borrowed more per person than Thursday visitors", "They came after evening classes", "They asked for earlier hours"), 0, 0),
        item("r3", "main_idea", "Which title best fits the passage?", ("Why the library stopped lending books", "How evening classes were redesigned", "What the library learned from testing late hours"), 2, 0),
        item("r4", "detail", "What happened to the second plot's harvest?", ("It increased", "It fell", "It stayed almost the same"), 1, 1),
        item("r5", "inference", "Why is the team likely to expand the leaf-cover trial?", ("It eliminated the need for watering", "It helped retain moisture while maintaining the harvest", "It produced twice as many vegetables"), 1, 1),
        item("r6", "main_idea", "What is the main purpose of the second passage?", ("To compare two ways of saving water", "To explain how to collect dry leaves", "To argue against university gardens"), 0, 1),
    ),
    "writing": (
        item("w1", "argument", "Which sentence gives the clearest position for an essay about longer library hours?", ("There are different views about libraries.", "Libraries should stay open later so people who work can use them.", "Opening hours are a topic that exists."), 1),
        item("w2", "argument", "Which sentence develops the claim that evening hours help working adults?", ("For instance, a nurse finishing at six could collect a reserved book before going home.", "Libraries contain books of many colours.", "Many adults work, and many do other things."), 0),
        item("w3", "cohesion", "Online resources are convenient. ___, not every learner has reliable internet.", ("For example", "Therefore", "However"), 2),
        item("w4", "precision", "Which revision preserves the original meaning of ‘Most visitors arrived after six’?", ("Most people came later than six.", "All visitors left by six.", "Only six people arrived."), 0),
        item("w5", "cohesion", "Which order makes the strongest paragraph?", ("Example → unrelated fact → topic", "Claim → reason → relevant example", "Conclusion → new argument → title"), 1),
    ),
    "grammar": (
        item("g1", "agreement", "The list of available books ___ on the desk.", ("are", "is", "be"), 1),
        item("g2", "agreement", "Neither of the answers ___ the question.", ("addresses", "addressing", "to address"), 0),
        item("g3", "tense", "I ___ my essay yesterday.", ("have finished", "finished", "finish"), 1),
        item("g4", "tense", "She ___ at the library since March, and she still works there.", ("worked", "is working", "has worked"), 2),
        item("g5", "articles", "We visited ___ museum near the station for the first time.", ("an", "a", "no article"), 1),
        item("g6", "articles", "Could you close ___ window beside your chair?", ("the", "an", "no article"), 0),
        item("g7", "clauses", "Which sentence is complete?", ("Because the room was quiet.", "The room quiet and comfortable.", "I stayed because the room was quiet."), 2),
        item("g8", "clauses", "If the train is late, we ___ a taxi.", ("take yesterday", "will take", "would have taken"), 1),
    ),
}
FALLBACK_LISTENING = {
    "audio": "/js/vendor/riwi-speech/qa/en_us.wav",
    "credit": "Google FLEURS · CC BY 4.0",
    "items": [
        item("l1", "gist", "What action is the speaker describing?", ("Calling another person", "Booking a flight", "Sending a letter"), 0),
        item("l2", "detail", "How far away is the other person in the example?", ("A few streets away", "Several hundred metres away", "Thousands of miles away"), 2),
        item("l3", "detail", "What technology does the speaker mention?", ("A satellite", "A radio tower", "An undersea cable"), 0),
    ],
}


async def listening_section(con, user: dict) -> dict:
    """Select a short, accessible general recording. Official full tests stay separate."""
    from .browser_common import live, safe_resource
    from .browser_listening import NOT_DELETED
    from .step17_mcq_port import sequence

    rows = await con.fetch(f"""SELECT t.id,t.program_ref,p.audio_object_key,p.payload
        FROM listening_tests t JOIN listening_packages p ON p.test_id=t.id
        WHERE t.program_ref IS NULL AND p.payload->>'collection'='general'
          AND {live('t')} AND {NOT_DELETED} AND p.audio_object_key IS NOT NULL
          AND CASE WHEN jsonb_typeof(p.payload->'sections')='array'
                   THEN jsonb_array_length(p.payload->'sections')=1 ELSE false END
          AND NOT EXISTS(SELECT 1 FROM listening_attempts a
              WHERE a.test_id=t.id AND a.user_id=$1 AND a.status='in_progress')
        ORDER BY t.id LIMIT 8""", user["id"])
    access = {}
    for row in rows:
        audio = safe_resource(row["audio_object_key"])
        payload = row["payload"]
        if not isinstance(payload, dict) or not audio:
            continue
        audio_meta = payload.get("audio")
        duration = audio_meta.get("durationSec") if isinstance(audio_meta,dict) else None
        if type(duration) not in (float, int) or not 30 <= duration <= 420:
            continue
        questions = []
        for question in payload.get("questions") or []:
            if not isinstance(question,dict) or question.get("kind") not in ("mcq", "completion") or question.get("pair"):
                continue
            prompt, key = question.get("text"), question.get("key")
            choices = question.get("options") or []
            if not isinstance(prompt, str) or not prompt.strip() or not isinstance(key, str) or not key.strip():
                continue
            if not isinstance(choices, list) or any(not isinstance(choice, str) or not choice.strip() for choice in choices):
                continue
            if question["kind"] == "mcq" and len(choices) not in (3, 4):
                continue
            if question["kind"] == "completion" and choices:
                continue
            ident = "l" + str(len(questions)+1)
            if choices:
                letter = key.strip().upper()
                index = ord(letter)-65 if re.fullmatch(r"[A-D]",letter) else next(
                    (i for i, choice in enumerate(choices) if choice.strip().casefold() == key.strip().casefold()), -1)
                if not 0 <= index < len(choices):
                    continue
                questions.append(item(ident,"gist",prompt,tuple(choices),index))
            else:
                alternatives = question.get("alternatives") or []
                if not isinstance(alternatives, list) or any(not isinstance(value,str) for value in alternatives):
                    continue
                questions.append(item(ident,"detail",prompt,(),[key,*alternatives]))
            if len(questions) == 5:
                break
        if len(questions) >= 4 and await sequence(con,user,row,access):
            return {"audio":quote(audio,safe="/"),"sourceId":str(row["id"]),"items":questions}
    return FALLBACK_LISTENING


def public_form(attempt_id, listening: dict) -> dict:
    sections = []
    for skill in SKILLS:
        questions = listening["items"] if skill == "listening" else BANK[skill]
        section = {"skill":skill,"questions":[{key:question[key] for key in ("id","prompt","options","passage")}
                                               for question in questions]}
        if skill == "listening":
            section.update(audio=listening["audio"],credit=listening.get("credit"),canFallback=bool(listening.get("sourceId")))
        if skill == "reading":
            section["passages"] = PASSAGES
        if skill == "writing":
            section["sample"] = WRITING_PROMPT
        sections.append(section)
    return {"id":str(attempt_id),"version":FORM_VERSION,"sections":sections}


def diagnose(listening: dict, answers: object, sample: object) -> dict | None:
    if not isinstance(answers,dict) or not isinstance(sample,str) or len(sample)>1100:
        return None
    words = re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*",sample)
    if not 45 <= len(words) <= 110:
        return None
    bank = {**BANK,"listening":listening["items"]}
    ids = {q["id"] for questions in bank.values() for q in questions}
    if answers.keys() != ids:
        return None
    result = {}
    for skill in SKILLS:
        topics = {}
        for q in bank[skill]:
            value = answers[q["id"]]
            if q["options"]:
                if type(value) is not int or not 0 <= value < len(q["options"]):
                    return None
                correct = value == q["answer"]
            else:
                if not isinstance(value,str) or not value.strip() or len(value)>100:
                    return None
                correct = " ".join(value.casefold().split()) in {" ".join(a.casefold().split()) for a in q["answer"]}
            score = topics.setdefault(q["topic"],{"correct":0,"total":0})
            score["correct"] += int(correct)
            score["total"] += 1
        result[skill] = {"correct":sum(t["correct"] for t in topics.values()),"total":len(bank[skill]),"topics":topics}
    result["writing"]["sample"] = {"words":len(words),"sentences":sum(bool(s.strip()) for s in re.split(r"[.!?]+",sample))}
    return result
