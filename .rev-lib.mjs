import { chromium, devices } from '@playwright/test';

export async function open(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text()); });
  await page.goto('http://localhost:5180/#/flowy');
  await page.waitForTimeout(opts.wait ?? 1200);
  return { browser, page };
}

export async function box(page) {
  return await page.locator('.flowy-canvas').boundingBox();
}

// world -> page using live camera from dev handle
export async function w2p(page, x, y) {
  const b = await box(page);
  const cam = await page.evaluate(() => {
    const s = window.flowy?.getState?.();
    return s ? { cx: s.camera?.x, cy: s.camera?.y, z: s.camera?.zoom } : null;
  });
  const c = cam && cam.cx != null ? cam : { cx: 0.5, cy: 0.5, z: 56 };
  return {
    x: (x - c.cx) * c.z + b.x + b.width / 2,
    y: (y - c.cy) * c.z + b.y + b.height / 2,
  };
}

export async function tapWorld(page, x, y, waitMs = 450) {
  const p = await w2p(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(waitMs);
  return p;
}

export async function st(page) {
  return await page.evaluate(() => {
    const s = window.flowy.getState();
    return {
      coins: s.coins, anchor: s.anchor ?? s.anchorId ?? null,
      selected: s.selection ?? s.selected ?? null,
      conns: (s.connections ?? []).map(c => ({ id: c.id, from: c.from ?? c.a, to: c.to ?? c.b, pol: c.polarity })),
      offers: (s.offers ?? []).length,
      keys: Object.keys(s),
    };
  });
}
