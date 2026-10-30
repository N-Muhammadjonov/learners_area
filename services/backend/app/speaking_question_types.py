"""Educational Speaking question-type facets for Practice on Your Own.

The 10 / 6 / 10 classes are learning categories, not official IELTS question types.
Classify published question text at read time; do not mutate the question bank.
"""
from __future__ import annotations
import re

QUESTION_TYPES = {
 'part1': (
  ('yes-no', 'Yes / No'),
  ('description', 'Personal Information / Description'),
  ('preferences', 'Likes & Preferences'),
  ('habits', 'Habits & Frequency'),
  ('past', 'Past Experiences'),
  ('future', 'Future Plans'),
  ('opinions', 'Opinions'),
  ('reasons', 'Reasons / Why'),
  ('comparisons', 'Comparisons'),
  ('hypothetical', 'Hypothetical Questions'),
 ),
 'part2': (
  ('people', 'People'),
  ('places', 'Places'),
  ('objects', 'Objects & Things'),
  ('events', 'Events & Occasions'),
  ('experiences', 'Experiences & Memories'),
  ('activities', 'Activities & Skills'),
 ),
 'part3': (
  ('opinion', 'Opinion & Evaluation'),
  ('agree', 'Agree / Disagree'),
  ('causes', 'Causes & Reasons'),
  ('effects', 'Effects & Consequences'),
  ('comparisons', 'Comparison & Contrast'),
  ('advantages', 'Advantages & Disadvantages'),
  ('changes', 'Changes & Trends'),
  ('future', 'Future Predictions'),
  ('solutions', 'Problems & Solutions'),
  ('hypothetical', 'Hypothetical & Speculation'),
 ),
}

def _match(pattern: str, text: str) -> bool:
    return bool(re.search(pattern, text, flags=re.IGNORECASE))

