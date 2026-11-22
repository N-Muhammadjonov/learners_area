"""Read the reviewed vocabulary packaged inside standalone passage HTML."""
from __future__ import annotations

from functools import lru_cache
from hashlib import sha256
import json
import os
from pathlib import Path

from .reading_lexical_policy import is_verified_reading_gloss

_PASSAGES = {
    'ae529b05-0e9f-56f1-8dbc-e96455684ab8': '03-charles-darwin-in-the-office',
    '818290cd-9f13-4f06-b453-6e1012552c63': '04-is-graffiti-art-or-crime',
    '22a5f6cd-d48d-4ea0-b2db-e87748a23955': '05-life-casting-and-art',
    '94e45a16-0f2b-4de0-b6f7-80f74ccfeb43': '06-hypnotism',
    '39b59e1e-1895-50a7-83be-7cc712c89272': '07-fishbourne-roman-palace',
    'd4e2ae83-5835-5fc1-8548-357bb1ab31ae': '08-preserving-antarctic-history',
    '0025a569-110d-4933-a948-604d356326d2': '09-the-well-being-life',
    '1a5dca1f-fd5e-4f86-8dae-b1183a40cc83': '10-the-development-of-plastics',
    '5735409a-78f2-4b4a-832e-d5417e41a1f9': '11-australian-parrots-and-their-adaptation-to-habitat-change',
    '5d7d99b4-56e4-4156-9d14-3d5e6a567fd2': '12-the-science-of-sleep',
    '36692ee8-3270-550e-8db1-b2df4f2ebd5a': '13-the-pesticide-free-village',
    'b5785e74-2761-5a9a-8abf-acb6077b3f77': '14-born-to-trade',
    'd603e4d4-d8ec-4c30-a8f9-b0a08d38332e': '15-decision-decision',
    'f07e1599-b53b-4cae-85a5-4638138b5089': '16-ahead-of-its-time',
    'd060dc0e-6cc0-417b-bc52-6bbf316f84c1': '17-iq-scores',
    '97a38d78-0fa8-47f6-91f7-8dde225c4ef3': '18-sir-francis-ronalds-and-telegraph',
    '310881c8-372d-4909-917e-d4f8ccdd5c55': '19-deep-sea-discovery',
    'b7b3121e-5be7-44f0-980d-37f82e6d9817': '20-walking-and-shoes-in-eighteenth-century-london',
    '32f7b422-dad6-5e10-8617-305ce4e0379d': '21-pacific-navigation-and-voyaging',
    'fb9cb14b-b121-4da7-a88d-d2ab80f915c5': '22-the-origins-of-weather-forecasting',
    '1beabd1f-7573-5aee-89c1-f85a5bbc9b34': '23-the-horseshoe-crab',
    'c8b101f0-309f-4488-bf91-1ba27610bf27': '24-the-long-view',
    '1c34e3d3-4d33-4f14-b9f8-a0af1c074fc2': '25-the-terracotta-army',
    'c8c67ae2-2fcc-4f98-8ecc-474b8ab4e50a': '26-why-are-so-few-tigers-man-eaters',
    'b56d0ee8-4d35-4f6f-b0c6-7f0034bb8362': '27-nature-works-polylactic-acid',
    '4ec97757-ff70-50a0-8ce0-3f65101b4a0e': '28-listening-to-the-ocean',
    '4af93fc7-94d0-4b3b-858a-ef9aaa868392': '29-skyscraper-farming',
    '11c1b328-7f5c-5aba-87d7-6e80a579591b': '30-marketing-and-the-information-age',
    'eff317d4-3539-5aef-88e5-48c8e6a6521d': '31-multiple-intelligences',
    '280253ac-d3b2-4ffa-9610-575898921399': '32-the-importance-of-law',
    'f5677547-0bf5-451f-a00b-38f3ace80989': '33-marketing-and-mind-control',
    '1c078bff-1dac-5b27-83e4-3409b2b20c6b': '34-sorry-who-are-you',
    '664cd028-f71d-469d-8aa3-93ed0928c671': '35-bestcom-considerate-computing',
    'b98c6797-4fc5-52d9-8bc1-91cb3481cd7b': '36-a-new-stage-in-the-study-and-teaching-of-history',
    'b728ae0a-e8ae-55ed-8207-6d3c26c55a0e': '37-computer-games',
    '78bea3b5-e207-51b0-8fd9-6fb412475c96': '38-art-and-engineering',
    '527ab881-aa59-5158-8eab-51454415d003': '39-inside-the-mind-of-a-fan',
    '68eadedc-a8b4-4627-a081-e8870251a514': '40-when-maps-were-made-for-the-public',
    '8301c30b-2f7e-435b-b172-dd8a1218b2c6': '41-can-we-prevent-the-poles-from-melting',
    'e297f950-f8b1-510a-8508-b398ab94ebd3': '42-crossing-the-threshold',
    '5cd2c851-83f2-41d1-89c6-08d0b689119b': '43-studies-in-the-history-of-art-and-visual-culture',
    '192192cb-8cd0-5fea-8d5e-6632101e2e10': '44-the-dingo-debate',
    'c5bcc96b-e03f-4026-bf59-431d6b067f5a': '45-what-makes-a-musical-expert',
    '3da11ebe-3430-455f-977f-8b45f4a95f71': '46-katherine-mansfield',
    '17040884-1af0-4104-8694-ee94bdf4050a': '47-jellyfish-the-dominant-species',
    '2d8e4da9-1945-5ad1-8a82-0081b9e5b905': '48-conformity',
    '21cce8bc-069a-4409-a570-ad89d1df90e2': '49-book-review-triumph-of-the-city',
    '4cb177f6-133c-5cc0-8012-eb364d1de9c6': '50-mammoth-kill',
    '1e4adbc9-4032-4be0-83f9-71dffb23ed24': '51-the-benefits-of-learning-an-instrument',
    '59fea739-f3ab-4472-a596-e9f06c443e2e': '52-traditional-maori-medicine',
    'd14626b4-b338-4f9b-9b8e-7c0d93a6744e': '53-keeping-the-water-away',
    '9c400e88-f76f-5406-818c-efc8bd65947a': '54-temperament',
    '149edd8a-3c24-45e3-b76e-0eb83ecce15c': '55-socotra-island',
    'bdfccfc4-c464-4691-95d8-82ce68c76653': '56-a-unique-golden-textile',
    '23544198-5bb4-5286-8f5b-a43bee825dfc': '57-how-should-reading-be-taught',
    '423d6dd6-8038-4d2b-979a-dcb36e8768ee': '58-this-is-very-much-the-story-of-a-story',
    '7d224b19-1aaa-57df-809f-4cf9b1cf5142': '59-intelligent-behaviour-in-birds',
    '48baa65b-7e98-48be-977c-767d556d9e32': '60-a-closer-examination-of-a-study-on-verbal-and-non-verbal-messages',
    '4df2929c-0590-5604-8be6-3ee72396a776': '61-answers-underground',
    '3ca44393-8611-4ae7-b9ca-273451676e7f': '62-from-a-novice-to-an-expert',
    'c97e1b72-e833-4954-84d4-5e6a8b9f1724': '63-sea-change-for-salinity',
    '1396b625-707c-57f9-8efa-738e2d265fcc': '64-bovids',
    'a3210714-c104-49fa-8e85-5313de66bfa8': '65-homo-ergaster',
    '016b9998-572d-40d1-a38e-fe074a5050e0': '66-flower-power',
    '855e2004-1867-52a7-8b20-874e6cfae7d2': '67-a-brief-history-of-humans-and-food',
    '435bca39-ffc7-4097-a2e0-f3a6b539a124': '68-the-aerofoil',
    '4738d64b-190c-4b03-93b4-d20511f267d0': '69-language-diversity',
    'f26e0ab4-d612-54e1-8c72-1fd2a6112319': '70-the-wonder-plant',
    '54bf9826-c9ef-4651-8731-c8860876da39': '71-the-development-of-television-and-its-introduction-in-britain',
    '6931b470-dc7b-4d69-89ae-bfb2c460e3ce': '72-communicating-styles-and-conflict',
    '321324b8-8b58-5a6c-8808-9ee87c2259ce': '73-new-perspectives-on-food-production',
    'ee2205ea-88a3-4fb7-b0b8-bf86b3d8eec0': '74-should-space-be-explored-by-robots-or-by-humans',
    'cdd6e63d-3fb3-4082-8a17-c1e8f15635dd': '75-saving-the-skink',
    '5fe70860-1e76-4744-9d9c-6dbfdcb15841': '76-australia-s-cane-toad-problem',
    '4339e49a-652f-41b7-b52c-04914a05d551': '77-a-great-leap-forward',
    '42eab54b-a10a-5015-8839-216ed491b72e': '78-keeping-the-fun-in-funfairs',
    'c6de3f05-9940-5051-8a4f-b31d663fc840': '79-starting-school-later-has-positive-effects-on-teens',
    '2303ce97-9f29-4e8f-9cc7-149433908549': '80-the-fashion-industry',
    'eb7b9c85-e236-5073-8b3f-43970430903d': '81-the-dark-side-of-the-technological-boom',
    '90e5b4b4-1962-4277-b44a-ba8e215a989f': '82-the-history-of-early-cinema',
    '9568d6bb-e010-5a19-828f-edc144d7a760': '83-science-and-the-stradivarius-uncovering-the-secret-of-quality',
    'c1381306-e108-553a-8974-2fc0d8eeed59': '84-when-people-are-deaf-to-music',
    'f57793b1-d74a-5d3d-8d91-aa67fc5f0940': '85-classifying-societies',
    'c15f50ab-2eb7-5fb1-8b80-e475e8a337fd': '86-what-is-an-unfair-advantage-in-sport',
    '7b23ae24-c6af-4028-8d56-00221324a950': '87-the-ability-to-communicate-using-language',
    'c2350e6a-6fbf-4b70-8176-30c19f63fb40': '88-the-history-of-the-pencil',
    '5216121c-599a-5016-8bba-a7045ab31309': '89-reading-passage-2',
    '39c20f1c-5dd9-5082-83bd-d3c54baed1d4': '90-the-power-of-persuasion',
    'e539968e-2c4e-4121-8cbf-c4df078dd928': '91-the-father-of-english-geology',
    '2a24c01b-6c50-46ad-b697-4e3a18f939b3': '92-orientation-of-birds',
    'db1cdff3-50de-4942-a0e2-32ff45fde9d0': '93-the-contradictions-of-tourism',
    'd5a37e57-47a9-4582-be4d-d138d89cdec5': '94-optimism-and-health',
    '136a75d7-4318-4b8d-9f9a-166e9d2d5693': '95-the-remarkable-power-of-placebos',
    '918c17d9-0a85-40f7-a7f3-5b9b72a2f379': '96-what-are-the-1-000-foods-to-eat-before-you-die',
    '9c36ff5c-493e-549e-876a-b90c8f9782dd': '97-the-origin-of-paper',
    '5f1cf76d-acc7-43c2-9e6e-eb4e2b876f55': '98-a-new-perspective-on-bacteria',
    'b125b10b-f81f-5f97-8fda-5bb96a8f0344': '99-the-placebo-effect',
    '768dd438-e198-4e50-b3c2-30403a24b580': '100-how-printed-books-began',
    '9d1033d0-567c-4cec-afdf-27f076a0e2fb': '101-global-warming-2003',
    '93493538-aaae-5d02-826e-555a834f8746': '102-the-fluoridation-controversy',
    '00cfe9bf-4274-5565-8118-32a00dc356f0': '103-the-history-of-the-chicken',
    'd11b2783-be63-571a-8664-005bd6f0fca9': '104-renewable-energy',
    '96805efc-7729-5d0a-8b27-caa4ca7f6dd9': '105-amateur-naturalists',
    'd2a647f7-2d29-4829-a58e-e5ce59aef712': '106-flying-tortoises',
    '9ad0eda4-9fed-481a-8e9f-290a5b596122': '107-the-hidden-lives-of-solitary-bees',
    '5b13b6a2-8436-4767-869d-b1f7c9e2f88f': '108-the-significant-role-of-mother-tongue-in-education',
    '0b8e732b-5ebe-5d40-8fe2-bdaf6f86880e': '109-what-lucy-taught-us',
    '60ba9c0d-f002-57f3-8f12-263761aea90e': '110-corporate-social-responsibility',
    'd80a1be3-6cdf-49b1-a6ae-8f22a50d8325': '111-childs-play-in-medieval-england',
    '1a9bc19b-545a-5062-8b3d-21ccc72510b3': '112-building-a-castle',
    '0eb40b99-504a-4458-9ba9-a08e22d8d8c0': '113-roller-coaster-the-great-fairground-attraction',
    '11074340-bdd5-4271-961a-45aed548e43e': '114-unlocking-the-mystery-of-dreams',
    '592f8751-f9f1-54b7-8f3b-3fecd73c9dfd': '115-advertising-needs-attention',
    '45dc2c30-524c-5b17-8466-18b59838cc92': '116-new-filter-promises-clean-water-for-millions',
    '0efc32f5-26ca-5f43-8572-3e262b9201ea': '117-yawning',
    '66309077-3139-44d9-b8fb-98831a5c599b': '118-economic-evolution',
    'f4cbe447-9f2e-5068-85fa-530a73954944': '119-saving-the-bittern',
    'c6fe5614-ccec-4b21-8a2c-f7b258285c37': '120-life-on-mars',
    'b3cec795-3200-5264-85a2-5975465c1619': '121-a-brief-introduction-to-pepper',
    '27871014-85d3-5ffa-8130-144cb57553f8': '122-the-gender-gap-in-new-zealand-s-high-school-examination-results',
    '60a8434e-6f74-5595-84fe-63397eccad26': '123-how-a-prehistoric-predator-took-to-the-skies',
    'e4cfd226-ac51-42d4-b50a-ae0405c08b8f': '124-caral-an-ancient-south-american-city',
    'feccd4b8-e09c-4643-b927-8eebc6f942d1': '125-how-to-be-happy',
    'fc0ec704-0f20-5f58-8c17-eab71c1cc05d': '126-the-communication-of-science',
    '1a90792b-a724-5627-8cf7-d779aff48fe4': '127-the-last-man-who-knew-everything',
    'de867048-0d6f-4497-b037-3dedb63d31e6': '128-trash-talk',
    '47918e00-9c76-5bea-8ecb-0de782f0c00f': '129-fear-of-the-unknown',
}
_DEFAULT_DIST = Path(__file__).resolve().parents[3] / 'frontend' / 'vanilla' / 'build'
_GLOSSARY_TAG = '<script type="application/json" id="reading-glossary">'


