"""Canonical dictionary Entry shaped exactly like the TypeScript Zod schema."""
import uuid

def dictionary_entry(release,lexeme_id,word='word'):
    sense=str(uuid.uuid5(uuid.NAMESPACE_DNS,lexeme_id+'sense'))
    translation=str(uuid.uuid5(uuid.NAMESPACE_DNS,lexeme_id+'translation'))
    return {'schema_version':'1.0.0','release_id':release,'lexeme_id':lexeme_id,
        'display_lemma':word,'normalized_search_form':word.lower(),
        'lexical_type':'word','part_of_speech':'noun','homograph_group':None,
        'is_satellite':False,'pronunciations':[],'forms':[],
        'senses':[{'sense_id':sense,'definition_en':'Example definition',
          'definition_uz':'Namunaviy izoh','translations':[{'translation_id':translation,'text':'Soz','order':0}],
          'examples':[]}], 'relations':[],'collocations':[],
        'attribution':[{'source_name':'Learners Area','snapshot_id':'custom', 'creator':'Learners Area',
            'source_url':'','license_reference':'Owned','license_url':'','attribution_text':'Custom'}]}
