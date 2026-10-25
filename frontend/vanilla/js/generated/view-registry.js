// Reviewed presentation route contracts, NOT complete module acceptance.
export default [
  {
    "name": "listening-lessons",
    "path": "/app/listening/lessons",
    "fields": [
      "library"
    ],
    "source": "src/app/app/(shell)/listening/lessons/page.tsx",
    "fn": "ListeningLessonsPage"
  },
  {
    "name": "reading-lessons",
    "path": "/app/reading/lessons",
    "fields": [
      "library"
    ],
    "source": "src/app/app/(shell)/reading/lessons/page.tsx",
    "fn": "ReadingLessonsPage"
  },
  {
    "name": "grammar-lessons",
    "path": "/app/grammar/lessons",
    "fields": [
      "library"
    ],
    "source": "src/app/app/(shell)/grammar/lessons/page.tsx",
    "fn": "GrammarLibraryResults"
  },
  {
    "name": "listening-academic",
    "path": "/app/listening/academic",
    "fields": [
      "cards",
      "total"
    ],
    "source": "src/app/app/(shell)/listening/academic/page.tsx",
    "fn": "AcademicCatalogueRegion"
  },
  {
    "name": "listening-general",
    "path": "/app/listening/general",
    "fields": [
      "cards",
      "hasMore",
      "total"
    ],
    "source": "src/app/app/(shell)/listening/general/page.tsx",
    "fn": "GeneralCatalogueRegion"
  },
  {
    "name": "listening-mcq",
    "path": "/app/listening/mcq",
    "fields": [
      "days"
    ],
    "source": "src/app/app/(shell)/listening/mcq/page.tsx",
    "fn": "ListeningMcqPage"
  },
  {
    "name": "listening-history",
    "path": "/app/listening/history",
    "fields": [
      "rows"
    ],
    "source": "src/app/app/(shell)/listening/history/page.tsx",
    "fn": "ListeningHistoryPage"
  },
  {
    "name": "reading-history",
    "path": "/app/reading/history",
    "fields": [
      "rows"
    ],
    "source": "src/app/app/(shell)/reading/history/page.tsx",
    "fn": "ReadingHistoryPage"
  },
  {
    "name": "reading-academic",
    "path": "/app/reading/academic",
    "fields": [
      "sets"
    ],
    "source": "src/app/app/(shell)/reading/academic/page.tsx",
    "fn": "AcademicReadingResults"
  },
  {
    "name": "management",
    "path": "/app/management",
    "fields": [],
    "roles": [
      "teacher",
      "admin",
      "owner"
    ],
    "source": "src/app/app/(shell)/management/page.tsx",
    "fn": "ManagementPage"
  },
  {
    "name": "speaking",
    "path": "/app/speaking",
    "fields": [],
    "source": "src/app/app/(shell)/speaking/page.tsx",
    "fn": "SpeakingPage"
  },
  {
    "name": "notifications",
    "path": "/app/notifications",
    "fields": [
      "rows"
    ],
    "dates": [
      "rows.createdAt"
    ],
    "source": "src/app/app/(shell)/notifications/page.tsx",
    "fn": "NotificationsPage"
  },
  {
    "name": "owner-audit",
    "path": "/app/owner/audit",
    "fields": [
      "rows"
    ],
    "dates": [
      "rows.createdAt"
    ],
    "roles": [
      "owner"
    ],
    "source": "src/app/app/(shell)/owner/audit/page.tsx",
    "fn": "OwnerAuditPage"
  },
  {
    "name": "admin-content",
    "path": "/app/admin/content",
    "fields": [
      "inventory",
      "writingOther"
    ],
    "roles": [
      "admin",
      "owner"
    ],
    "source": "src/app/app/(shell)/admin/content/page.tsx",
    "fn": "ContentLibraryResults"
  },
  {
    "name": "admin-materials",
    "path": "/app/admin/materials",
    "fields": [
      "counts"
    ],
    "roles": [
      "teacher",
      "admin",
      "owner"
    ],
    "source": "src/app/app/(shell)/admin/materials/page.tsx",
    "fn": "AdminMaterialsPage"
  }
];
