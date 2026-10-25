import {test} from 'node:test';
import assert from 'node:assert/strict';
import {YOUTUBE_ID,embedUrlFor,youtubeThumbnailUrl,safeEmbedOrigin,safeDirectMedia,formatClock,minutesFrom} from '../modules/video/provider.js';
import {standaloneState,videoLibraryDTO,videoStudioDTO,videoDetailDTO} from '../js/adapters/video-v47.js';

const ID='00000000-0000-4000-8000-0000000000a1',ID2='00000000-0000-4000-8000-0000000000a2',LESSON='00000000-0000-4000-8000-0000000000c1';
const OCC='00000000-0000-4000-8000-0000000000d1',LEX='00000000-0000-4000-8000-0000000000e1',Q='00000000-0000-4000-8000-0000000000f1';

test('YouTube ids are exactly 11 characters of the provider alphabet', () => {
  assert.ok(YOUTUBE_ID.test('dQw4w9WgXcQ'));
  assert.ok(YOUTUBE_ID.test('abc_-DEF123'));
  for (const bad of ['short', 'toolongidentifier', 'bad id!!!!', '', 'dQw4w9WgXc"']) assert.equal(YOUTUBE_ID.test(bad), false, bad);
});

test('embed URL keeps the original parameter order, no-cookie host and no autoplay', () => {
  const url = embedUrlFor('youtube', 'dQw4w9WgXcQ', { origin: 'https://app.example.invalid' });
  assert.equal(url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&enablejsapi=1&controls=1&cc_load_policy=1&origin=https%3A%2F%2Fapp.example.invalid');
  assert.equal(/autoplay/i.test(url), false);
});

test('resume appends &start= only for a positive position, rounded down', () => {
  assert.ok(embedUrlFor('youtube', 'dQw4w9WgXcQ', { start: 42.9 }).endsWith('&start=42'));
  assert.equal(embedUrlFor('youtube', 'dQw4w9WgXcQ', { start: 0 }).includes('start='), false);
  assert.equal(embedUrlFor('youtube', 'dQw4w9WgXcQ').includes('origin='), false, 'no origin unless configured');
});

test('embed refuses unknown providers and malformed ids instead of framing them', () => {
  assert.throws(() => embedUrlFor('vimeo', 'dQw4w9WgXcQ'));
  assert.throws(() => embedUrlFor('youtube', 'javascript:alert(1)'));
});

test('origin parameter accepts only scheme and host, never wildcard or path', () => {
  assert.equal(safeEmbedOrigin('https://app.example.invalid'), 'https://app.example.invalid');
  assert.equal(safeEmbedOrigin('https://app.example.invalid:8443'), 'https://app.example.invalid:8443');
  for (const bad of ['*', 'https://a.example/path', 'javascript:alert(1)', '', null, 42]) assert.equal(safeEmbedOrigin(bad), null, String(bad));
});

test('thumbnails only for validated YouTube ids', () => {
  assert.equal(youtubeThumbnailUrl('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(youtubeThumbnailUrl('nope'), null);
});

test('direct media must be https and captions must share the media origin', () => {
  assert.deepEqual(safeDirectMedia({ src: 'https://media.example.invalid/a.mp4', captions: 'https://media.example.invalid/a.vtt' }), { src: 'https://media.example.invalid/a.mp4', captions: 'https://media.example.invalid/a.vtt' });
  assert.deepEqual(safeDirectMedia({ src: 'https://media.example.invalid/a.mp4' }), { src: 'https://media.example.invalid/a.mp4', captions: null });
  assert.equal(safeDirectMedia({ src: 'http://media.example.invalid/a.mp4' }), null);
  assert.equal(safeDirectMedia({ src: 'https://media.example.invalid/a.mp4', captions: 'https://other.example.invalid/a.vtt' }), null);
  assert.equal(safeDirectMedia({ src: 'not a url' }), null);
  assert.equal(safeDirectMedia(null), null);
});

test('clock and minute labels follow the original rules', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65.9), '1:05');
  assert.equal(formatClock(-3), '0:00');
  assert.equal(minutesFrom(null), null);
  assert.equal(minutesFrom(0), null);
  assert.equal(minutesFrom(20), 1, 'at least one minute');
  assert.equal(minutesFrom(1080), 18);
});

test('standalone card state: completed and in_progress from progress, else available', () => {
  assert.equal(standaloneState('completed'), 'completed');
  assert.equal(standaloneState('in_progress'), 'in_progress');
  assert.equal(standaloneState(null), 'available');
  assert.equal(standaloneState('not_started'), 'available');
});

