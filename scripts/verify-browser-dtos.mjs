/** Validate actual Python/PostgreSQL responses with the production native decoders. */
import assert from 'node:assert/strict';
import {validatePublic,validateSession} from '../frontend/vanilla/js/adapters/frontend.js';
import {dashboardDTO,openLessonsDTO,mockDTO} from '../frontend/vanilla/js/adapters/dashboard.js';
import * as progress from '../frontend/vanilla/js/adapters/progress-v54.js';
import {grammarDTO,roadmapDTO} from '../frontend/vanilla/js/adapters/entry-routes-v35.js';
import {grammarTopicDTO} from '../frontend/vanilla/js/adapters/grammar-v48.js';
import {lessonsCatalogueDTO,lessonDTO} from '../frontend/vanilla/js/adapters/listening-lessons-v10.js';
import {lessonDTO as courseDTO} from '../frontend/vanilla/js/adapters/course-lesson-v36.js';
import {videoLibraryDTO,videoDetailDTO} from '../frontend/vanilla/js/adapters/video-v47.js';
import * as reading from '../frontend/vanilla/js/adapters/reading-v44.js';
import {academicCatalogueDTO,academicDetailDTO,historyDTO,hubDTO} from '../frontend/vanilla/js/adapters/listening-v10.js';
import {generalCatalogueDTO,sectionDTO} from '../frontend/vanilla/js/adapters/listening-v9.js';
import {activityDTO,studyDTO,testMcqDTO} from '../frontend/vanilla/js/adapters/listening-activity-v8.js';
import {programDTO} from '../frontend/vanilla/modules/listening/mcq-index.js';
import {mcqDay} from '../frontend/vanilla/js/adapters/mcq.js';
import {coachDTO} from '../frontend/vanilla/js/adapters/coach.js';
import {assignmentDetailsDTO} from '../frontend/vanilla/js/adapters/assignments.js';
import {reporterDTO} from '../frontend/vanilla/js/adapters/reports.js';
import {parseLiveClasses} from '../frontend/vanilla/modules/live-classes/contract.js';
import {validateProfile} from '../frontend/vanilla/modules/profile/page.js';
import * as people from '../frontend/vanilla/js/adapters/staff-final30/people.js';
import * as teacher from '../frontend/vanilla/js/adapters/staff-final30/teacher.js';
import * as owner from '../frontend/vanilla/js/adapters/staff-final30/owner.js';
import * as grammar from '../frontend/vanilla/js/adapters/staff-final30/grammar.js';
import * as readingStaff from '../frontend/vanilla/js/adapters/staff-final30/reading.js';
import * as listeningStaff from '../frontend/vanilla/js/adapters/staff-final30/listening.js';
import * as writingStaff from '../frontend/vanilla/js/adapters/staff-final30/writing.js';
import {validateVideoAdmin} from '../frontend/vanilla/js/adapters/staff-final30/video.js';
import {validateManage} from '../frontend/vanilla/js/adapters/staff-final30/speaking.js';
import * as retention from '../frontend/vanilla/js/adapters/staff-final30/retention.js';
import {validateCentreStatistics,validateSummary,validateResultHistory} from '../frontend/vanilla/js/adapters/staff-final30/statistics.js';

const staffValidators={admissions:people.validateAdmissions,people:people.validateDirectory,roster:people.validateRoster,'student-results':people.validateStudentResults,'teacher-students':teacher.validateStudents,'teacher-student':teacher.validateStudentDetail,'support-inbox':teacher.validateSupport,'teacher-live-classes':teacher.validateClasses,'teacher-live-class':teacher.validateClassDetail,'owner-overview':owner.validateOverview,'owner-integrations':owner.validateIntegrations,'owner-retention':owner.validateRetentionConfig,'grammar-topics':grammar.validateTopics,'grammar-topic':grammar.validateTopic,'reading-passages':readingStaff.validatePassages,'reading-passage':readingStaff.validatePassage,'listening-library':listeningStaff.validateLibrary,'listening-test':listeningStaff.validateTest,'writing-admin':writingStaff.validateOverview,'writing-admin-item':writingStaff.validateItem,'video-admin':validateVideoAdmin,'speaking-manage':validateManage,'reading-retention':retention.validateBank,'retention-staged':retention.validateStaged,'centre-statistics':validateCentreStatistics,'student-learning':d=>{validateSummary(d.summary);validateResultHistory(d.history);}};

