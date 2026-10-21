import {NextRequest,NextResponse} from 'next/server';
import {requireActiveUser} from '@/lib/auth/current-user';
import {onboardingSchema} from '@/lib/validation/onboarding';
import {saveStudyProfile} from '@/lib/data/study-profile';
import {checkRequestOrigin} from '@/lib/http/request-origin';
import {localeCookieOptions,LOCALE_COOKIE} from '@/lib/i18n';
export async function PATCH(req:NextRequest){
 if(!checkRequestOrigin(req).allowed)return NextResponse.json({error:'invalid_origin'},{status:403});
 const user=await requireActiveUser();if(!user)return NextResponse.json({error:'unauthenticated'},{status:401});
 const parsed=onboardingSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'invalid_input'},{status:400});
 await saveStudyProfile(user.id,parsed.data);
 const res=NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store'}});res.cookies.set(LOCALE_COOKIE,parsed.data.preferredLanguage,localeCookieOptions(req));return res;
}
