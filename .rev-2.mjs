import { open, tapWorld, st, w2p } from './.rev-lib.mjs';
const { browser, page } = await open();
const before = await st(page);
console.log('before', before.coins, before.conns.length, 'offers', before.offers);

// CLAIM 1: one tap on the ring at (2,-2) -> earning
const p = await tapWorld(page, 2, -2, 200);
console.log('tapped at', p);
await page.screenshot({ path: '/home/user/games/.rev-shot/02-surge.png' });
await page.waitForTimeout(2500);
const a = await page.evaluate(() => { const s = window.flowy.getState(); return { coins: s.coins, income: s.meters.incomeC, conns: s.edges.length, anchor: s.selection, notice: s.notice }; });
console.log('after 1 tap', a);
await page.screenshot({ path: '/home/user/games/.rev-shot/03-after1.png' });
await browser.close();
