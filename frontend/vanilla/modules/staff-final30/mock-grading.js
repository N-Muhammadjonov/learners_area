/**
 * Teacher / Owner Mock Grading Center (`/app/management?view=mock-grading`).
 *
 * Implements Section 04 (Figures 4 & 5) and Section 12 of the Mock Architecture Plan:
 * - Role-gated to `teacher` (assigned students only) and `owner` (all students); `admin` is refused.
 * - Uses only existing Learners Area theme tokens (`panel`, `card`, `btn-primary`, `btn-secondary`,
 *   `input`, `badge`) for 1:1 Day and Night compatibility.
 * - Supports date/section/status/student filters, 25-per-page pagination, Writing DOCX & Speaking ZIP
 *   batch export, Gemini prompt copy, `la.mock.grading.v1` JSON dry-run validation preview & commit,
 *   per-criterion / feedback revision editing (append-only), approval, and two-step bulk publication
 *   with explicit confirmation count ("X of Y will publish").
 */
import {el, listen, mountStaff, heading, badge, pager, pageParam, fill} from './kit.js';
import {api} from '../../js/api-client.js';
import {rawJson} from '../../js/adapters/staff-final30/core.js';

const STRINGS = {
  en: {
    title: 'Mock Grading Center',
    subtitle: 'Management / Weekly grading · Teacher / Owner',
    backManagement: '← Management',
    submissions: 'Submissions',
    pendingReview: 'Pending review',
    readyToPublish: 'Ready to publish',
    filterDateFrom: 'Date from',
    filterDateTo: 'Date to',
    filterSection: 'Section',
    filterStatus: 'Status',
    filterStudent: 'Student ID / name',
    applyFilters: 'Apply filters',
    secAll: 'All',
    secWriting: 'Writing',
    secSpeaking: 'Speaking',
    stUngraded: 'Ungraded (default)',
    stAll: 'All statuses',
    stAwaitingExport: 'Awaiting export',
    stExported: 'Exported',
    stImportedDraft: 'Imported draft',
    stNeedsReview: 'Needs review',
    stApproved: 'Approved',
    stPublished: 'Published',
    exportWritingBtn: 'Export Writing DOCX',
    exportSpeakingBtn: 'Export Speaking ZIP',
    exportCombinedBtn: 'Export DOCX / audio ZIP',
    importJsonBtn: 'Import JSON',
    reviewPublishBtn: 'Review & Publish',
    promptsBtn: 'AI Prompts',
    batchHeading: 'Batch Queue • Writing / Speaking',
    emptyQueue: 'No mock submissions match the selected filters.',
    readyForApproval: 'Ready for approval',
    needsReviewStatus: 'Needs review',
    awaitingReviewStatus: 'Awaiting review',
    approvedStatus: 'Approved',
    publishedStatus: 'Published',
    approveBtn: 'Approve',
    approvedDone: 'Approved ✓',
    editRevisionBtn: 'Edit / Revise',
    saveRevisionBtn: 'Save new revision',
    cancelBtn: 'Cancel',
    validateBtn: 'Validate JSON (Dry-run)',
    commitBtn: 'Commit Validated Drafts',
    publishBatchConfirm: '{approved} of {total} will publish',
    publishNowBtn: 'Confirm & Publish Approved',
    downloadExport: 'Download export file',
    importPanelTitle: 'Import AI Grading JSON (la.mock.grading.v1)',
    importPlaceholder: 'Paste the grading JSON from your AI assistant here…',
    promptsPanelTitle: 'AI grading prompts (copy and paste)',
    pageOf: 'Page {page} of {total}',
    prev: 'Previous',
    next: 'Next',
  },
  uz: {
    title: 'Mock Grading Center',
    subtitle: 'Boshqaruv / Haftalik baholash · Teacher / Owner',
    backManagement: '← Boshqaruv',
    submissions: 'Topshiriqlar',
    pendingReview: 'Tekshiruv kutilmoqda',
    readyToPublish: 'E’lon qilishga tayyor',
    filterDateFrom: 'Sanadan',
    filterDateTo: 'Sanagacha',
    filterSection: 'Bo‘lim',
    filterStatus: 'Holat',
    filterStudent: 'Talaba ID / ism',
    applyFilters: 'Filtrlash',
    secAll: 'Barchasi',
    secWriting: 'Writing',
    secSpeaking: 'Speaking',
    stUngraded: 'Baholanmagan (standart)',
    stAll: 'Barcha holatlar',
    stAwaitingExport: 'Eksport kutilmoqda',
    stExported: 'Eksport qilingan',
    stImportedDraft: 'Qoralama yuklangan',
    stNeedsReview: 'Tekshiruv zarur',
    stApproved: 'Tasdiqlangan',
    stPublished: 'E’lon qilingan',
    exportWritingBtn: 'Writing DOCX eksport',
    exportSpeakingBtn: 'Speaking ZIP eksport',
    exportCombinedBtn: 'Export DOCX / audio ZIP',
    importJsonBtn: 'Import JSON',
    reviewPublishBtn: 'Review & Publish',
    promptsBtn: 'AI Prompts',
    batchHeading: 'Batch navbati • Writing / Speaking',
    emptyQueue: 'Tanlangan filtrlar bo‘yicha mock topshiriqlari topilmadi.',
    readyForApproval: 'Tasdiqlashga tayyor',
    needsReviewStatus: 'Tekshiruv zarur',
    awaitingReviewStatus: 'Tekshiruv kutilmoqda',
    approvedStatus: 'Tasdiqlangan',
    publishedStatus: 'E’lon qilingan',
    approveBtn: 'Tasdiqlash',
    approvedDone: 'Tasdiqlangan ✓',
    editRevisionBtn: 'Tahrirlash (yangi revision)',
    saveRevisionBtn: 'Yangi revision saqlash',
    cancelBtn: 'Bekor qilish',
    validateBtn: 'JSON tekshirish (Dry-run)',
    commitBtn: 'Tasdiqlangan qoralamalarni saqlash',
    publishBatchConfirm: '{total} tadan {approved} tasi e’lon qilinadi',
    publishNowBtn: 'Tasdiqlash va e’lon qilish',
    downloadExport: 'Eksport faylni yuklab olish',
    importPanelTitle: 'AI baholash JSON natijalarini yuklash (la.mock.grading.v1)',
    importPlaceholder: 'AI yordamchi qaytargan JSON matnini joylang…',
    promptsPanelTitle: 'AI baholash promptlari (nusxalash)',
    pageOf: '{page} / {total} sahifa',
    prev: 'Oldingi',
    next: 'Keyingi',
  },
};

