import 'server-only';
import {db} from '@/db/client';
import {onboardingProfiles,users} from '@/db/schema';
import {eq} from 'drizzle-orm';
import type {OnboardingInput} from '@/lib/validation/onboarding';
export async function saveStudyProfile(userId:string,data:OnboardingInput,executor:typeof db=db){
 const values={currentLevel:data.currentLevel,currentBand:data.currentBand??null,targetBand:data.targetBand,examDate:data.examDate?new Date(data.examDate+'T00:00:00.000Z'):null,dailyStudyMinutes:data.dailyStudyMinutes,strongestSkill:data.strongestSkill,weakestSkill:data.weakestSkill};
 await executor.transaction(async tx=>{await tx.insert(onboardingProfiles).values({userId,...values}).onConflictDoUpdate({target:onboardingProfiles.userId,set:values});await tx.update(users).set({locale:data.preferredLanguage}).where(eq(users.id,userId));});
}
