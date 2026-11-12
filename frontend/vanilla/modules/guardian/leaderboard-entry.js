/** /app/leaderboard for everyone: guardians get the read-only public ranking, all other roles the unchanged page. */
export async function mount(ctx) {
  const guardian = ctx.session?.user?.role === 'guardian';
  const page = guardian ? await import('./leaderboard.js') : await import('../study-plan/motivation.js');
  return page.mount(ctx);
}