def has_passage_html(passage_id: object) -> bool:
    return str(passage_id) in _PASSAGES


@lru_cache(maxsize=64)
def _read_glossary(dist: Path, source: str) -> dict | None:
    path = dist / 'modules' / 'reading' / 'passage-assets' / (_PASSAGES[source] + '.html')
    try:
        markup = path.read_text(encoding='utf-8')
        document = json.loads(markup.split(_GLOSSARY_TAG, 1)[1].split('</script>', 1)[0])
    except (OSError, IndexError, ValueError):
        return None
    if not isinstance(document, dict) or document.get('sourceId') != source:
        return None
    return document


def passage_glosses(passage_id: object, body: str) -> list[dict] | None:
    """Only use these offsets when the reader's source text matches the HTML."""
    source = str(passage_id)
    if source not in _PASSAGES or not isinstance(body, str):
        return None
    document = _read_glossary(Path(os.getenv('FRONTEND_DIST', str(_DEFAULT_DIST))), source)
    if not document or document.get('checksum') != sha256(body.encode()).hexdigest():
        return None
    rows = []
    previous_end = 0
    for occurrence_id, start, end, pos, definition, translation in document['entries']:
        if type(start) is not int or type(end) is not int or start < previous_end:
            return None
        row = {'id': occurrence_id, 'start_char': start, 'end_char': end,
               'surface_form': body[start:end], 'part_of_speech': pos,
               'definition_en': definition, 'translation_uz': translation}
        if not is_verified_reading_gloss(body, row):
            return None
        rows.append(row)
        previous_end = end
    return rows or None
