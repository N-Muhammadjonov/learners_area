"""Authored isolated fixtures for the real ASGI/native-contract integration gate."""
from uuid import uuid5, NAMESPACE_URL

def id(name): return str(uuid5(NAMESPACE_URL,'learners-area-browser-probe:'+name))


async def seed(con, uid, password_hash):
    for role in ('teacher','other-teacher','other-student','pending'):
        await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,$2,$3,$4,$5,$6,'en')",id(role),role,role+'@browser.example.test',password_hash,'teacher' if 'teacher' in role else 'student','pending' if role=='pending' else 'active')
    await con.execute('INSERT INTO teacher_student_links(teacher_user_id,student_user_id,assigned_by_user_id) VALUES($1,$2,$1)',id('teacher'),uid)
    await con.execute("INSERT INTO courses(id,slug,title) VALUES($1,'ielts','Isolated IELTS course')",id('course'))
    await con.execute("INSERT INTO course_modules(id,course_id,slug,title,\"order\") VALUES($1,$2,'module','Isolated module',1)",id('module'),id('course'))
    await con.execute('INSERT INTO units(id,module_id,slug,title,"order") VALUES($1,$2,\'unit\',\'Isolated unit\',1)',id('unit'),id('module'))
    for area in ('listening','reading','grammar'):
        await con.execute('''INSERT INTO lessons(id,unit_id,slug,title,"order",learning_area,publication_state,default_state,teacher_notes)
          VALUES($1,$2,$3,$4,1,$5,'published','available','Teacher notes from lesson')''',id(area+'-lesson'),id('unit'),area+'-fixture',area+' lesson',area)
        await con.execute("INSERT INTO lesson_blocks(id,lesson_id,position,type,quiz_question_type,quiz_payload) VALUES($1,$2,0,'quiz','mcq_single',$3::jsonb)",id(area+'-quiz'),id(area+'-lesson'),{'prompt':'Choose the authored answer','options':['First','Second'],'answer':'First','explanation':'Secret until feedback'})
    await con.execute("INSERT INTO lesson_notes(user_id,lesson_id,body) VALUES($1,$2,'Only the current learner note')",uid,id('listening-lesson'))
    await con.execute("INSERT INTO grammar_topics(id,skill_area,title,explanation,\"order\",publication_state) VALUES($1,'writing','Article topic','Authored explanation',1,'published')",id('topic'))
    for name,owner in (('exercise',None),('private-exercise',id('other-student'))):
        await con.execute('''INSERT INTO grammar_exercises(id,topic_id,"order",prompt_text,options,correct_option,explanation,source_owner_user_id)
          VALUES($1,$2,1,'Choose the correct article',$3::jsonb,'an','Private key explanation',$4)''',id(name),id('topic'),['a','an'],owner)
    for name,lesson in (('video',None),('lesson-video',id('listening-lesson'))):
        await con.execute("INSERT INTO video_lessons(id,lesson_id,title,provider,video_id,created_by_user_id,duration_seconds,publication_state,notes) VALUES($1,$2,'Authored video','youtube',$4,$3,120,'published','Media notes')",id(name),lesson,id('teacher'),'fixture0001' if name=='video' else 'fixture0002')
        await con.execute("INSERT INTO video_lesson_questions(video_lesson_id,stage,prompt,accepted_answers,position) VALUES($1,'comprehension','What happened?',$2::jsonb,0)",id(name),['Secret accepted answer'])
    await con.execute("INSERT INTO general_reading_sets(id,source_ref,title,publication_state) VALUES($1,'browser:reading-set','Authored Reading set','published')",id('reading-set'))
    for n,count in ((1,14),(2,13),(3,13)):
        await con.execute("INSERT INTO reading_passages(id,title,body_text,publication_state,suggested_minutes) VALUES($1,$2,'A real authored passage for the isolated integration fixture.','published',20)",id('passage'+str(n)),'Passage '+str(n))
        await con.execute("INSERT INTO general_reading_passages(set_id,passage_id,passage_no,reading_mode) VALUES($1,$2,$3,'general_practice')",id('reading-set'),id('passage'+str(n)),n)
        for i in range(1,count+1):
            await con.execute('''INSERT INTO reading_questions(id,passage_id,"order",type,type_code,question_text,correct_answer,explanation)
              VALUES($1,$2,$3,'short_answer','short_answer','What is the authored word?','fixture','Evidence for the authored answer')''',id(f'reading-{n}-{i}'),id('passage'+str(n)),i)
    for product,count in (('academic',40),('general',3),('mcq',5)):
        test = id('listening-'+product)
        await con.execute("INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,audio_url,publication_state,program_ref,program_ordinal) VALUES($1,$2,$3,'audio','/api/resources/listening/fixture.mp3','published',$4,$5)",test,id('teacher'),'Authored '+product,'listening-mcq-program' if product=='mcq' else None,1 if product=='mcq' else None)
        questions = []
        for i in range(1,count+1):
            await con.execute('''INSERT INTO listening_questions(id,test_id,"order",type,type_code,question_text,options,correct_answer,explanation)
              VALUES($1,$2,$3,'multiple_choice','mcq_single','Choose the authored option',$4::jsonb,'A','Evidence for option A')''',id(f'listening-{product}-{i}'),test,i,['A','B'])
            questions.append({'number':i,'section':(i-1)//10+1 if product=='academic' else 1,'kind':'mcq','text':'Choose the authored option','instruction':'Choose one answer.','options':['A','B'],'key':'A','alternatives':[],'evidence':{'at':0,'end':5,'why':'Evidence for option A'}})
        sections = [{'number':i,'title':'Part '+str(i),'transcript':'Authored transcript for study.'} for i in (range(1,5) if product=='academic' else [1])]
        package = {'testId':product,'collection':product,'audio':{'path':'audio.mp3','durationSec':120},'sections':sections,'questions':questions,'keyword1':[],'keyword2':[],'vocabulary':[]}
        await con.execute("INSERT INTO listening_packages(test_id,source_id,payload,audio_object_key,source_hash) VALUES($1,$2,$3::jsonb,'listening/fixture.mp3',$4)",test,'browser:'+product,package,'a'*64)
    await con.execute("INSERT INTO writing_prompts(id,task_type,category,prompt,target_word_count,publication_state) VALUES($1,'task2','Opinion','Discuss this authored question in your own words.',250,'published')",id('writing-prompt'))
    await con.execute("INSERT INTO writing_submissions(id,user_id,prompt_id,content,word_count) VALUES($1,$2,$3,'My saved draft.',3)",id('submission'),uid,id('writing-prompt'))
    await con.execute("INSERT INTO writing_lessons(id,title,category,body,publication_state) VALUES($1,'Authored writing lesson','structure','Authored writing instructions.','published')",id('writing-lesson'))
    await con.execute("INSERT INTO live_classes(id,course_id,teacher_user_id,title,scheduled_at,duration_minutes,status) VALUES($1,$2,$3,'Authored live class',now()+interval '1 day',60,'upcoming')",id('live'),id('course'),id('teacher'))
    await con.execute("INSERT INTO speaking_materials(id,created_by_user_id,category,title,primary_type,primary_url,publication_state) VALUES($1,$2,'part1','Authored speaking material','link','https://example.test/material','published')",id('speaking-material'),id('teacher'))
    await con.execute("INSERT INTO speaking_attempts(id,user_id,part,status,transcript,transcript_origin) VALUES($1,$2,'part1','submitted','My manual transcript from the saved recording.','manual')",id('speaking-attempt'),uid)