export function validateBrowserWire(wire){
 let checks=0;const failures=[];
 const uid=wire['/api/frontend/session']?.session.user.id;
 for(const [url,raw] of Object.entries(wire)){
  try{
   const u=new URL(url,'http://preview.test');
   if(u.pathname==='/api/frontend/public')validatePublic(raw);
   else if(u.pathname==='/api/frontend/session')validateSession(raw);
   else if(u.pathname.startsWith('/api/frontend/staff/')){
    const kind=u.pathname.split('/').at(-1);assert.equal(raw.version,1);assert.equal(raw.kind,kind);staffValidators[kind]?.(raw.data);
   }else if(u.pathname==='/api/frontend/view'){
    const route=u.searchParams.get('route'),r=new URL(route,u.origin),path=r.pathname,d=raw.data,id=path.split('/').at(-1),region=u.searchParams.get('region');
    assert.equal(raw.version,1);assert.equal(raw.route,route);
    if(region)assert.equal(raw.region,region);
    const regions={dashboard:dashboardDTO,openLessons:openLessonsDTO,mock:mockDTO,progressSummary:progress.progressSummaryDTO,progressStreak:progress.progressStreakDTO,progressTrends:progress.progressTrendsDTO,progressMocks:progress.progressMocksDTO,coach:coachDTO,assignmentDetails:assignmentDetailsDTO};
    if(region&&regions[region])regions[region](d[region==='openLessons'?'openLessonsResult':region]);
    else if(path==='/app/profile')validateProfile(d);
    else if(path==='/app/grammar')grammarDTO(d);
    else if(path==='/app/courses/ielts')roadmapDTO(d);
    else if(/^\/app\/courses\/ielts\/lessons\//.test(path))courseDTO(d,id,uid);
    else if(/^\/app\/(listening|reading|grammar)\/lessons$/.test(path))lessonsCatalogueDTO(d);
    else if(/^\/app\/(listening|reading|grammar)\/lessons\//.test(path)&&id!=='author')lessonDTO(d.detail,id,path.split('/')[2]);
    else if(/^\/app\/grammar\/[^/]+$/.test(path))grammarTopicDTO(d,id);
    else if(path==='/app/video-lessons')videoLibraryDTO(d);
    else if(path.startsWith('/app/video-lessons/'))videoDetailDTO(d,id);
    else if(path==='/app/reading/academic')reading.readingAcademicCatalogueDTO(d);
    else if(path.startsWith('/app/reading/academic/'))reading.readingAcademicSetDTO(d,id);
    else if(path==='/app/reading/general')reading.readingGeneralLibraryDTO(d);
    else if(path.startsWith('/app/reading/general/'))reading.readingGeneralSetDTO(d,id);
    else if(path.startsWith('/app/reading/attempts/'))reading.readingAttemptDTO(d,id);
    else if(path==='/app/reading/history')reading.readingHistoryDTO(d);
    else if(path==='/app/reading/retention')reading.readingRetentionDTO(d);
    else if(path==='/app/listening/academic')academicCatalogueDTO(d);
    else if(path.startsWith('/app/listening/academic/')&&d.kind==='academic')academicDetailDTO(d.test,id);
    else if(path==='/app/listening/general')generalCatalogueDTO(d);
    else if(path.startsWith('/app/listening/general/'))sectionDTO(d.section,{testId:id});
    else if(path==='/app/listening/history')historyDTO(d,uid);
    else if(path==='/app/listening/mcq')programDTO(d);
    else if(path.startsWith('/app/listening/mcq/day/'))mcqDay(d.day,Number(id),'student');
    else if(d.kind==='hub')hubDTO(d,id);
    else if(d.kind==='activity')activityDTO(d.activity,d.activity.id,d.activity.activity);
    else if(d.kind==='study')studyDTO(d.study,d.study.id);
    else if(d.kind==='mcq')testMcqDTO(d.mcq,d.mcq.id);
    else if(path==='/app/live-classes')parseLiveClasses(d);
    else if(path==='/app/reports')reporterDTO(d,'owner',r.searchParams.get('q')??'');
   }else continue;
   checks++;
  }catch(error){failures.push({url,error:error.code??error.message});}
 }
 if(failures.length)throw Error(JSON.stringify({nativeDecoderChecks:checks,failures}));
 return checks;
}
