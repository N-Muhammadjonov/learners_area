"""Ordered schema checks for main's six basic staff authoring forms."""
import math,re
from urllib.parse import urlsplit
from .auth_validation import length,typename
from .js_text import trim


def array_string(value):
 if isinstance(value,list):return ','.join(array_string(item) for item in value)
 if value is None:return ''
 if value is True:return 'true'
 if value is False:return 'false'
 if isinstance(value,dict):return '[object Object]'
 return str(value)


def number(value):
 if isinstance(value,list):value=array_string(value)
 if value is None:return 0
 if isinstance(value,str):
  value=trim(value)
  if not value:return 0
  if re.fullmatch(r'0[xX][a-fA-F0-9]+|0[bB][01]+|0[oO][0-7]+',value):return int(value,0)
 return float(value)

SCHEMAS={
 'passage': [('title','string',3,200),('bodyText','string',50,None),('difficultyLevel','string',2,10),('suggestedMinutes','coerce',5,90)],
 'grammar_topic':[('skillArea','enum',('writing','speaking'),None),('title','string',3,200),('explanation','string',5,None)],
 'grammar_exercise':[('promptText','string',3,None),('options','array',2,6),('correctOption','string',1,None),('explanation','string',3,None),('sourceSubmissionId','uuid?',None,None)],
 'listening_test':[('title','string',3,200),('audioType','enum',('video','audio','file','link'),None),('audioUrl','url?',None,None),('audioUploadId','uuid?',None,None),('transcript','string?',0,200000),('difficultyLevel','string',2,10)],
 'reading_question':[('type','enum',('true_false_not_given','yes_no_not_given','multiple_choice','short_answer'),None),('questionText','string',5,None),('options','array?',None,None),('correctAnswer','string',1,None),('evidenceQuote','string?',0,None),('explanation','string',1,None)],
 'listening_question':[('type','enum',('multiple_choice','short_answer'),None),('questionText','string',5,None),('options','array?',None,None),('correctAnswer','string',1,None),('explanation','string',1,None)],
}


def parse(body,mode):
 if not isinstance(body,dict):return None,'Expected object, received '+typename(body)
 out={}
 for field,kind,low,high in SCHEMAS[mode]:
  optional=kind.endswith('?');kind=kind.rstrip('?')
  if field not in body:
   if optional:continue
   if kind!='coerce':return None,'Required'
  value=body.get(field)
  if kind in ('string','uuid','url'):
   if not isinstance(value,str):return None,'Expected string, received '+typename(value)
   if low is not None and length(value)<low:return None,f'String must contain at least {low} character(s)'
   if high is not None and length(value)>high:return None,f'String must contain at most {high} character(s)'
   if kind=='uuid' and not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}',value,re.I):return None,'Invalid uuid'
   if kind=='url':
    try:
     uri=urlsplit(value)
     if not uri.scheme or not (uri.netloc or uri.path):return None,'Invalid url'
    except ValueError:return None,'Invalid url'
  elif kind=='enum':
   options=' | '.join("'"+x+"'" for x in low)
   if not isinstance(value,str):return None,'Expected '+options+', received '+typename(value)
   if value not in low:return None,'Invalid enum value. Expected '+options+", received '"+value+"'"
  elif kind=='array':
   if not isinstance(value,list):return None,'Expected array, received '+typename(value)
   if low is not None and len(value)<low:return None,f'Array must contain at least {low} element(s)'
   if high is not None and len(value)>high:return None,f'Array must contain at most {high} element(s)'
   for entry in value:
    if not isinstance(entry,str):return None,'Expected string, received '+typename(entry)
    if not entry:return None,'String must contain at least 1 character(s)'
  else:
   try:
    if field not in body:value=float('nan')
    else:value=number(value)
   except (TypeError,ValueError):value=float('nan')
   if math.isnan(value):return None,'Expected number, received nan'
   if not math.isfinite(value) or int(value)!=value:return None,'Expected integer, received float'
   if value<low:return None,f'Number must be greater than or equal to {low}'
   if value>high:return None,f'Number must be less than or equal to {high}'
   value=int(value)
  out[field]=value
 if mode in ('reading_question','listening_question') and out['type']=='multiple_choice' and len(out.get('options',[]))<2:return None,'multiple_choice needs at least 2 options'
 if mode=='listening_test' and bool(out.get('audioUrl'))==bool(out.get('audioUploadId')):return None,'Choose exactly one audio source'
 return out,None
