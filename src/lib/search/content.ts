import "server-only";
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { assignments, courses, generalReadingPassages, generalReadingSets, grammarTopics, lessons, lexemes, listeningPackages, listeningTests, liveClasses, readingPassages, speakingMaterials, speakingPrompts, userVocabulary, videoLessons, writingPrompts } from "@/db/schema";
import { notDeleted } from "@/lib/content/deletion-filter";
import { liveWhere } from "@/lib/services/cms/publication";
import { productSql, inProgrammeSql } from "@/lib/listening/product";
import { academicQuestionCountClause } from "@/lib/data/reading-assessments";
import { PRACTICE_PARTS, topicKey } from "@/lib/speaking/practice-browse";
import type { SearchHit } from "./navigation";

const cap = 5;
const excerpt = (value: string) => value.length > 110 ? `${value.slice(0,107)}…` : value;

/** No passage body, answer key, transcript, or private submission is searched.
 * General passages are independent study material; formal sets expose only the
 * test title, never the hidden titles of their three locked passages. */
export async function searchContent(query: string, userId: string, database: typeof db = db) {
  const like = `%${query.replace(/[%_\\]/g, c => `\\${c}`)}%`;
  const listeningProduct=productSql({testId:sql`${listeningTests.id}`,payload:sql`${listeningPackages.payload}`,payloadIsNull:sql`${listeningPackages.testId} is null`,inProgramme:inProgrammeSql(sql`${listeningTests.programRef}`)});
  const categories: (() => Promise<SearchHit[]>)[] = [
    async () => (await database.select({id:readingPassages.id,title:readingPassages.title,setId:generalReadingPassages.setId,part:generalReadingPassages.passageNo})
      .from(readingPassages).innerJoin(generalReadingPassages,eq(generalReadingPassages.passageId,readingPassages.id)).innerJoin(generalReadingSets,eq(generalReadingSets.id,generalReadingPassages.setId))
      .where(and(liveWhere(readingPassages),liveWhere(generalReadingSets),notDeleted(readingPassages.id),notDeleted(generalReadingSets.id),ilike(readingPassages.title,like)))
      .orderBy(asc(readingPassages.title),asc(readingPassages.id)).limit(cap)).map(row=>({type:"reading",title:row.title,context:"General Reading",href:`/app/reading/general/${row.setId}?passage=${row.part}`})),
    async () => (await database.select({id:generalReadingSets.id,title:generalReadingSets.title}).from(generalReadingSets)
      .where(and(liveWhere(generalReadingSets),notDeleted(generalReadingSets.id),ilike(generalReadingSets.title,like),academicQuestionCountClause(generalReadingSets.id,generalReadingSets.sourceRef),sql`(select count(*) from general_reading_passages g where g.set_id=${generalReadingSets.id})=3
        and not exists (select 1 from general_reading_passages g join reading_passages p on p.id=g.passage_id where g.set_id=${generalReadingSets.id} and (g.passage_no not in (1,2,3) or not (${notDeleted(sql`p.id`)}) or not (p.publication_state='published' or (p.publication_state='scheduled' and p.publish_at<=now()))))`))
      .orderBy(asc(generalReadingSets.title),asc(generalReadingSets.id)).limit(cap)).map(row=>({type:"reading",title:row.title,context:"Academic Reading",href:`/app/reading/academic/${row.id}`})),
    async () => (await database.select({id:listeningTests.id,title:listeningTests.title,day:listeningTests.programOrdinal,product:listeningProduct}).from(listeningTests)
      .leftJoin(listeningPackages,eq(listeningPackages.testId,listeningTests.id))
      .where(and(liveWhere(listeningTests),notDeleted(listeningTests.id),ilike(listeningTests.title,like),sql`(${listeningProduct}='general_section' or (${listeningPackages.testId} is not null and ${listeningProduct}<>'unclassified') or ${listeningTests.programOrdinal} is not null)`))
      .orderBy(asc(listeningTests.title),asc(listeningTests.id)).limit(cap)).map(row=>({type:"listening",title:row.title,context:null,href:row.day?`/app/listening/mcq/day/${row.day}`:row.product==="general_section"?`/app/listening/general/${row.id}`:`/app/listening/tests/${row.id}`})),
    async () => (await database.select({term:lexemes.term,definition:lexemes.definitionEn}).from(userVocabulary)
      .innerJoin(lexemes,eq(userVocabulary.lexemeId,lexemes.id))
      .where(and(eq(userVocabulary.userId,userId),or(ilike(lexemes.term,like),ilike(lexemes.translationUz,like))))
      .orderBy(asc(lexemes.term),asc(userVocabulary.id)).limit(cap)).map(row=>({type:"vocabulary",title:row.term,context:excerpt(row.definition),href:`/app/vocabulary?q=${encodeURIComponent(row.term)}`})),
    async () => (await database.select({id:lessons.id,title:lessons.title,area:lessons.learningArea}).from(lessons)
      .where(and(liveWhere(lessons),notDeleted(lessons.id),ilike(lessons.title,like))).orderBy(asc(lessons.title),asc(lessons.id)).limit(cap))
      .map(row=>({type:"lesson",title:row.title,context:row.area,href:row.area&&["reading","listening","grammar"].includes(row.area)?`/app/${row.area}/lessons/${row.id}`:`/app/courses/ielts/lessons/${row.id}`})),
    async () => (await database.select({id:grammarTopics.id,title:grammarTopics.title}).from(grammarTopics)
      .where(and(eq(grammarTopics.publicationState,"published"),notDeleted(grammarTopics.id),ilike(grammarTopics.title,like))).orderBy(asc(grammarTopics.title),asc(grammarTopics.id)).limit(cap))
      .map(row=>({type:"grammar",title:row.title,context:null,href:`/app/grammar/${row.id}`})),
    async () => (await database.select({id:writingPrompts.id,prompt:writingPrompts.prompt,task:writingPrompts.taskType}).from(writingPrompts)
      .where(and(liveWhere(writingPrompts),notDeleted(writingPrompts.id),or(ilike(writingPrompts.prompt,like),ilike(writingPrompts.category,like)))).orderBy(asc(writingPrompts.id)).limit(cap))
      .map(row=>({type:"writing",title:excerpt(row.prompt),context:row.task==="task1"?"Task 1":"Task 2",href:`/app/writing/prompts/${row.id}`})),
    async () => (await database.select({id:speakingMaterials.id,title:speakingMaterials.title,category:speakingMaterials.category}).from(speakingMaterials)
      .where(and(liveWhere(speakingMaterials),notDeleted(speakingMaterials.id),ne(speakingMaterials.category,"shadowing"),ilike(speakingMaterials.title,like))).orderBy(asc(speakingMaterials.title),asc(speakingMaterials.id)).limit(cap))
      .map(row=>({type:"speaking",title:row.title,context:row.category,href:`/app/speaking/lessons#material-${row.id}`})),
    async () => (await database.select({id:speakingPrompts.id,prompt:speakingPrompts.promptText,part:speakingPrompts.part,topic:speakingPrompts.topic}).from(speakingPrompts)
      .where(and(liveWhere(speakingPrompts),notDeleted(speakingPrompts.id),inArray(speakingPrompts.part,[...PRACTICE_PARTS]),sql`(${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb or ${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb)`,or(ilike(speakingPrompts.promptText,like),ilike(speakingPrompts.topic,like)))).orderBy(asc(speakingPrompts.id)).limit(cap))
      .map(row=>({type:"speaking",title:excerpt(row.prompt),context:row.topic,href:`/app/speaking/practice?${new URLSearchParams({part:row.part,topic:topicKey(row.topic)})}`})),
    async () => (await database.select({id:videoLessons.id,title:videoLessons.title}).from(videoLessons)
      .where(and(liveWhere(videoLessons),notDeleted(videoLessons.id),ilike(videoLessons.title,like))).orderBy(asc(videoLessons.title),asc(videoLessons.id)).limit(cap))
      .map(row=>({type:"video",title:row.title,context:"TED / Podcast",href:`/app/video-lessons/${row.id}`})),
    async () => (await database.select({title:liveClasses.title,status:liveClasses.status}).from(liveClasses)
      .innerJoin(courses,eq(liveClasses.courseId,courses.id))
      .where(and(eq(courses.slug,"ielts"),ne(liveClasses.status,"cancelled"),ilike(liveClasses.title,like))).orderBy(asc(liveClasses.id)).limit(cap))
      .map(row=>({type:"liveClass",title:row.title,context:row.status,href:"/app/live-classes"})),
    async () => (await database.select({id:assignments.id,title:assignments.title}).from(assignments)
      .where(and(eq(assignments.targetUserId,userId),or(ilike(assignments.title,like),ilike(assignments.description,like)))).orderBy(asc(assignments.id)).limit(cap))
      .map(row=>({type:"assignment",title:row.title,context:null,href:`/app/assignments/${row.id}`})),
  ];
  const settled = await Promise.allSettled(categories.map(run=>run()));
  return {results:settled.flatMap(result=>result.status==="fulfilled"?result.value:[]),failedCategories:settled.filter(result=>result.status==="rejected").length};
}
