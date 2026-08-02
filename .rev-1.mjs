import { open, box, st } from './.rev-lib.mjs';
const { browser, page } = await open();
console.log('viewport', page.viewportSize());
console.log('canvas box', await box(page));
const s = await page.evaluate(() => {
  const g = window.flowy?.getState?.();
  if (!g) return 'NO DEV HANDLE';
  return JSON.stringify(Object.fromEntries(Object.entries(g).map(([k,v]) => [k, typeof v === 'object' && v !== null ? (Array.isArray(v) ? `[${v.length}]` : Object.keys(v)) : v])), null, 1);
});
console.log(s);
await page.screenshot({ path: '/home/user/games/.rev-shot/01-fresh.png' });
await browser.close();
