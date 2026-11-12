/** /app/progress for everyone: guardians get the read-only child view, all other roles the unchanged page. */
export async function mount(ctx) {
  const guardian = ctx.session?.user?.role === 'guardian';
  const page = guardian ? await import('./progress.js') : await import('../progress/page.js');
  return page.mount(ctx);
}