function labels(ctx) {
  return ctx?.locale === 'uz' ? STRINGS.uz : STRINGS.en;
}

async function loadQueue(ctx) {
  const {url, signal} = ctx;
  const params = new URLSearchParams();
  for (const key of ['section', 'status', 'dateFrom', 'dateTo', 'weeklySlot', 'student']) {
    const val = url.searchParams.get(key);
    if (val) params.set(key, val);
  }
  const page = pageParam(url, 'page');
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  const res = await api.request('/api/frontend/staff/mock-grading' + (query ? `?${query}` : ''), {signal});
  return res?.data || res;
}

export const mockGradingMount = mountStaff({
  name: 'mock-grading',
  roles: ['teacher', 'owner'],
  load: loadQueue,
  render(ctx, data, viewApi) {
    const L = labels(ctx);
    const {signal, url, navigate} = ctx;
    const summary = data?.summary || {submissions: 0, pendingReview: 0, readyToPublish: 0, published: 0};
    const filters = data?.filters || {section: 'all', status: 'ungraded', dateFrom: '', dateTo: '', student: ''};
    const items = Array.isArray(data?.items) ? data.items : [];
    const batches = Array.isArray(data?.batches) ? data.batches : [];
    const prompts = data?.prompts || {};

    const statusAlert = el('div', {role: 'status', class: 'panel hidden text-sm text-ink-900', 'data-mock-grading-status': ''});
    const importPanel = el('div', {class: 'panel hidden flex-col gap-3', 'data-mock-import-panel': ''});
    const promptsPanel = el('div', {class: 'panel hidden flex-col gap-3', 'data-mock-prompts-panel': ''});
    const publishPanel = el('div', {class: 'panel hidden flex-col gap-3', 'data-mock-publish-panel': ''});

    function showNotice(text, isError = false) {
      statusAlert.textContent = text;
      statusAlert.className = `panel text-sm ${isError ? 'border-band-bad/40 text-band-bad' : 'border-band-good/40 text-band-good'}`;
      statusAlert.classList.remove('hidden');
    }

    // Filter controls
    const secSelect = el('select', {class: 'input sm:w-40', 'aria-label': L.filterSection, 'data-filter-section': ''},
      el('option', {value: 'all', selected: filters.section === 'all'}, L.secAll),
      el('option', {value: 'writing', selected: filters.section === 'writing'}, L.secWriting),
      el('option', {value: 'speaking', selected: filters.section === 'speaking'}, L.secSpeaking),
    );
    secSelect.value = filters.section || 'all';

    const statusSelect = el('select', {class: 'input sm:w-48', 'aria-label': L.filterStatus, 'data-filter-status': ''},
      el('option', {value: 'ungraded', selected: filters.status === 'ungraded'}, L.stUngraded),
      el('option', {value: 'all', selected: filters.status === 'all'}, L.stAll),
      el('option', {value: 'awaiting_export', selected: filters.status === 'awaiting_export'}, L.stAwaitingExport),
      el('option', {value: 'exported', selected: filters.status === 'exported'}, L.stExported),
      el('option', {value: 'imported_draft', selected: filters.status === 'imported_draft'}, L.stImportedDraft),
      el('option', {value: 'needs_review', selected: filters.status === 'needs_review'}, L.stNeedsReview),
      el('option', {value: 'approved', selected: filters.status === 'approved'}, L.stApproved),
      el('option', {value: 'published', selected: filters.status === 'published'}, L.stPublished),
    );
    statusSelect.value = filters.status || 'ungraded';

    const dateFromInput = el('input', {
      type: 'date',
      class: 'input sm:w-40',
      value: filters.dateFrom || '',
      'aria-label': L.filterDateFrom,
      'data-filter-date-from': '',
    });
    const dateToInput = el('input', {
      type: 'date',
      class: 'input sm:w-40',
      value: filters.dateTo || '',
      'aria-label': L.filterDateTo,
      'data-filter-date-to': '',
    });
    const studentInput = el('input', {
      type: 'search',
      class: 'input sm:w-48',
      value: filters.student || '',
      placeholder: L.filterStudent,
      'aria-label': L.filterStudent,
      'data-filter-student': '',
      'data-focus-key': 'mock-grading-student-filter',
    });

    const filterForm = el('form', {class: 'panel flex flex-wrap items-center gap-3', 'data-mock-grading-filters': ''},
      dateFromInput,
      dateToInput,
      secSelect,
      statusSelect,
      studentInput,
      el('button', {type: 'submit', class: 'btn-secondary btn-sm', 'data-filter-apply': ''}, L.applyFilters),
    );
    listen(filterForm, 'submit', e => {
      e.preventDefault();
      const nextUrl = new URL(url.href);
      nextUrl.searchParams.set('view', 'mock-grading');
      const setOrDel = (k, v) => (v ? nextUrl.searchParams.set(k, v) : nextUrl.searchParams.delete(k));
      setOrDel('section', secSelect.value);
      setOrDel('status', statusSelect.value);
      setOrDel('dateFrom', dateFromInput.value);
      setOrDel('dateTo', dateToInput.value);
      setOrDel('student', studentInput.value.trim());
      nextUrl.searchParams.delete('page');
      ctx.url = nextUrl;
      void navigate(nextUrl.pathname + nextUrl.search, {replace: true});
      void viewApi.reload();
    }, signal);

    // Summary KPI cards (matching Figures 4 & 5)
    const kpiGrid = el('div', {class: 'grid grid-cols-1 gap-4 sm:grid-cols-3', 'data-mock-grading-kpis': ''},
      el('div', {class: 'panel flex flex-col gap-1', 'data-kpi-submissions': ''},
        el('span', {class: 'text-xs text-ink-500'}, L.submissions),
        el('span', {class: 'font-display text-3xl font-bold text-ink-900'}, String(summary.submissions))),
      el('div', {class: 'panel flex flex-col gap-1', 'data-kpi-pending': ''},
        el('span', {class: 'text-xs text-ink-500'}, L.pendingReview),
        el('span', {class: 'font-display text-3xl font-bold text-ink-900'}, String(summary.pendingReview))),
      el('div', {class: 'panel flex flex-col gap-1', 'data-kpi-ready': ''},
        el('span', {class: 'text-xs text-ink-500'}, L.readyToPublish),
        el('span', {class: 'font-display text-3xl font-bold text-ink-900'}, String(summary.readyToPublish))),
    );

    // Import JSON modal/panel content
    const batchSelectForImport = el('select', {class: 'input', 'aria-label': 'Select batch', 'data-import-batch-select': ''},
      el('option', {value: ''}, 'Auto-detect from JSON batch_id'),
      ...batches.map(b => el('option', {value: b.batchCode}, `${b.batchCode} (${b.section} · ${b.status})`)),
    );
    const jsonTextarea = el('textarea', {
      class: 'input min-h-[180px] font-mono text-xs',
      placeholder: L.importPlaceholder,
      'aria-label': L.importPanelTitle,
      'data-import-json-textarea': '',
    });
    const dryRunReportHost = el('div', {class: 'flex flex-col gap-2 text-xs', 'data-import-dryrun-report': ''});
    const validateBtn = el('button', {type: 'button', class: 'btn-secondary btn-sm', 'data-import-validate-btn': ''}, L.validateBtn);
    const commitBtn = el('button', {type: 'button', class: 'btn-primary btn-sm', disabled: true, 'data-import-commit-btn': ''}, L.commitBtn);

    let lastValidatedPayload = null;
    let validationGeneration=0;
    const invalidateImport=()=>{validationGeneration++;lastValidatedPayload=null;commitBtn.disabled=true;dryRunReportHost.replaceChildren();};
    listen(jsonTextarea,'input',invalidateImport,signal);
    listen(batchSelectForImport,'change',invalidateImport,signal);
    listen(validateBtn, 'click', async () => {
      invalidateImport();
      const generation=validationGeneration;
      let parsed;
      try {
        parsed = JSON.parse(jsonTextarea.value);
      } catch {
        showNotice('Invalid JSON syntax. Use the AI JSON Repair Prompt if needed.', true);
        return;
      }
      const reqBody = {
        batchId: batchSelectForImport.value || parsed.batch_id,
        gradingJson: parsed,
      };
      const res = await rawJson('POST', '/api/staff/mocks/grade-imports/validate', reqBody, signal);
      if (signal?.aborted||generation!==validationGeneration) return;
      const rep = res.data?.report;
      if (!res.ok || !rep) {
        showNotice(res.data?.error?.message || 'Validation failed.', true);
        return;
      }
      const c = rep.counts || {};
      const summaryStats = `Valid: ${c.valid || 0} · Needs review: ${c.needsReview || 0} · Missing: ${c.missing || 0} · Duplicate: ${c.duplicate || 0} · Out of scope: ${c.outOfScope || 0} · Hash mismatch: ${c.hashMismatch || 0} · Malformed: ${c.malformed || 0}`;
      dryRunReportHost.append(
        el('p', {class: 'font-semibold text-ink-900', 'data-dryrun-summary': ''}, summaryStats),
        ...(rep.issues || []).map(iss =>
          el('p', {class: 'text-band-bad'}, `[${iss.errorCode}] ${iss.studentAlias || ''} ${iss.details || ''}`)),
      );
      if (rep.ok) {
        lastValidatedPayload = reqBody;
        commitBtn.disabled = false;
      }
    }, signal);

    listen(commitBtn, 'click', async () => {
      if (!lastValidatedPayload) return;
      commitBtn.disabled = true;
      const res = await rawJson('POST', '/api/staff/mocks/grade-imports/commit', lastValidatedPayload, signal);
      if (signal?.aborted) return;
      if (!res.ok || !res.data?.committed) {
        showNotice(res.data?.error?.message || 'Could not commit grading JSON.', true);
        return;
      }
      showNotice(`Imported ${res.data.revisions?.length || 0} grading draft(s).`);
      importPanel.classList.add('hidden');
      await viewApi.reload();
    }, signal);

    importPanel.append(
      el('h2', {class: 'font-display text-lg text-ink-900'}, L.importPanelTitle),
      batchSelectForImport,
      jsonTextarea,
      el('div', {class: 'flex flex-wrap gap-2'}, validateBtn, commitBtn),
      dryRunReportHost,
    );

    // Gemini Prompts panel
    promptsPanel.append(
      el('h2', {class: 'font-display text-lg text-ink-900'}, L.promptsPanelTitle),
      el('div', {class: 'grid grid-cols-1 gap-3 lg:grid-cols-3'},
        ['writing', 'speaking', 'repair'].map(pKey =>
          el('div', {class: 'flex flex-col gap-1'},
            el('strong', {class: 'text-xs uppercase text-ink-500'}, pKey),
            el('textarea', {
              readonly: true,
              class: 'input min-h-[160px] font-mono text-xs',
              value: prompts[pKey] || '',
              'data-gemini-prompt': pKey,
            })))),
    );

    // Publish Batch confirmation panel (two-step bulk publish)
    function renderPublishPanel() {
      publishPanel.replaceChildren(
        el('h2', {class: 'font-display text-lg text-ink-900'}, L.reviewPublishBtn),
        ...(batches.length === 0
          ? [el('p', {class: 'text-sm text-ink-500'}, L.emptyQueue)]
          : batches.map(b => {
              const confirmText = fill(L.publishBatchConfirm, {
                approved: b.approvedCount || 0,
                total: b.revisionCount || 0,
              });
              const pubBtn = el('button', {
                type: 'button',
                class: 'btn-primary btn-sm',
                disabled: (b.approvedCount || 0) === 0,
                'data-batch-publish-btn': b.id,
              }, `${L.publishNowBtn} (${confirmText})`);
              listen(pubBtn, 'click', async () => {
                pubBtn.disabled = true;
                const res = await rawJson('POST', `/api/staff/mocks/batches/${encodeURIComponent(b.id)}/publish`, {}, signal);
                if (signal?.aborted) return;
                if (!res.ok) {
                  pubBtn.disabled = false;
                  showNotice(res.data?.error?.message || 'Publish failed.', true);
                  return;
                }
                showNotice(res.data?.summaryMessage || 'Published approved grades.');
                await viewApi.reload();
              }, signal);

              return el('div', {class: 'flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-2', 'data-batch-row': b.batchCode},
                el('div', {class: 'flex flex-col gap-0.5'},
                  el('span', {class: 'text-sm font-semibold text-ink-900'}, `${b.batchCode} · ${b.section.toUpperCase()}`),
                  el('span', {class: 'text-xs text-ink-500', 'data-batch-publish-count': b.batchCode}, confirmText)),
                el('div', {class: 'flex flex-wrap items-center gap-2'},
                  el('a', {
                    href: `/api/staff/mocks/exports/${encodeURIComponent(b.id)}/download`,
                    class: 'btn-secondary btn-sm',
                    'data-batch-download': b.batchCode,
                  }, L.downloadExport),
                  pubBtn),
              );
            })),
      );
    }
    renderPublishPanel();

    // Queue Rows
    const queueRows = items.map(item => {
      const rev = item.revision;
      const stLabel = item.status === 'approved'
        ? L.approvedStatus
        : item.status === 'published'
          ? L.publishedStatus
          : item.status === 'imported_draft'
            ? L.readyForApproval
            : item.status === 'needs_review'
              ? L.needsReviewStatus
              : L.awaitingReviewStatus;
      const tone = item.status === 'published' || item.status === 'approved'
        ? 'good'
        : item.status === 'needs_review'
          ? 'warn'
          : 'neutral';

      const editHost = el('div', {class: 'hidden w-full flex-col gap-2 border-t border-ink-100 pt-2', 'data-revision-editor': item.submissionId});
      const actionsWrap = el('div', {class: 'flex flex-wrap items-center gap-2'});

      if (rev && rev.status !== 'published') {
        const approveBtn = el('button', {
          type: 'button',
          class: 'btn-secondary btn-sm',
          disabled: rev.status === 'approved' || rev.calculatedBand == null,
          'data-approve-revision': rev.id,
        }, rev.status === 'approved' ? L.approvedDone : L.approveBtn);
        listen(approveBtn, 'click', async () => {
          approveBtn.disabled = true;
          const res = await rawJson('POST', `/api/staff/mocks/grades/${encodeURIComponent(rev.id)}/approve`, {}, signal);
          if (signal?.aborted) return;
          if (!res.ok) {
            approveBtn.disabled = false;
            showNotice(res.data?.error?.message || 'Approval failed.', true);
            return;
          }
          showNotice(`Approved ${item.studentAlias} (${res.data?.calculatedBand ?? ''}).`);
          await viewApi.reload();
        }, signal);

        const editBtn = el('button', {
          type: 'button',
          class: 'btn-ghost btn-sm',
          'data-open-revision-editor': rev.id,
        }, L.editRevisionBtn);
        listen(editBtn, 'click', () => {
          editHost.classList.toggle('hidden');
        }, signal);

        const fbInput = el('textarea', {
          class: 'input min-h-[80px] text-xs',
          value: rev.payload?.overall_feedback || '',
          'aria-label': 'Overall feedback',
          'data-revise-feedback': rev.id,
        });
        const bandNote = el('span', {class: 'text-xs text-ink-500'},
          rev.calculatedBand != null ? `Calculated Band: ${Number(rev.calculatedBand).toFixed(1)}` : 'Needs criterion scores');
        const saveRevBtn = el('button', {
          type: 'button',
          class: 'btn-primary btn-sm',
          'data-save-revision': rev.id,
        }, L.saveRevisionBtn);

        listen(saveRevBtn, 'click', async () => {
          saveRevBtn.disabled = true;
          const body = {overallFeedback: fbInput.value};
          if (item.section === 'writing' && rev.payload?.tasks) {
            body.tasks = rev.payload.tasks;
          } else if (item.section === 'speaking' && rev.payload?.criteria) {
            body.criteria = rev.payload.criteria;
          }
          const res = await rawJson('POST', `/api/staff/mocks/grades/${encodeURIComponent(rev.id)}/revise`, body, signal);
          if (signal?.aborted) return;
          if (!res.ok) {
            saveRevBtn.disabled = false;
            showNotice(res.data?.error?.message || 'Could not save revision.', true);
            return;
          }
          showNotice(`Saved new revision for ${item.studentAlias}.`);
          await viewApi.reload();
        }, signal);

        editHost.append(bandNote, fbInput, saveRevBtn);
        actionsWrap.append(editBtn, approveBtn);
      }

      return el('div', {
        class: 'flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 py-3',
        'data-mock-queue-row': item.attemptId,
        'data-mock-queue-section': item.section,
      },
      el('div', {class: 'flex flex-col gap-0.5'},
        el('span', {class: 'text-sm font-medium text-ink-900'},
          `${item.studentAlias} / ${item.mockTitle} (${item.section.toUpperCase()})`),
        el('span', {class: 'text-xs text-ink-500'},
          `${item.studentName} · ${item.weeklySlot}${item.band != null ? ` · Band ${Number(item.band).toFixed(1)}` : ''}`)),
      el('div', {class: 'flex flex-wrap items-center gap-2'},
        badge(stLabel, tone, {'data-mock-queue-status': item.status}),
        actionsWrap),
      editHost);
    });

    const batchPanel = el('div', {class: 'panel flex flex-col gap-2', 'data-mock-batch-panel': ''},
      el('h2', {class: 'font-display text-lg text-ink-900'}, L.batchHeading),
      ...(queueRows.length ? queueRows : [el('p', {class: 'text-sm text-ink-500', 'data-mock-queue-empty': ''}, L.emptyQueue)]),
    );

    // Bottom CTA bar matching Figures 4 & 5: Export DOCX / audio ZIP | Import JSON | Review & Publish
    async function triggerExport(section) {
      const res = await rawJson('POST', '/api/staff/mocks/exports', {
        section,
        filterMode: filters.status === 'all' ? 'all' : 'ungraded',
        includePreviouslyExported: true,
        dateFrom: filters.dateFrom || null,
        dateTo: filters.dateTo || null,
        student: filters.student || null,
        weeklySlot: filters.weeklySlot || null,
      }, signal);
      if (signal?.aborted) return;
      if (!res.ok) {
        showNotice(res.data?.error?.message || `No ${section} submissions ready for export.`, true);
        return;
      }
      const created = res.data?.batches || [];
      showNotice(`Created ${created.length} ${section.toUpperCase()} export batch(es): ${created.map(b => b.batchCode).join(', ')}`);
      publishPanel.classList.remove('hidden');
      await viewApi.reload();
    }

    const exportWritingBtn = el('button', {
      type: 'button',
      class: 'btn-secondary',
      'data-export-writing-btn': '',
    }, L.exportWritingBtn);
    listen(exportWritingBtn, 'click', () => void triggerExport('writing'), signal);

    const exportSpeakingBtn = el('button', {
      type: 'button',
      class: 'btn-secondary',
      'data-export-speaking-btn': '',
    }, L.exportSpeakingBtn);
    listen(exportSpeakingBtn, 'click', () => void triggerExport('speaking'), signal);

    const openImportBtn = el('button', {
      type: 'button',
      class: 'btn-secondary',
      'data-open-import-btn': '',
    }, L.importJsonBtn);
    listen(openImportBtn, 'click', () => {
      importPanel.classList.toggle('hidden');
    }, signal);

    const openPromptsBtn = el('button', {
      type: 'button',
      class: 'btn-ghost btn-sm',
      'data-open-prompts-btn': '',
    }, L.promptsBtn);
    listen(openPromptsBtn, 'click', () => {
      promptsPanel.classList.toggle('hidden');
    }, signal);

    const openPublishBtn = el('button', {
      type: 'button',
      class: 'btn-primary',
      'data-open-publish-btn': '',
    }, L.reviewPublishBtn);
    listen(openPublishBtn, 'click', () => {
      publishPanel.classList.toggle('hidden');
    }, signal);

    const pagination = pager({
      label: L.title,
      page: data?.page || 1,
      totalPages: data?.totalPages || 1,
      href: p => {
        const u = new URL(url.href);
        u.searchParams.set('view', 'mock-grading');
        u.searchParams.set('page', String(p));
        return u.pathname + u.search;
      },
      pageOf: L.pageOf,
      previous: L.prev,
      next: L.next,
      attr: 'data-mock-grading-pager',
    });

    return el('div', {class: 'flex flex-col gap-5', 'data-mock-grading-center': ''},
      el('div', {class: 'flex flex-wrap items-center justify-between gap-3'},
        heading(L.title, L.subtitle),
        el('div', {class: 'flex items-center gap-2'},
          openPromptsBtn)),
      statusAlert,
      filterForm,
      kpiGrid,
      batchPanel,
      pagination,
      el('div', {class: 'flex flex-wrap items-center gap-3', 'data-mock-grading-actions': ''},
        exportWritingBtn,
        exportSpeakingBtn,
        openImportBtn,
        openPublishBtn),
      importPanel,
      publishPanel,
      promptsPanel,
    );
  },
});
