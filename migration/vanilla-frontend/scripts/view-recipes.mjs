// Reviewed source functions and explicit data boundaries. This is NOT a route-count shortcut.
export default [
 {name:'listening-lessons',path:'/app/listening/lessons',file:'listening/lessons/page.tsx',fn:'ListeningLessonsPage',fields:['library'],prelude:'const t=dict.listening.lessons;const staff=isStaff(user.role);'},
 {name:'reading-lessons',path:'/app/reading/lessons',file:'reading/lessons/page.tsx',fn:'ReadingLessonsPage',fields:['library']},
 {name:'grammar-lessons',path:'/app/grammar/lessons',file:'grammar/lessons/page.tsx',fn:'GrammarLibraryResults',fields:['library']},
 {name:'listening-academic',path:'/app/listening/academic',file:'listening/academic/page.tsx',fn:'AcademicCatalogueRegion',fields:['cards','total'],prelude:'const t=dict.listening.academic;'},
 {name:'listening-general',path:'/app/listening/general',file:'listening/general/page.tsx',fn:'GeneralCatalogueRegion',fields:['cards','hasMore','total'],prelude:'const t=dict.listening.general;'},
 {name:'listening-mcq',path:'/app/listening/mcq',file:'listening/mcq/page.tsx',fn:'ListeningMcqPage',fields:['days'],prelude:'const t=dict.listening.mcqProgram;const staff=isStaff(user.role);'},
 {name:'listening-history',path:'/app/listening/history',file:'listening/history/page.tsx',fn:'ListeningHistoryPage',fields:['rows']},
 {name:'reading-history',path:'/app/reading/history',file:'reading/history/page.tsx',fn:'ReadingHistoryPage',fields:['rows']},
 {name:'reading-academic',path:'/app/reading/academic',file:'reading/academic/page.tsx',fn:'AcademicReadingResults',fields:['sets']},
 {name:'management',path:'/app/management',file:'management/page.tsx',fn:'ManagementPage',fields:[],sourcePrelude:'type Area',roles:['teacher','admin','owner']},
 {name:'speaking',path:'/app/speaking',file:'speaking/page.tsx',fn:'SpeakingPage',fields:[],prelude:"const t=dict.speakingHub;const SPEAKING_HUB_CARDS=[{key:'lessons',href:'/app/speaking/lessons'},{key:'partner',href:'/app/speaking/live-partner'},{key:'practice',href:'/app/speaking/practice'},{key:'ai',href:'/app/speaking/ai'}];"},
 {name:'notifications',path:'/app/notifications',file:'notifications/page.tsx',fn:'NotificationsPage',fields:['rows'],dates:['rows.createdAt']},
 {name:'owner-audit',path:'/app/owner/audit',file:'owner/audit/page.tsx',fn:'OwnerAuditPage',fields:['rows'],dates:['rows.createdAt'],roles:['owner']},
 {name:'admin-content',path:'/app/admin/content',file:'admin/content/page.tsx',fn:'ContentLibraryResults',fields:['inventory','writingOther'],sourcePrelude:'const sections',roles:['admin','owner']},
 {name:'admin-materials',path:'/app/admin/materials',file:'admin/materials/page.tsx',fn:'AdminMaterialsPage',fields:['counts'],roles:['teacher','admin','owner']},
];