const libRow = (over = {}) => ({ id: ID, title: 'Talk', provider: 'youtube', videoId: 'dQw4w9WgXcQ', durationSeconds: 600, progressState: null, ...over });
const courseRow = (over = {}) => ({ id: ID2, title: 'Course talk', provider: 'youtube', videoId: 'dQw4w9WgXcQ', durationSeconds: 600, state: 'locked', lessonId: LESSON, courseSlug: 'ielts', courseTitle: 'IELTS', unitTitle: 'Unit A', ...over });

test('library projection keeps real rows, maps standalone states and keeps course rows unfiltered', () => {
  const dto = videoLibraryDTO({ standalone: [libRow({ progressState: 'completed' })], course: [courseRow()] });
  assert.equal(dto.standalone[0].state, 'completed');
  assert.equal(dto.course[0].state, 'locked', 'the caller applies isOpen; the adapter does not drop rows');
});

test('library projection rejects malformed rows instead of rendering partial lessons', () => {
  assert.throws(() => videoLibraryDTO({ standalone: [libRow({ videoId: 'bad' })], course: [] }));
  assert.throws(() => videoLibraryDTO({ standalone: [libRow({ provider: 'vimeo' })], course: [] }));
  assert.throws(() => videoLibraryDTO({ standalone: [], course: [courseRow({ state: 'nonsense' })] }));
  assert.throws(() => videoLibraryDTO({ standalone: [] }));
});

const studio = (over = {}) => ({
  videoLesson: { id: ID, provider: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'Talk', beforeYouWatch: null, durationSeconds: 600, transcript: null, transcriptSource: null, transcriptAttribution: null, transcriptText: 'Plain', notes: null },
  questions: [{ id: Q, stage: 'comprehension', prompt: 'Why?', atSeconds: null }],
  progress: { state: 'in_progress', watchedSeconds: 12, answers: { [Q]: { answer: 'because', correct: true } }, responseText: null, summaryText: null },
  vocabulary: { ready: true, items: [{ occurrenceId: OCC, id: LEX, term: 'word', partOfSpeech: null, definitionEn: 'a unit', translationUz: null, exampleSentence: null }] },
  directMedia: null,
  embedOrigin: 'https://app.example.invalid',
  ...over,
});

test('studio projection passes validated data through and nulls an unsafe embed origin', () => {
  const dto = videoStudioDTO(studio({ embedOrigin: '*' }));
  assert.equal(dto.embedOrigin, null);
  assert.equal(dto.progress.answers[Q].correct, true, 'graded flag is passed from the server, never recomputed');
  assert.equal(dto.questions.length, 1);
});

test('studio projection rejects an unknown provider and a malformed transcript line; drops http media', () => {
  assert.throws(() => videoStudioDTO(studio({ videoLesson: { ...studio().videoLesson, provider: 'vimeo' } })));
  assert.equal(videoStudioDTO(studio({ videoLesson: { ...studio().videoLesson, provider: 'direct', videoId: 'clip.mp4' }, directMedia: { src: 'http://media.example.invalid/a.mp4' } })).directMedia, null, 'http media is dropped, so the detail shows the blocked notice');
  assert.throws(() => videoStudioDTO(studio({ videoLesson: { ...studio().videoLesson, transcript: [{ startSeconds: -1, text: 'x' }] } })));
});

test('direct media only attaches to direct items, and only validated URLs survive', () => {
  const dto = videoStudioDTO(studio({ videoLesson: { ...studio().videoLesson, provider: 'direct', videoId: 'clip.mp4' }, directMedia: { src: 'https://media.example.invalid/clip.mp4', captions: null } }));
  assert.deepEqual(dto.directMedia, { src: 'https://media.example.invalid/clip.mp4', captions: null });
  const yt = videoStudioDTO(studio({ directMedia: { src: 'https://media.example.invalid/clip.mp4', captions: null } }));
  assert.equal(yt.directMedia, null);
});

test('detail: null means not live or not found; a mismatched id is a validation failure', () => {
  assert.equal(videoDetailDTO({ detail: null }, ID), null);
  assert.throws(() => videoDetailDTO({}, ID));
  assert.throws(() => videoDetailDTO({ detail: studio() }, ID2));
  assert.equal(videoDetailDTO({ detail: studio() }, ID).videoLesson.id, ID);
});