def question_type(part: str, prompt: str | None, cue_card: str | None = None,
                  topic: str | None = None) -> str | None:
    if part not in QUESTION_TYPES:
        return None
    s = ' '.join((prompt or '').strip().split()).lower()
    if not s:
        return None
    if part == 'part1':
        if _match(r'\bif you (?:could|had|were|won|lost|became)|\bwhat would you (?:do|say|choose) if|\bimagine (?:you|that)|\bsuppose (?:you|that)', s):
            return 'hypothetical'
        if _match(r'\b(?:different|difference|compared? (?:with|to)|than before|changed (?:over|since|much)|how (?:has|have|did) .+ changed|between .+ and .+ better)\b', s):
            return 'comparisons'
        if _match(r'\b(?:why|what makes you|for what reason|what are the reasons)\b', s):
            return 'reasons'
        if _match(r'\b(?:how often|how frequently|usually|normally|regularly|every day|every week|each day|how many times|how much time do you spend)\b', s):
            return 'habits'
        if _match(r'\b(?:have you ever|did you|when you were|as a child|when you were younger|used to|last time|first time|in the past|when did you)\b', s):
            return 'past'
        if _match(r'\b(?:will you|going to|plan to|planning to|would you like to|hope to|want to .+ in the future|in the future|next year|in a few years)\b', s):
            return 'future'
        if _match(r'\b(?:prefer|favourite|favorite|do you like|do you enjoy|are you interested in|what do you like|what do you enjoy|which .+ do you like|are you fond of)\b', s):
            return 'preferences'
        if _match(r'\b(?:do you think|do you believe|in your opinion|should|is it important|is it better|is .+ important|is .+ necessary|good or bad)\b', s):
            return 'opinions'
        if _match(r'\b(?:where|who|what kind|what type|tell me about|describe|what is .+ like|what are .+ like|how would you describe|how is your|how do you feel about)\b', s):
            return 'description'
        if _match(r'^(?:do|does|did|can|could|are|is|have|has|would|were|was)\b', s):
            return 'yes-no'
        return 'description'
    if part == 'part2':
        # Cue-card opening determines the subject; follow-up bullets can cross categories.
        if _match(r'\b(?:a time when|a time you|an occasion when|an experience|a memory|something that happened|a situation where|a situation when|an unforgettable moment|a difficult decision|a challenge you faced|a time in your life)\b', s):
            return 'experiences'
        if _match(r'\b(?:person|someone|somebody|friend|relative|family member|teacher|colleague|neighbour|neighbor|a child|a famous person|a public figure|an elderly person|a leader|an actor|a singer|a role model)\b', s):
            return 'people'
        if _match(r'\b(?:place|location|building|city|town|country|village|park|garden|beach|mountain|river|lake|shop|restaurant|museum|library|hotel|house|room|home|street|area|neighbourhood|neighborhood|destination)\b', s):
            return 'places'
        if _match(r'\b(?:event|occasion|celebration|festival|ceremony|wedding|party|concert|competition|exhibition|birthday|public holiday|conference|performance|meeting|an important day)\b', s):
            return 'events'
        if _match(r'\b(?:activity|skill|hobby|sport|game|exercise|talent|dance|dancing|cooking|painting|drawing|swimming|hiking|camping|learning|something you (?:can|want to) do|something you learned|an outdoor activity)\b', s):
            return 'activities'
        if _match(r'\b(?:object|thing|item|book|film|movie|photograph|photo|picture|gift|present|device|equipment|machine|clothes|clothing|toy|website|app|application|product|piece of art|painting|song|music|food|meal|vehicle|car|bicycle|phone|computer|letter|advertisement)\b', s):
            return 'objects'
        # Titles not matching any specific subject describe an experience by default.
        return 'experiences'
    if _match(r'\b(?:what would happen if|what (?:do|would) you (?:think|say|do) if|if (?:people|everyone|all|we|you|there|the|government) .+ would|imagine (?:that|if)|suppose (?:that|if)|what if)\b', s):
        return 'hypothetical'
    if _match(r'\b(?:how (?:can|could|should|do) .+ (?:solve|prevent|reduce|improve|deal with|address|tackle)|what (?:can|could|should) (?:people|we|governments|the government|schools|parents|society|companies|individuals) do (?:to|about)|what (?:can|could|should) be done|what (?:are|is) the (?:solutions|best ways|possible solutions)|how (?:can|could) .+ be (?:solved|improved)|ways to (?:solve|reduce|prevent)|what measures)\b', s):
        return 'solutions'
    if _match(r'\b(?:advantage|disadvantage|benefit|drawback|pros and cons|positive and negative (?:aspects|effects)|good and bad (?:sides|points))s?\b', s):
        return 'advantages'
    if _match(r'\b(?:differences? between|different from|compared? (?:to|with)|comparison|compare|better than|worse than|how (?:are|do|is) .+ different|more .+ than|less .+ than|contrast)\b', s):
        return 'comparisons'
    if _match(r'\b(?:how (?:has|have|did) .+ chang(?:e|ed)|what (?:has|have) changed|changes? (?:over|in|to)|over (?:the|recent) (?:years|decades)|nowadays compared with|trend|becoming more (?:common|popular)|these days (?:compared|versus))\b', s):
        return 'changes'
    if _match(r'\b(?:in the future|in (?:ten|twenty|thirty|50|10|20|30) years|will .+ (?:change|happen|be|become)|what (?:do you think )?will happen|predict|prediction|future generations)\b', s):
        return 'future'
    if _match(r'\b(?:why|what (?:are|is) the (?:main )?(?:reasons|causes)|what causes|what leads (?:to|people)|reasons (?:for|behind))\b', s):
        return 'causes'
    if _match(r'\b(?:effects?|consequences?|impacts?|how (?:does|do|can) .+ affect|how .+ influences?|what happens (?:as a result|when))\b', s):
        return 'effects'
    if _match(r'\b(?:agree or disagree|do you agree|would you agree|to what extent do you agree|is it true that)\b', s):
        return 'agree'
    return 'opinion'
