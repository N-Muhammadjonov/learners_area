/** Dismiss the ordinary daily receipt before testing an unrelated interaction. */
export async function dismissDailyReward(page){
 await page.waitForLoadState('networkidle');
 const dialog=page.locator('[data-daily-reward]');
 if(await dialog.isVisible())await dialog.locator('.daily-reward-close').click();
}
