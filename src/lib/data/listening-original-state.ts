import 'server-only';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users, listeningAuthoredCheckpoints, listeningAttempts, listeningDrafts, listeningAnswers } from '@/db/schema';
import { startListeningAttempt, submitListeningAttempt } from './listening-attempt-write';
import { listeningQuestionsForAttempt } from '@/lib/listening/question-set';
import { ORIGINAL_TEST_ONE_STORAGE } from '@/lib/listening/original-test-one';
import { type ListeningPackage } from '@/lib/listening/package';

// Private runtime checkpoints never appear in graded activity history.
const scope = (userId: string, testId: string) => and(eq(listeningAuthoredCheckpoints.userId,userId),eq(listeningAuthoredCheckpoints.testId,testId));
export async function originalListeningState(userId: string, testId: string, database = db) {
  const row = await database.query.listeningAuthoredCheckpoints.findFirst({where:scope(userId,testId)});
  if(row) return row.values;
  // A learner may already have started/submitted through the native renderer.
  // Import their canonical answers instead of treating this as a new test.
  const attempt=await database.query.listeningAttempts.findFirst({where:and(eq(listeningAttempts.userId,userId),eq(listeningAttempts.testId,testId)),orderBy:desc(listeningAttempts.startedAt)});
  if(!attempt)return {};
  const questions=await listeningQuestionsForAttempt(attempt,database);
  const draft=await database.query.listeningDrafts.findFirst({where:eq(listeningDrafts.attemptId,attempt.id)});
  const saved=await database.select().from(listeningAnswers).where(eq(listeningAnswers.attemptId,attempt.id));
  const answers=Object.fromEntries(questions.map(q=>[q.order,attempt.status==='in_progress'?(draft?.answers[q.id]||''):(saved.find(a=>a.questionId===q.id)?.userAnswer||'')]));
  const values={[ORIGINAL_TEST_ONE_STORAGE]:JSON.stringify({answers,attemptStatus:attempt.status==='in_progress'?'in_progress':'submitted',submitted:attempt.status==='completed',attemptKey:attempt.id,audioPosition:draft?.audioPosition||0,lastResults:attempt.status==='completed'?questions.map(q=>{const answer=saved.find(a=>a.questionId===q.id);return {q:q.order,user:answer?.userAnswer||'',ok:!!answer?.isCorrect};}):[]})};
  await database.insert(listeningAuthoredCheckpoints).values({userId,testId,values,attemptId:attempt.id}).onConflictDoNothing();
  return (await database.query.listeningAuthoredCheckpoints.findFirst({where:scope(userId,testId)}))!.values;
}
export async function saveOriginalListeningState(userId: string, testId: string, values: Record<string,string>, pkg: ListeningPackage, database = db) {
  const raw = z.object({answers:z.record(z.string().regex(/^([1-9]|[1-3][0-9]|40)$/),z.string().max(500)).optional(),attemptStatus:z.enum(['none','in_progress','submitted','exited']).optional(),audioPosition:z.number().finite().nonnegative().max(7200).optional(),attemptKey:z.string().uuid().optional()}).passthrough().parse(JSON.parse(values[ORIGINAL_TEST_ONE_STORAGE] || '{}'));
  const incoming = raw.answers ?? {};

  return database.transaction(async tx=>{
    // Same lock order as the canonical attempt writer; serializes tabs/retries.
    await tx.select({id:users.id}).from(users).where(eq(users.id,userId)).for('update');
    const old = await tx.query.listeningAuthoredCheckpoints.findFirst({where:scope(userId,testId)});
    const previousValues = old?.values ?? {};
    const previous = JSON.parse(previousValues[ORIGINAL_TEST_ONE_STORAGE] || '{}');
    let attemptId = old?.attemptId || '';
    if (previous.attemptKey && raw.attemptKey && previous.attemptKey !== raw.attemptKey && raw.attemptStatus !== 'in_progress') throw Error('stale_checkpoint');
    if (previous.attemptKey && raw.attemptKey === previous.attemptKey && ['submitted','exited'].includes(previous.attemptStatus) && raw.attemptStatus === 'in_progress') return {values:previousValues,attemptId};
    if (['in_progress','submitted','exited'].includes(raw.attemptStatus ?? '') && (!attemptId || raw.attemptStatus === 'in_progress' && previous.attemptStatus !== 'in_progress')) {
      attemptId = await startListeningAttempt(userId,testId,tx as never) || '';
    }
    if (['in_progress','submitted','exited'].includes(raw.attemptStatus ?? '') && attemptId) {
      const attempt = await tx.query.listeningAttempts.findFirst({where:and(eq(listeningAttempts.id,attemptId),eq(listeningAttempts.userId,userId),eq(listeningAttempts.testId,testId))});
      if (!attempt) throw Error('attempt_not_found');
      if (attempt.status === 'in_progress') {
        const questions = await listeningQuestionsForAttempt(attempt,tx as never);
        const answers = Object.fromEntries(questions.map(q=>[q.id,incoming[String(q.order)] || '']));
        if (raw.attemptStatus === 'in_progress') {
          const audioPosition=typeof raw.audioPosition==='number'?Math.max(0,Math.min(pkg.audio.durationSec,raw.audioPosition)):0;
          await tx.insert(listeningDrafts).values({attemptId,answers,audioPosition,audioStartedAt:new Date()}).onConflictDoUpdate({target:listeningDrafts.attemptId,set:{answers,audioPosition,updatedAt:new Date()}});
        } else {
          const result = await submitListeningAttempt(userId,attemptId,Object.entries(answers).map(([questionId,answer])=>({questionId,answer})),tx as never);
          if ('error' in result) throw Error(result.error);
        }
      }
      if (raw.attemptStatus !== 'in_progress') {
        const questions=await listeningQuestionsForAttempt(attempt,tx as never);
        const saved=await tx.select().from(listeningAnswers).where(eq(listeningAnswers.attemptId,attemptId));
        raw.answers=Object.fromEntries(questions.map(q=>[q.order,saved.find(a=>a.questionId===q.id)?.userAnswer||'']));
        raw.lastResults=questions.map(q=>{const answer=saved.find(a=>a.questionId===q.id);return {q:q.order,user:answer?.userAnswer||'',ok:!!answer?.isCorrect};});
        values = {...values,[ORIGINAL_TEST_ONE_STORAGE]:JSON.stringify(raw)};
      }
    }
    await tx.insert(listeningAuthoredCheckpoints).values({userId,testId,values,attemptId:attemptId||null}).onConflictDoUpdate({target:[listeningAuthoredCheckpoints.userId,listeningAuthoredCheckpoints.testId],set:{values,attemptId:attemptId||null,updatedAt:new Date()}});
    return {values,attemptId};
  });
}
