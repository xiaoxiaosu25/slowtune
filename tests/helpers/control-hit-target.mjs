import assert from 'node:assert/strict';

// Sample the glyph, empty padding and circular edges without Playwright's
// locator-click retries silently finding a different usable point.
export const controlPoints = [[.5, .5], [.5, .1], [.1, .5], [.9, .5], [.5, .9], [.25, .25], [.75, .75]];

export async function assertControlHitTarget(locator, minimum = 36) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate((element, points) => {
    const box = element.getBoundingClientRect();
    return {
      label: element.getAttribute('aria-label') || element.textContent.trim(),
      width: box.width, height: box.height,
      misses: points.flatMap(([x, y]) => {
        const target = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y);
        return element.contains(target) ? [] : [{ x, y, target: target?.outerHTML.slice(0, 180) }];
      }),
    };
  }, controlPoints);
  assert(result.width >= minimum && result.height >= minimum, JSON.stringify(result));
  assert.deepEqual(result.misses, [], JSON.stringify(result));
}

export async function clickControlPoint(page, locator, [x, y], touch = false) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box);
  const point = [box.x + box.width * x, box.y + box.height * y];
  if (touch) await page.touchscreen.tap(...point);
  else await page.mouse.click(...point);
}

export async function pressControlPoint(page, locator, [x, y]) {
  await locator.hover();
  const before = await locator.boundingBox();
  assert(before);
  await page.mouse.move(before.x + before.width * x, before.y + before.height * y);
  await page.mouse.down();
  try {
    // Outlast the press transition and verify the target itself never moves.
    await page.waitForTimeout(220);
    const during = await locator.boundingBox();
    assert(during);
    for (const property of ['x', 'y', 'width', 'height']) assert(Math.abs(before[property] - during[property]) < .1, JSON.stringify({ before, during, property }));
  } finally { await page.mouse.up(); }
}
