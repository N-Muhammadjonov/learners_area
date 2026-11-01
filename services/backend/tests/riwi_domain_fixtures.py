"""Authored transport fixtures in the current release-pinned dictionary shape."""
RELEASE='rel-v1-'+'a'*24
SENSE='abababab-abab-4bab-8bab-abababababab'


def dictionary_row(sql,args,word,lexeme_id,definition,translation,example):
    if 'FROM dictionary_channels' in sql:
        return True,{'active_release_id':RELEASE,'previous_release_id':None}
    if 'SELECT lexeme_id FROM dictionary_entries' in sql:
        return True,{'lexeme_id':lexeme_id} if args==(RELEASE,word) else None
    if 'FROM dictionary_entries e JOIN dictionary_releases' in sql:
        payload={'lexeme_id':lexeme_id,'display_lemma':word,'part_of_speech':'adjective',
                 'senses':[{'sense_id':SENSE,'definition_en':definition,
                            'translations':[{'text':translation}],'examples':[{'text_en':example}]}]}
        return True,{'lexeme_id':lexeme_id,'payload':payload}
    return False,None
