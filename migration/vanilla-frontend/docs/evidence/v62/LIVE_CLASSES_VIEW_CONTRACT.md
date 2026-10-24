# V61 Live Classes — read projection contract (NOT IMPLEMENTED on main)

The original Next.js page in `main` reads directly from `courses`, `liveClasses`,
`liveClassAttendance`, `users` and student `ResourceBlocks` — there is **no**
`GET /api/live-classes` read route in the current main. The existing
`POST /api/live-classes/:id/join` is authoritative and untouched.

V61 calls the pre-existing **proposed** Arena view adapter
`GET /api/frontend/view?route=%2Fapp%2Flive-classes`, via `viewData('/app/live-classes')`.
Until a compatible authenticated read projection is implemented, the V61 route
shows an honest integration-required error with a retry action. **Never replace
it with fake classes, fabricated attendance or guessed teacher names.**

Expected existing view-adapter envelope (for an authorized current user):

```json
{
  "version": 1,
  "route": "/app/live-classes",
  "data": {
    "courseAvailable": true,
    "upcoming": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "title": "Source-authored title",
        "topic": null,
        "teacherUserId": null,
        "scheduledAt": "2026-10-25T10:00:00.000Z",
        "durationMinutes": 60,
        "status": "upcoming",
        "meetingUrl": null,
        "recordingUrl": null
      }
    ],
    "past": [],
    "attendance": [],
    "teachers": [],
    "materials": {},
    "metadataUnavailable": false
  }
}
```

The example above is a **type-contract illustration only**, not a fixture
installed into the browser runtime.

## Required server guarantees (to be implemented separately with approval)

- Re-derive identity from session; never accept a caller-provided user ID.
- Verify an active user is entitled to this IELTS course and its visible classes.
- Use `ielts` stable course slug, sort upcoming ascending and past descending;
  include only upcoming/live and the last 10 completed/recorded/cancelled rows.
- Attendance rows are only those belonging to the session user, and attendance
  is **core**; if it cannot load, fail the entire read rather than invent `not joined`.
- Teacher names and resource blocks are secondary: report a partial metadata
  failure without removing core class cards.
- Preserve the original `/api/resources/<key>` authentication gate.
- Join writes remain on the existing `POST /api/live-classes/:id/join` endpoint;
  the **server** must re-check window status (-15/+30 mins, live override).
- The client must not infer a successful join from the presence of meetingUrl.
- Do not ship a read endpoint from the frontend migration package.

## Explicitly not yet certified

Live API payload, real session, private file playback, original-rendered CSS,
Safari/mobile, network concurrency, multiple accounts and full Arena build.
