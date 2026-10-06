-- Learners Area Writing → Typing trainer.
-- Additive migration: keep legacy model-text typing history and add the
-- owner-supplied 30-text B1/B2 corpus + server-verifiable run metrics.

CREATE TABLE IF NOT EXISTS "typing_texts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_id" varchar(80) NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "language" varchar(10) DEFAULT 'en' NOT NULL,
  "word_count" integer NOT NULL,
  "difficulty" varchar(20),
  "topic" varchar(160),
  "provenance" varchar(200) NOT NULL,
  "publication_state" "publication_state" DEFAULT 'draft' NOT NULL,
  "publish_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "typing_texts_word_count_chk" CHECK ("word_count" >= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "typing_texts_external_id_uq" ON "typing_texts" ("external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "typing_texts_publication_idx" ON "typing_texts" ("publication_state","language");
--> statement-breakpoint

ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "run_token_id" uuid;
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "raw_wpm" numeric(6,1);
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "consistency" numeric(5,1);
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_correct" integer;
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_incorrect" integer;
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_extra" integer;
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "chars_missed" integer;
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "typing_runs" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "typing_runs_run_token_uq" ON "typing_runs" ("run_token_id") WHERE "run_token_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "typing_run_texts" ALTER COLUMN "model_text_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "typing_run_texts" ADD COLUMN IF NOT EXISTS "typing_text_id" uuid REFERENCES "typing_texts"("id") ON DELETE RESTRICT;
--> statement-breakpoint
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'typing_run_texts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%preset_seconds%'
  LOOP
    EXECUTE format('ALTER TABLE typing_run_texts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "typing_run_texts" ADD CONSTRAINT "typing_run_texts_preset_seconds_chk"
  CHECK ("preset_seconds" IS NULL OR "preset_seconds" IN (30,60,120,180));
--> statement-breakpoint
ALTER TABLE "typing_run_texts" DROP CONSTRAINT IF EXISTS "typing_run_texts_one_target_chk";
--> statement-breakpoint
ALTER TABLE "typing_run_texts" ADD CONSTRAINT "typing_run_texts_one_target_chk"
  CHECK (("model_text_id" IS NOT NULL) <> ("typing_text_id" IS NOT NULL));
--> statement-breakpoint

INSERT INTO "typing_texts"
  ("external_id","title","body","language","word_count","difficulty","topic","provenance","publication_state")
VALUES
(
  'la-typing-b1b2-01',
  $la$A Healthy Morning Routine$la$,
  $la$A good morning routine can make the whole day easier. Many students wake up, check their phones, and stay in bed for a long time. This can make them feel tired before the day has really started. A better routine does not need to be complicated. First, try to wake up at the same time every day. Open the window, drink a glass of water, and move your body for a few minutes. You can stretch, walk around the room, or do some simple exercises. After that, wash your face and eat a basic breakfast. Eggs, bread, fruit, or yogurt can give you energy for study. It is also useful to look at your plan for the day. Choose two or three important tasks instead of making a very long list. If possible, do not open social media during the first thirty minutes after waking up. A calm start can help you think clearly, feel more active, and begin your work with less stress.$la$,
  'en',
  164,
  'B1/B2',
  $la$A Healthy Morning Routine$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-02',
  $la$Learning English Every Day$la$,
  $la$Learning English becomes easier when you practise a little every day. You do not need to study for five hours at once. In fact, short and regular practice is often more useful. For example, you can spend fifteen minutes reading a simple article, ten minutes learning new words, and ten minutes listening to English. You can also speak to yourself about your day. This may feel strange at first, but it helps you become more confident. When you learn a new word, do not only write the translation. Try to make your own sentence with it. This helps you remember the word in a real situation. Watching short videos with English subtitles can also be helpful. If the video is too difficult, choose an easier one instead of stopping completely. The most important thing is consistency. Some days will be better than others, and that is normal. If you continue practising, your reading, listening, speaking, and writing will slowly improve over time.$la$,
  'en',
  162,
  'B1/B2',
  $la$Learning English Every Day$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-03',
  $la$Why Walking Is Good for You$la$,
  $la$Walking is one of the simplest ways to stay healthy. You do not need special equipment, an expensive gym, or a personal trainer. A comfortable pair of shoes is usually enough. Walking for thirty minutes a day can improve your mood, help your heart, and give you more energy. It is also a good activity for people who spend many hours sitting at school or at a computer. You can walk in the morning, after lunch, or in the evening. Some people enjoy walking alone because it gives them time to think. Others prefer walking with a friend or family member because they can talk at the same time. If thirty minutes feels difficult, begin with ten minutes and increase the time slowly. You can also choose stairs instead of a lift or walk to a nearby shop. Small choices can make a real difference. The best exercise is often the one that is easy enough to continue regularly for many months.$la$,
  'en',
  162,
  'B1/B2',
  $la$Why Walking Is Good for You$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-04',
  $la$My Ideal Study Place$la$,
  $la$Everyone studies better in a different environment, but a good study place usually has a few important things. It should be quiet enough for concentration and comfortable enough for long study sessions. A simple desk and chair are often better than studying in bed because the brain connects the bed with sleep. Good light is also important. Natural light from a window is ideal during the day, while a desk lamp can help in the evening. I also think the study area should be clean. Too many books, cables, clothes, or other objects can make the mind feel busy. Before studying, I like to prepare everything I need, such as a notebook, pens, water, and my laptop. I also put my phone away or turn off unnecessary notifications. Sometimes soft background music helps, but music with lyrics can be distracting. A good study place does not have to be beautiful or expensive. It only needs to help you focus and make studying easier.$la$,
  'en',
  163,
  'B1/B2',
  $la$My Ideal Study Place$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-05',
  $la$The Value of Reading Books$la$,
  $la$Reading books is a useful habit for students of all ages. Books can teach us new information, improve our vocabulary, and help us understand different ideas. Reading also trains the mind to stay focused for a longer time. This is especially important today because many people spend hours watching short videos and quickly moving from one post to another. At first, reading for thirty or forty minutes may feel difficult. A simple way to start is to read five or ten pages each day. Choosing the right book is also important. If a book is too difficult or boring, you may lose interest quickly. It is better to begin with a topic you already enjoy. Students who are learning English can read short stories or easy non-fiction books. They do not need to understand every word. The main goal is to follow the general meaning. Over time, regular reading can improve language skills, concentration, imagination, and even writing ability.$la$,
  'en',
  159,
  'B1/B2',
  $la$The Value of Reading Books$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-06',
  $la$Using Social Media Wisely$la$,
  $la$Social media can be useful, but it can also take a lot of time. People use it to talk to friends, follow news, learn new skills, and enjoy entertainment. However, it is easy to spend much longer online than planned. A person may open an app for five minutes and still be scrolling one hour later. One way to control this habit is to decide when to use social media. For example, you can avoid it during study time and check it only after finishing an important task. Turning off unnecessary notifications can also help because every sound or message can break your concentration. Another useful idea is to stop following pages that do not give you anything valuable. You can replace some entertainment accounts with educational ones. It is not necessary to completely delete every app. The main goal is to use technology on purpose instead of using it automatically. Social media should be a tool in your life, not something that controls your attention.$la$,
  'en',
  166,
  'B1/B2',
  $la$Using Social Media Wisely$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-07',
  $la$A Weekend in the Countryside$la$,
  $la$Spending a weekend in the countryside can be a pleasant break from a busy city. The air is often cleaner, the streets are quieter, and there is usually less traffic. In the morning, people may wake up to the sound of birds instead of cars. A countryside weekend can include simple activities such as walking, helping in the garden, riding a bicycle, or having tea outside. It is also a good chance to spend time with family without constantly checking a phone. Some people think the countryside is boring because there are fewer shops, cinemas, and restaurants. However, this slower lifestyle can be relaxing. It gives the mind time to rest. The countryside also teaches people to enjoy simple things, such as fresh food, open space, and quiet evenings. Of course, living there permanently is different from visiting for a weekend. Still, a short visit can help people return to work or study feeling calmer and more refreshed.$la$,
  'en',
  158,
  'B1/B2',
  $la$A Weekend in the Countryside$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-08',
  $la$Why Sleep Matters for Students$la$,
  $la$Sleep is very important for students because the brain needs rest to work well. When people do not sleep enough, they often find it harder to concentrate, remember information, and control their mood. Some students stay awake late because they want more time to study. However, studying when the brain is extremely tired is not always effective. A better plan is to finish important work earlier and try to sleep at a regular time. Most young adults need several hours of good-quality sleep every night. The bedroom should be dark, quiet, and comfortable. Using a phone in bed can make sleeping more difficult because bright screens and exciting content keep the mind active. It can help to stop using screens thirty or sixty minutes before bedtime. Reading a simple book, preparing clothes for the next day, or writing a short plan can be calmer choices. Good sleep is not wasted time. It is part of successful learning and healthy daily life.$la$,
  'en',
  161,
  'B1/B2',
  $la$Why Sleep Matters for Students$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-09',
  $la$Saving Money as a Student$la$,
  $la$Saving money can be difficult for students because they often have limited income. However, even small amounts can become useful over time. The first step is to understand where your money goes. You can write down your spending for one or two weeks and divide it into categories such as food, transport, study, and entertainment. After that, it becomes easier to see unnecessary expenses. For example, buying a drink or snack every day may seem cheap, but the total cost at the end of the month can be surprising. Students can also compare prices before buying something and avoid shopping when they are bored. It is useful to save a fixed amount as soon as money arrives instead of waiting to see what is left later. Saving does not mean never enjoying life. It means making choices. A simple budget can help students prepare for important needs, reduce stress, and learn financial habits that will be valuable in the future.$la$,
  'en',
  160,
  'B1/B2',
  $la$Saving Money as a Student$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-10',
  $la$Learning from Mistakes$la$,
  $la$Making mistakes is a normal part of learning. Students sometimes feel embarrassed when they give a wrong answer, pronounce a word incorrectly, or receive a low score. However, mistakes can show exactly what needs more practice. For example, if you often make the same grammar error, you can write several correct examples and review them later. If you miss questions in a reading test, you can study why your answer was wrong instead of only looking at the correct letter. It is important to separate a mistake from your identity. One bad result does not mean you are a bad student. Progress usually happens slowly and includes many small failures. Teachers can help by giving clear feedback, but students also need to review that feedback carefully. The most useful question is not, “Why am I bad at this?” but, “What can I do differently next time?” People who learn from mistakes become more independent, patient, and confident because they understand that improvement is a process.$la$,
  'en',
  165,
  'B1/B2',
  $la$Learning from Mistakes$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-11',
  $la$Cooking at Home$la$,
  $la$Cooking at home has many advantages. It can be cheaper than eating at restaurants, and it gives you more control over what you eat. When you prepare your own food, you can choose fresh ingredients and reduce the amount of oil, sugar, or salt. Cooking is also a practical skill that becomes more valuable when people start living independently. Beginners do not need to make difficult meals. Simple dishes such as rice, eggs, soup, pasta, salads, and baked vegetables are enough to start. It is useful to learn a few basic recipes and repeat them until they become easy. Planning meals before going shopping can also save both money and time. Of course, cooking every day requires effort, and sometimes people are too busy. In that case, preparing extra food for the next day can help. Cooking can even become an enjoyable activity. Some people listen to music or cook with family members. A simple homemade meal can be healthy, affordable, and satisfying.$la$,
  'en',
  163,
  'B1/B2',
  $la$Cooking at Home$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-12',
  $la$The Importance of Good Friends$la$,
  $la$Good friends can make life happier and easier. A real friend is not only someone who spends time with you when everything is going well. Good friends also listen when you have a problem, give honest advice, and respect your feelings. Friendship is a two-way relationship, so both people need to make an effort. This includes keeping promises, apologising after mistakes, and being happy when the other person succeeds. It is normal for friends to disagree sometimes. A healthy friendship does not require two people to have the same opinion about everything. The important thing is how they communicate during a disagreement. Shouting, insulting, or trying to control another person can damage trust. Good friends can also encourage positive habits. For example, they may study together, exercise, or remind each other about goals. Quality is usually more important than quantity. Having a few people you can trust may be more valuable than knowing hundreds of people online but feeling alone when you need real support.$la$,
  'en',
  165,
  'B1/B2',
  $la$The Importance of Good Friends$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-13',
  $la$Studying with a Plan$la$,
  $la$A study plan can help students use their time more effectively. Without a plan, it is easy to spend a long time deciding what to do and then begin too late. A useful plan does not need to include every minute of the day. It can simply show the main tasks and the time available for them. First, choose the most important subjects or skills. Then divide large tasks into smaller steps. For example, “study English” is too general, while “read one passage and review ten words” is much clearer. It is also helpful to include short breaks because concentration becomes weaker after a long period of work. Some students prefer studying in the morning, while others work better in the afternoon or evening. The best schedule is one that matches your real life. At the end of the day, look at what you completed and adjust the next plan if necessary. A plan should guide you, not make you feel guilty when something changes.$la$,
  'en',
  165,
  'B1/B2',
  $la$Studying with a Plan$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-14',
  $la$Public Transport in Cities$la$,
  $la$Public transport is an important part of life in many cities. Buses, trains, and underground systems help large numbers of people travel without using private cars. This can reduce traffic and pollution, especially when the service is reliable and affordable. Public transport is also useful for students and workers who cannot or do not want to drive. However, there can be problems. During busy hours, buses and trains may become crowded. Delays can also cause people to arrive late at school or work. A good transport system should be clean, safe, frequent, and easy to understand. Clear maps and digital information can help passengers plan their journeys. Cities can also create special lanes for buses so they do not spend too much time in traffic. Although public transport may not be perfect, improving it can make city life easier for everyone. When more people choose buses or trains, roads can become less crowded and the environment can benefit as well.$la$,
  'en',
  160,
  'B1/B2',
  $la$Public Transport in Cities$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-15',
  $la$Learning a New Skill$la$,
  $la$Learning a new skill can be exciting, but the beginning is often difficult. Whether a person wants to learn coding, cooking, drawing, chess, or a new language, the first steps usually feel slow. Many beginners make the mistake of trying to learn everything at the same time. A better method is to focus on one small skill and practise it regularly. For example, someone learning to type faster can first work on correct finger position before trying to increase speed. It is also useful to track progress. Small improvements may be difficult to notice from day to day, but they become clear after several weeks. Beginners should expect to make mistakes and sometimes feel confused. This does not mean they are failing. It usually means the brain is learning something unfamiliar. Finding a good teacher, course, book, or practice system can save time. Most importantly, regular practice is more powerful than occasional motivation. Skill grows through repetition, patience, and useful feedback.$la$,
  'en',
  161,
  'B1/B2',
  $la$Learning a New Skill$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-16',
  $la$A Simple Digital Detox$la$,
  $la$Many people spend several hours a day looking at screens. Phones and computers are useful for work, study, communication, and entertainment, but too much screen time can make the mind feel tired. A digital detox does not mean giving up technology forever. It can simply mean taking a planned break. For example, you can choose one evening a week when you do not use social media. During that time, you can walk, read, talk with family, clean your room, or prepare for the next day. Another idea is to keep the phone away from the table during meals. This makes conversations more natural and helps people pay attention to their food. You can also remove apps from the home screen if you open them automatically. The goal is not to hate technology. The goal is to control when and why you use it. Even a short break can improve concentration and remind you that many enjoyable activities do not require a screen.$la$,
  'en',
  162,
  'B1/B2',
  $la$A Simple Digital Detox$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-17',
  $la$The Benefits of Learning to Type$la$,
  $la$Typing is a useful skill for students because much of modern study happens on computers. Faster typing can save time when writing essays, taking notes, answering online questions, or doing research. However, speed is not the only goal. Accuracy is equally important. A person who types very quickly but makes many mistakes may spend extra time correcting them. Beginners should first learn where the keys are and try to use the correct fingers. It can feel slower at the beginning, but this method helps build good habits. Short daily practice is usually better than one very long session each week. Five or ten minutes can be enough if the practice is focused. Students can copy simple texts, type common words, and gradually work with longer paragraphs. They should also sit comfortably and keep their wrists relaxed. Over time, typing can become automatic. When students no longer need to search for every key, they can focus more on their ideas and less on the keyboard.$la$,
  'en',
  164,
  'B1/B2',
  $la$The Benefits of Learning to Type$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-18',
  $la$Keeping Your Room Organised$la$,
  $la$A clean and organised room can make daily life easier. When everything has a place, you spend less time looking for books, clothes, chargers, or important papers. A messy room can also make some people feel stressed because there are many things competing for attention. The best way to organise a room is not to clean everything once and then forget about it. Small daily habits are more effective. For example, make the bed in the morning, put dirty clothes in one place, and return books to the shelf after using them. It is also helpful to remove things you no longer need. Old papers, broken items, and unused objects can take up valuable space. You do not need to buy expensive boxes or furniture. Simple containers and labels can be enough. Spending five or ten minutes cleaning at the end of the day can prevent a large mess from developing. An organised room can make studying, sleeping, and preparing for the day more comfortable.$la$,
  'en',
  165,
  'B1/B2',
  $la$Keeping Your Room Organised$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-19',
  $la$Helping Others in Small Ways$la$,
  $la$Helping other people does not always require money or a lot of free time. Small actions can still make a difference. For example, you can help a classmate understand a difficult topic, carry something heavy for an older person, or listen to a friend who is having a bad day. At home, helping with cleaning, shopping, or cooking can reduce stress for family members. These actions may seem simple, but they show care and responsibility. Helping others can also improve your own mood because it gives a sense of purpose. However, it is important to help in a healthy way. You do not need to say yes to every request or ignore your own important responsibilities. Good support should be reasonable and respectful. Sometimes the best help is not solving another person’s problem but encouraging them to solve it themselves. Communities become stronger when people are willing to support one another. Kindness is often remembered much longer than we expect, even when the action itself is very small.$la$,
  'en',
  168,
  'B1/B2',
  $la$Helping Others in Small Ways$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-20',
  $la$Using the Internet for Learning$la$,
  $la$The internet gives students access to a huge amount of information. They can watch lessons, read articles, use dictionaries, practise tests, and learn from teachers in other countries. This makes education more flexible than it was in the past. However, having a lot of information does not always mean learning well. Students need to choose reliable sources and avoid spending all their time collecting videos and notes without actually practising. It is useful to have a clear purpose before going online. For example, instead of searching “learn English,” a student can search for “B1 listening practice about travel.” This saves time and gives more useful results. Students should also be careful with information from unknown websites because not everything online is correct. Comparing two or three sources can help. Another problem is distraction. Educational websites are often only one click away from entertainment. A simple plan, a timer, and a small number of trusted resources can make online learning much more effective.$la$,
  'en',
  162,
  'B1/B2',
  $la$Using the Internet for Learning$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-21',
  $la$A Day Without Complaining$la$,
  $la$Complaining is a normal part of life, but doing it too often can affect our mood. People complain about weather, traffic, homework, family, money, and many other things. Sometimes a complaint is necessary because it helps us explain a real problem. However, repeating the same negative thought many times does not always improve the situation. One useful exercise is to try spending one day without unnecessary complaining. When something goes wrong, you can ask, “Can I change this?” If the answer is yes, take a small action. If the answer is no, try to accept it and focus on something else. This does not mean pretending that every problem is good. It simply means using energy in a more useful way. You may also notice how often negative language appears in everyday conversations. Replacing one complaint with one practical idea can change the tone of a situation. A calmer attitude can help people solve problems more clearly and communicate better with others.$la$,
  'en',
  162,
  'B1/B2',
  $la$A Day Without Complaining$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-22',
  $la$The Importance of Drinking Water$la$,
  $la$Water is essential for the body, but many people forget to drink enough during the day. When a person is busy studying or working, they may not notice thirst until they already feel tired or have a headache. Keeping a bottle of water nearby can make drinking regularly much easier. Some people find plain water boring, so they add a slice of lemon, cucumber, or fruit for a little flavour. It is also useful to drink more water during hot weather or after exercise. Sweet drinks can be enjoyable, but they are not always a good replacement for water because they may contain a lot of sugar. There is no single perfect amount for every person because needs can change depending on weather, activity, and body size. A simple habit is to drink some water after waking up, with meals, and during study breaks. Good hydration supports concentration, energy, and general health, so it is a small habit that can have useful results.$la$,
  'en',
  163,
  'B1/B2',
  $la$The Importance of Drinking Water$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-23',
  $la$Learning to Speak with Confidence$la$,
  $la$Many English learners understand grammar and vocabulary but still feel nervous when they speak. This is common because speaking happens quickly, and there is less time to think. Confidence usually grows through practice, not by waiting until your English becomes perfect. One useful method is to speak about simple topics every day. You can describe your room, explain what you did yesterday, or talk about your plans for the weekend. Recording yourself can also help. When you listen again, you may notice pronunciation problems or places where you pause too often. It is important not to focus on every small mistake at the same time. Choose one thing to improve, such as speaking more slowly or using complete sentences. Talking with a supportive partner can also make practice easier. Remember that communication is the main goal. Native speakers also pause, change words, and correct themselves. Speaking clearly and confidently is more important than trying to sound perfect in every sentence.$la$,
  'en',
  160,
  'B1/B2',
  $la$Learning to Speak with Confidence$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-24',
  $la$Why People Enjoy Travelling$la$,
  $la$People travel for many different reasons. Some want to relax, while others enjoy seeing new places and learning about different cultures. Travelling can introduce people to new food, languages, traditions, and ways of life. Even a short trip to another city can be interesting because daily routines change. Travelling can also teach practical skills. People learn how to plan, manage money, read maps, solve small problems, and communicate with strangers. Of course, travel can be expensive and sometimes stressful. Flights may be delayed, hotels may not look like the pictures, and plans can change because of weather. Good preparation can reduce some of these problems. It is useful to check important documents, transport, accommodation, and basic costs before leaving. Travellers should also respect local customs and rules. The best trips are not always the most expensive ones. Sometimes a simple journey with good company can create stronger memories than a luxury holiday with a very busy schedule.$la$,
  'en',
  157,
  'B1/B2',
  $la$Why People Enjoy Travelling$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-25',
  $la$A Balanced Approach to Exercise$la$,
  $la$Exercise is important for health, but people do not need to train like professional athletes. A balanced routine can include strength, movement, and rest. For beginners, three or four short workouts each week may be enough. Simple exercises such as squats, push-ups, walking, stretching, and light running can improve fitness over time. The body also needs recovery. Training hard every day without rest can cause tiredness or injury. Sleep and food are part of exercise too because muscles need energy and time to recover. Beginners should avoid comparing themselves with people who have trained for many years. Progress is personal. It can be measured by doing more repetitions, walking farther, feeling less tired, or simply staying consistent. It is also important to choose activities you enjoy. If you hate running, you may prefer cycling, swimming, or team sports. A good exercise plan should support daily life, not make a person feel exhausted all the time.$la$,
  'en',
  155,
  'B1/B2',
  $la$A Balanced Approach to Exercise$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-26',
  $la$The Habit of Writing a Daily Journal$la$,
  $la$Writing a short journal can be a useful daily habit. You do not need to write several pages or use difficult language. Five or ten sentences can be enough. A journal gives you a place to record what happened, what you learned, and how you felt. It can also help you notice patterns in your life. For example, you may discover that you study better in the morning or feel more stressed when you sleep late. English learners can use journaling as writing practice. They can describe simple events and try to use new vocabulary. The goal should not be perfect grammar in every sentence. First, focus on expressing ideas clearly. Later, you can review one paragraph and correct a few mistakes. Some people also write three things they are thankful for each day. This can help them pay attention to positive moments. A journal is private, simple, and flexible. Over time, it becomes a record of progress, problems, decisions, and everyday memories.$la$,
  'en',
  163,
  'B1/B2',
  $la$The Habit of Writing a Daily Journal$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-27',
  $la$Why Time Management Is Important$la$,
  $la$Time management is not about filling every minute with work. It is about using time for the things that matter most. Students often feel busy because they have classes, homework, family responsibilities, social media, and personal goals. Without planning, small tasks can take over the whole day. A useful first step is to decide what is important and what can wait. Some tasks are urgent, while others are important for long-term progress. For example, preparing for tomorrow’s test may be urgent, while practising English every day is important over many months. A calendar or simple to-do list can help. It is also useful to estimate how long a task will really take. People often plan too much and then feel disappointed. Leaving some free time makes a schedule more realistic. Rest should also be included. Good time management allows people to work, sleep, exercise, and relax without feeling that everything is happening at the same time.$la$,
  'en',
  156,
  'B1/B2',
  $la$Why Time Management Is Important$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-28',
  $la$The Benefits of Learning with a Partner$la$,
  $la$Studying with a partner can make learning more interesting and more active. A good study partner can ask questions, explain ideas, and help you stay responsible for your goals. For language learning, a partner is especially useful because both students can practise speaking and listening. They can choose a topic, speak for two minutes, and then give simple feedback. Partners can also test each other on vocabulary or compare answers after a reading exercise. However, studying together only works well when both people actually want to study. If the session becomes mostly chatting, it may not be useful. It helps to decide the goal before starting. For example, you can agree to study for forty minutes and then take a ten-minute break. Partners should also be respectful. One person should not make the other feel embarrassed about mistakes. The best study partners encourage improvement without creating unnecessary pressure. When used correctly, shared study can improve motivation, understanding, and confidence.$la$,
  'en',
  159,
  'B1/B2',
  $la$The Benefits of Learning with a Partner$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-29',
  $la$Building a Better Evening Routine$la$,
  $la$A good evening routine can make the next morning easier. Many people finish the day by watching videos or checking social media until they fall asleep. This can make it difficult to sleep well and may leave them tired the next day. A calmer routine can begin thirty or sixty minutes before bedtime. First, finish important messages and put the phone away if possible. Then prepare a few things for the next day, such as clothes, books, or a bag. This reduces morning stress. You can also write down tomorrow’s main tasks so you do not keep thinking about them in bed. A warm shower, light stretching, or reading a book can help the body relax. Try to avoid very heavy meals or too much caffeine late in the evening. It is not necessary to follow the routine perfectly every night. The goal is to create a clear signal that the day is ending. Regular evening habits can improve sleep and make mornings more organised.$la$,
  'en',
  165,
  'B1/B2',
  $la$Building a Better Evening Routine$la$,
  'learners-area-owner-supplied',
  'published'
),
(
  'la-typing-b1b2-30',
  $la$Why Simple Goals Work Better$la$,
  $la$People often set large goals because they feel exciting. A student may decide to study five hours every day, read fifty books, or become fluent in English in a very short time. The problem is that large goals can become difficult to follow when motivation falls. Smaller goals are often easier to continue. For example, reading five pages every day may not sound impressive, but after one year it becomes a large amount of reading. The same idea works for exercise, language learning, saving money, and many other habits. A good goal should be clear and realistic. “Improve my English” is too general, but “learn ten useful words and review them tonight” is specific. It is also helpful to focus on the action instead of only the final result. You cannot control exactly when you will become fluent, but you can control whether you practise today. Small actions repeated for a long time often produce stronger results than short periods of extreme effort.$la$,
  'en',
  163,
  'B1/B2',
  $la$Why Simple Goals Work Better$la$,
  'learners-area-owner-supplied',
  'published'
)
ON CONFLICT ("external_id") DO NOTHING;
