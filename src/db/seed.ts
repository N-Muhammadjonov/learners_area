import { eq } from "drizzle-orm";
import { db } from "./client";
import {
  users,
  courses,
  courseModules,
  units,
  lessons,
  lessonProgress,
  enrollments,
  onboardingProfiles,
  writingPrompts,
  writingSubmissions,
  writingFeedback,
  lexemes,
  userVocabulary,
  activityEvents,
  readingPassages,
  readingQuestions,
  grammarTopics,
  grammarExercises,
  liveClasses,
  speakingMaterials,
  materialBlocks,
  listeningTests,
  listeningQuestions,
} from "./schema";
import { hashPassword } from "../lib/auth/password";

async function main() {
  const already = await db.query.courses.findFirst({ where: eq(courses.slug, "ielts") });
  if (already) {
    console.log("Seed already applied (courses.ielts exists) — skipping. Delete the DB and re-run to reseed.");
    process.exit(0);
  }

  console.log("Seeding Learners Area demo data...");

  // --- Users --------------------------------------------------------------
  const [admin] = await db
    .insert(users)
    .values({
      name: "Aziza Yusupova",
      email: "admin@learnersarea.uz",
      passwordHash: await hashPassword("Admin12345!"),
      role: "admin",
      isOwner: true, // the platform owner — full control over everyone's content
      locale: "uz",
      onboardingCompletedAt: new Date(),
    })
    .returning();

  const [teacher] = await db
    .insert(users)
    .values({
      name: "Bekzod Rustamov",
      email: "teacher@learnersarea.uz",
      passwordHash: await hashPassword("Teacher12345!"),
      role: "teacher",
      locale: "uz",
      onboardingCompletedAt: new Date(),
    })
    .returning();

  const [teacher2] = await db
    .insert(users)
    .values({
      name: "Malika Nazarova",
      email: "teacher2@learnersarea.uz",
      passwordHash: await hashPassword("Teacher12345!"),
      role: "teacher",
      locale: "uz",
      onboardingCompletedAt: new Date(),
    })
    .returning();

  const [demoStudent] = await db
    .insert(users)
    .values({
      name: "Dilnoza Karimova",
      email: "demo.student@learnersarea.uz",
      passwordHash: await hashPassword("Student12345!"),
      role: "student",
      locale: "uz",
      onboardingCompletedAt: new Date(),
    })
    .returning();

  const [newStudent] = await db
    .insert(users)
    .values({
      name: "Jasur Tashkentov",
      email: "new.student@learnersarea.uz",
      passwordHash: await hashPassword("Student12345!"),
      role: "student",
      locale: "uz",
    })
    .returning();

  if (!admin || !teacher || !teacher2 || !demoStudent || !newStudent) throw new Error("User seeding failed");

  await db.insert(onboardingProfiles).values({
    userId: demoStudent.id,
    currentLevel: "B2",
    currentBand: 6.0,
    targetBand: 7.5,
    examDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
    dailyStudyMinutes: 90,
    strongestSkill: "reading",
    weakestSkill: "writing",
  });

  // --- Course structure -----------------------------------------------------
  const [ielts] = await db
    .insert(courses)
    .values({
      slug: "ielts",
      title: "IELTS",
      description: "A structured path from your current band to your target band, across all four skills.",
    })
    .returning();
  if (!ielts) throw new Error("Course seeding failed");

  await db.insert(enrollments).values([
    { userId: demoStudent.id, courseId: ielts.id },
    { userId: newStudent.id, courseId: ielts.id },
  ]);

  type LessonSeed = { slug: string; title: string; summary: string; defaultState?: "locked" | "available" };
  type UnitSeed = { slug: string; title: string; lessons: LessonSeed[] };
  type ModuleSeed = { slug: string; title: string; units: UnitSeed[] };

  const moduleDefs: ModuleSeed[] = [
    {
      slug: "listening",
      title: "Listening",
      units: [
        {
          slug: "foundations",
          title: "Foundations",
          lessons: [
            { slug: "listening-for-gist", title: "Listening for gist before detail", summary: "Train the habit of catching the overall point first.", defaultState: "available" },
            { slug: "predicting-answers", title: "Predicting answers before you hear them", summary: "Use question wording to anticipate what's coming." },
          ],
        },
      ],
    },
    {
      slug: "reading",
      title: "Reading",
      units: [
        {
          slug: "foundations",
          title: "Foundations",
          lessons: [
            { slug: "skim-vs-scan", title: "Skimming vs. scanning", summary: "When to read for structure and when to hunt for a fact.", defaultState: "available" },
            { slug: "tfng-basics", title: "True / False / Not Given basics", summary: "The single most misunderstood IELTS Reading question type." },
          ],
        },
      ],
    },
    {
      slug: "writing",
      title: "Writing",
      units: [
        {
          slug: "task2-foundations",
          title: "Task 2 foundations",
          lessons: [
            { slug: "four-paragraph-structure", title: "Structuring a four-paragraph essay", summary: "Introduction, two body paragraphs, conclusion — and why that shape works.", defaultState: "available" },
            { slug: "idea-to-thesis", title: "Turning a rough idea into a thesis statement", summary: "The sentence that tells the examiner exactly what you're arguing.", defaultState: "available" },
          ],
        },
        {
          slug: "task1-foundations",
          title: "Task 1 foundations",
          lessons: [
            { slug: "describing-trends", title: "Describing trends in a line graph", summary: "The vocabulary of rise, fall, and plateau." },
          ],
        },
      ],
    },
    {
      slug: "speaking",
      title: "Speaking",
      units: [
        {
          slug: "foundations",
          title: "Foundations",
          lessons: [
            { slug: "part1-about-yourself", title: "Part 1: talking about yourself naturally", summary: "Answering without sounding rehearsed.", defaultState: "available" },
            { slug: "part2-one-minute-plan", title: "Part 2: the one-minute plan", summary: "A simple structure for your prep time on the cue card." },
          ],
        },
      ],
    },
    {
      slug: "grammar",
      title: "Grammar",
      units: [
        {
          slug: "sentence-accuracy",
          title: "Sentence accuracy",
          lessons: [
            { slug: "article-mistakes", title: "Article mistakes that cost bands", summary: "a / an / the — the small words examiners notice most.", defaultState: "available" },
            { slug: "simple-vs-compound", title: "Simple vs. compound sentences", summary: "Building range without losing accuracy." },
          ],
        },
      ],
    },
    {
      slug: "vocabulary",
      title: "Vocabulary",
      units: [
        {
          slug: "method",
          title: "How the vocabulary box works",
          lessons: [
            { slug: "how-review-works", title: "How the review box works", summary: "Why spaced review beats re-reading a list.", defaultState: "available" },
          ],
        },
      ],
    },
  ];

  let completedLessonId: string | null = null;

  for (let mi = 0; mi < moduleDefs.length; mi++) {
    const m = moduleDefs[mi]!;
    const [moduleRow] = await db
      .insert(courseModules)
      .values({ courseId: ielts.id, slug: m.slug, title: m.title, order: mi + 1 })
      .returning();
    if (!moduleRow) continue;

    for (let ui = 0; ui < m.units.length; ui++) {
      const u = m.units[ui]!;
      const [unitRow] = await db
        .insert(units)
        .values({ moduleId: moduleRow.id, slug: u.slug, title: u.title, order: ui + 1 })
        .returning();
      if (!unitRow) continue;

      for (let li = 0; li < u.lessons.length; li++) {
        const l = u.lessons[li]!;
        const [lessonRow] = await db
          .insert(lessons)
          .values({
            unitId: unitRow.id,
            slug: l.slug,
            title: l.title,
            summary: l.summary,
            defaultState: l.defaultState ?? "locked",
            order: li + 1,
          })
          .returning();
        if (lessonRow && m.slug === "writing" && u.slug === "task2-foundations" && l.slug === "four-paragraph-structure") {
          completedLessonId = lessonRow.id;
        }
      }
    }
  }

  if (completedLessonId) {
    await db.insert(lessonProgress).values({
      userId: demoStudent.id,
      lessonId: completedLessonId,
      state: "completed",
      completedAt: new Date(),
    });
  }

  // --- Writing prompts (original) -------------------------------------------
  const promptRows = await db
    .insert(writingPrompts)
    .values([
      {
        taskType: "task2",
        category: "opinion",
        prompt:
          "Some people believe that university students should study whatever subject they like. Others believe they should only study subjects useful to the future job market. Discuss both views and give your own opinion.",
        targetWordCount: 250,
      },
      {
        taskType: "task2",
        category: "problem-solution",
        prompt:
          "In many cities, traffic congestion is getting worse. What problems does this cause, and what measures could be taken to solve them?",
        targetWordCount: 250,
      },
      {
        taskType: "task2",
        category: "advantages-disadvantages",
        prompt:
          "More and more people are choosing to work from home rather than in a traditional office. Do the advantages of this trend outweigh the disadvantages?",
        targetWordCount: 250,
      },
      {
        taskType: "task1",
        category: "line-graph",
        prompt:
          "The line graph below shows the number of visitors to three different museums in a city between 2015 and 2024. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
        targetWordCount: 150,
      },
    ])
    .returning();

  const opinionPrompt = promptRows.find((p) => p.category === "opinion")!;

  const [demoSubmission] = await db
    .insert(writingSubmissions)
    .values({
      userId: demoStudent.id,
      promptId: opinionPrompt.id,
      status: "evaluated",
      submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
      content:
        "Many people think students should study only what will get them a job. However, I believe students should be free to choose subjects they are passionate about, because motivation drives better learning outcomes.\n\nOn one hand, subjects like engineering or medicine lead directly to stable careers, and some argue that public universities should prioritise these fields to serve the economy. Furthermore, graduates of vocational subjects often find employment faster than those who study, for instance, philosophy.\n\nOn the other hand, forcing students into 'useful' subjects can backfire. A student who dislikes their field is less likely to perform well or stay in that career long term. Moreover, some of the most valuable innovations have come from people who studied something unrelated to their eventual job, because a broad education builds transferable thinking skills.\n\nIn conclusion, while job-market alignment has some benefits, I believe passion and personal interest should guide subject choice, since genuine engagement produces both better students and, eventually, better professionals.",
      wordCount: 168,
    })
    .returning();

  if (demoSubmission) {
    await db.insert(writingFeedback).values({
      submissionId: demoSubmission.id,
      source: "demo_ai",
      taskResponseBand: 7,
      coherenceBand: 7,
      lexicalBand: 6.5,
      grammarBand: 6.5,
      overallBand: 7,
      strengths: ["Clear position maintained throughout.", "Uses cohesive devices to connect ideas."],
      weaknesses: ["Under the target length (168/250 words)."],
      suggestions: ["Develop your ideas further to comfortably clear the word target."],
    });
    await db.insert(activityEvents).values([
      { userId: demoStudent.id, type: "WRITING_SUBMITTED", payload: { submissionId: demoSubmission.id }, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2) },
      { userId: demoStudent.id, type: "LESSON_COMPLETED", payload: { lessonId: completedLessonId }, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1) },
      { userId: demoStudent.id, type: "VOCAB_REVIEWED", payload: {}, createdAt: new Date() },
    ]);
  }

  // --- Vocabulary -----------------------------------------------------------
  const lexemeRows = await db
    .insert(lexemes)
    .values([
      { term: "congestion", partOfSpeech: "noun", definitionEn: "A situation where a place is overly crowded, causing delay.", translationUz: "tirbandlik", exampleSentence: "Traffic congestion is worst on the ring road at 6pm." },
      { term: "outweigh", partOfSpeech: "verb", definitionEn: "To be greater or more significant than something else.", translationUz: "ustun kelmoq", exampleSentence: "The benefits of remote work outweigh the drawbacks for many employees." },
      { term: "vocational", partOfSpeech: "adjective", definitionEn: "Relating to skills needed for a particular job.", translationUz: "kasbiy", exampleSentence: "Vocational training prepares students directly for the workplace." },
      { term: "transferable skills", partOfSpeech: "noun phrase", definitionEn: "Abilities useful across many different jobs or situations.", translationUz: "universal ko'nikmalar", exampleSentence: "Critical thinking is a transferable skill valued in almost every career." },
    ])
    .returning();

  const now = new Date();
  const inPast = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  await db.insert(userVocabulary).values([
    { userId: demoStudent.id, lexemeId: lexemeRows[0]!.id, state: "mastered", intervalDays: 30, correctCount: 5, nextReviewAt: new Date(now.getTime() + 20 * 86400000), lastReviewedAt: inPast(2) },
    { userId: demoStudent.id, lexemeId: lexemeRows[1]!.id, state: "review", intervalDays: 4, correctCount: 2, nextReviewAt: inPast(0), lastReviewedAt: inPast(4) },
    { userId: demoStudent.id, lexemeId: lexemeRows[2]!.id, state: "new", intervalDays: 0, nextReviewAt: inPast(0) },
    { userId: demoStudent.id, lexemeId: lexemeRows[3]!.id, state: "learning", intervalDays: 1, incorrectCount: 1, nextReviewAt: inPast(0), lastReviewedAt: inPast(1) },
  ]);

  // --- Reading (original passage + questions) --------------------------------
  const [passage] = await db
    .insert(readingPassages)
    .values({
      title: "Urban Beekeeping and the Modern City",
      difficultyLevel: "B2",
      suggestedMinutes: 15,
      bodyText:
        "In the last two decades, a growing number of city dwellers have started keeping honeybees on rooftops, balconies and in shared community gardens. What was once considered a strictly rural activity has become a common sight in cities from Berlin to Tokyo. Enthusiasts argue that urban environments, despite their concrete and traffic, can actually offer bees a wider variety of flowering plants across a smaller area than many intensively farmed rural landscapes, where a single crop often dominates for miles.\n\nCritics, however, point out that the rapid rise in urban hives has occasionally led to overcrowding, with too many colonies competing for the same limited flowers within a small radius. In some neighbourhoods, this has meant that both managed honeybees and wild pollinator species, such as solitary bees, receive less food than they would in a less crowded environment. Some ecologists now recommend that cities set a rough limit on the number of hives per square kilometre.\n\nDespite these concerns, most researchers agree that urban beekeeping has brought real benefits, particularly in raising public awareness of pollinator decline. Rooftop apiaries are frequently used to teach schoolchildren and office workers about the essential role bees play in food production, and several cities now require new commercial buildings to include space for green roofs or hives as part of their planning permission.",
    })
    .returning();

  if (passage) {
    await db.insert(readingQuestions).values([
      {
        passageId: passage.id,
        order: 1,
        type: "true_false_not_given",
        questionText: "Rooftop beekeeping is now common only in European cities.",
        correctAnswer: "false",
        evidenceQuote: "a common sight in cities from Berlin to Tokyo",
        explanation: "Tokyo is named alongside Berlin, so it isn't limited to Europe.",
      },
      {
        passageId: passage.id,
        order: 2,
        type: "true_false_not_given",
        questionText: "Some ecologists have suggested limiting the number of hives allowed in a given area.",
        correctAnswer: "true",
        evidenceQuote: "cities set a rough limit on the number of hives per square kilometre",
        explanation: "This is stated directly in paragraph 2.",
      },
      {
        passageId: passage.id,
        order: 3,
        type: "true_false_not_given",
        questionText: "Solitary bees generally out-compete honeybees for food in crowded cities.",
        correctAnswer: "not_given",
        evidenceQuote: "both managed honeybees and wild pollinator species... receive less food",
        explanation: "The passage says both groups lose out, but never compares them to each other.",
      },
      {
        passageId: passage.id,
        order: 4,
        type: "multiple_choice",
        questionText: "According to the passage, urban beekeeping helps raise public awareness of…",
        options: ["pollinator decline", "climate change policy", "organic farming methods", "renewable energy use"],
        correctAnswer: "pollinator decline",
        evidenceQuote: "raising public awareness of pollinator decline",
        explanation: "Stated directly at the start of paragraph 3.",
      },
      {
        passageId: passage.id,
        order: 5,
        type: "short_answer",
        questionText:
          "Besides space for hives, what else does the passage say some cities require new commercial buildings to include?",
        correctAnswer: "green roofs",
        evidenceQuote: "space for green roofs or hives",
        explanation: "Grading here is an exact match on \"green roofs\" — a real limitation of this demo grader for free-text answers, noted in the README.",
      },
      {
        passageId: passage.id,
        order: 6,
        type: "yes_no_not_given",
        questionText: "The writer believes urban beekeeping has been worthwhile overall, despite the problems it can cause.",
        correctAnswer: "yes",
        evidenceQuote: "most researchers agree that urban beekeeping has brought real benefits",
        explanation:
          "Yes/No/Not Given tests agreement with the writer's own claims (not just facts) — the passage states this directly as the researchers' (and by extension the writer's) view.",
      },
    ]);
  }

  // --- Grammar (original topics + exercises, one linked to the demo essay) ---
  const [articlesTopic] = await db
    .insert(grammarTopics)
    .values({
      skillArea: "writing",
      title: "Article mistakes: a / an / the",
      explanation: "The single most common accuracy error in Task 2 essays — small words examiners notice.",
      order: 1,
    })
    .returning();

  const [sentenceTopic] = await db
    .insert(grammarTopics)
    .values({
      skillArea: "writing",
      title: "Simple vs. compound sentences",
      explanation: "Building grammatical range without losing accuracy.",
      order: 2,
    })
    .returning();

  if (articlesTopic) {
    await db.insert(grammarExercises).values([
      {
        topicId: articlesTopic.id,
        order: 1,
        promptText: "___ congestion is a growing problem in many cities.",
        options: ["A traffic", "An traffic", "Traffic", "The traffics"],
        correctOption: "Traffic",
        explanation: "\"Traffic\" is uncountable here and refers to the general concept, so it takes no article.",
        sourceSubmissionId: demoSubmission?.id,
      },
      {
        topicId: articlesTopic.id,
        order: 2,
        promptText: "Some people believe that university students should study ___ subject they like.",
        options: ["a", "an", "the", "(no article)"],
        correctOption: "a",
        explanation: "\"Subject\" is singular and countable and not yet specified, so it needs the indefinite article \"a\".",
      },
      {
        topicId: articlesTopic.id,
        order: 3,
        promptText: "___ advantages of remote work outweigh the disadvantages.",
        options: ["A", "An", "The", "(no article)"],
        correctOption: "The",
        explanation: "\"Advantages\" is specified by \"of remote work\", so it needs the definite article \"the\".",
      },
    ]);
  }

  if (sentenceTopic) {
    await db.insert(grammarExercises).values([
      {
        topicId: sentenceTopic.id,
        order: 1,
        promptText: "Traffic congestion is worse than ever. Governments must act quickly.",
        options: [
          "Traffic congestion is worse than ever, governments must act quickly.",
          "Traffic congestion is worse than ever, so governments must act quickly.",
          "Traffic congestion is worse than ever governments must act quickly.",
          "Traffic congestion is worse than ever; so governments must act quickly.",
        ],
        correctOption: "Traffic congestion is worse than ever, so governments must act quickly.",
        explanation:
          "A comma alone can't join two full sentences (that's a comma splice) — either a conjunction like \"so\" after the comma, or a semicolon alone, is needed.",
      },
      {
        topicId: sentenceTopic.id,
        order: 2,
        promptText: "Combine using \"although\": Public transport is cheaper. Many people still prefer to drive.",
        options: [
          "Although public transport is cheaper, many people still prefer to drive.",
          "Public transport is cheaper, although many people still prefer to drive it.",
          "Although public transport is cheaper many people still prefer to drive.",
          "Public transport, although is cheaper, many people still prefer to drive.",
        ],
        correctOption: "Although public transport is cheaper, many people still prefer to drive.",
        explanation: "\"Although\" introduces the subordinate clause, which needs a comma before the main clause that follows.",
      },
    ]);
  }

  // --- Live classes (original, tied to the seeded teacher) -----------------
  const inFuture = (days: number, hour: number) => {
    const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  await db.insert(liveClasses).values([
    {
      courseId: ielts.id,
      teacherUserId: teacher.id,
      title: "Task 2: turning a rough idea into a thesis statement",
      topic: "Live walkthrough with Q&A — bring a draft thesis sentence if you have one.",
      scheduledAt: inFuture(3, 18),
      durationMinutes: 60,
      meetingUrl: "https://meet.example.com/learners-area/writing-clinic",
      status: "upcoming",
    },
    {
      courseId: ielts.id,
      teacherUserId: teacher.id,
      title: "Reading: True/False/Not Given traps",
      topic: "Why students lose marks on TFNG and how to avoid the classic distractors.",
      scheduledAt: inFuture(-4, 18),
      durationMinutes: 45,
      status: "recorded",
      recordingUrl: "https://cdn.example.com/recordings/tfng-traps.mp4",
    },
  ]);

  // --- Speaking materials (posted by different teachers + the owner, to
  // demonstrate the ownership model: everyone can post, only the creator or
  // an isOwner=true account can edit someone else's post) ------------------
  const [material1] = await db
    .insert(speakingMaterials)
    .values({
      createdByUserId: teacher.id,
      category: "part1",
      title: "Part 1: talking about your hometown naturally",
      primaryType: "video",
      // Placeholder link — demonstrates the embed wiring (YouTube ID parsing
      // -> youtube-nocookie.com iframe); swap for a real hosted video.
      primaryUrl: "https://www.youtube.com/watch?v=PLACEHOLDER1",
    })
    .returning();

  if (material1) {
    await db.insert(materialBlocks).values([
      {
        materialId: material1.id,
        type: "text",
        position: 0,
        textContent: "Common Part 1 questions on hometown, with model answers that avoid sounding memorised.",
      },
      {
        materialId: material1.id,
        type: "link",
        position: 1,
        linkUrl: "https://cdn.example.com/speaking/part1-hometown-transcript.pdf",
      },
    ]);
  }

  await db.insert(speakingMaterials).values([
    {
      createdByUserId: teacher2.id,
      category: "part2",
      title: "Part 2: the one-minute cue-card plan",
      primaryType: "video",
      primaryUrl: "https://vimeo.com/000000002",
    },
    {
      createdByUserId: admin.id,
      category: "general",
      title: "How Speaking is scored — the four criteria, honestly",
      primaryType: "video",
      primaryUrl: "https://www.youtube.com/watch?v=PLACEHOLDER3",
    },
  ]);

  // --- Listening (original, placeholder audio link — see README) ----------
  const [listeningTest] = await db
    .insert(listeningTests)
    .values({
      createdByUserId: admin.id,
      title: "Academic Listening: Booking a library study room",
      audioType: "audio",
      // Placeholder — demonstrates the embed/grading wiring; swap for a
      // real uploaded or hosted audio file.
      audioUrl: "https://cdn.example.com/listening/library-booking.mp3",
      transcript:
        "Student: Hi, I'd like to book a study room for Thursday afternoon.\nLibrarian: Sure — we have Room 4B free from two until four, or Room 2A from three until five.\nStudent: I'll take Room 4B, please, for three people.\nLibrarian: Great, that's booked. You'll need your student ID to check in at the desk.",
      difficultyLevel: "B2",
    })
    .returning();

  if (listeningTest) {
    await db.insert(listeningQuestions).values([
      {
        testId: listeningTest.id,
        order: 1,
        type: "multiple_choice",
        questionText: "Which room does the student book?",
        options: ["Room 2A", "Room 4B", "Room 4A", "Room 2B"],
        correctAnswer: "Room 4B",
        explanation: "The student says \"I'll take Room 4B, please.\"",
      },
      {
        testId: listeningTest.id,
        order: 2,
        type: "short_answer",
        questionText: "How many people is the room booked for? (number only)",
        correctAnswer: "3",
        explanation: "The student specifies \"for three people.\"",
      },
      {
        testId: listeningTest.id,
        order: 3,
        type: "short_answer",
        questionText: "What does the student need to bring to check in?",
        correctAnswer: "student id",
        explanation: "The librarian says \"You'll need your student ID to check in at the desk.\"",
      },
    ]);
  }

  console.log("Seed complete.");
  console.log("");
  console.log("Demo accounts (password shown once, dev only):");
  console.log("  admin@learnersarea.uz        / Admin12345!  (isOwner: full control over everyone's content)");
  console.log("  teacher@learnersarea.uz      / Teacher12345!");
  console.log("  teacher2@learnersarea.uz     / Teacher12345!  (second teacher — for testing the ownership boundary)");
  console.log("  demo.student@learnersarea.uz / Student12345!  (onboarded, has history)");
  console.log("  new.student@learnersarea.uz  / Student12345!  (fresh account, empty states)");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
