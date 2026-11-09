import assert from 'node:assert/strict';

export async function settlePlaybarGlow(playbar) {
  const cover = playbar.locator('.playbar-glow img').last();
  await cover.waitFor();
  await cover.evaluate(async image => {
    await image.decode();
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(image.parentElement.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
}

/** Measure the least favorable rendered background pixel under each text box. */
export async function measurePlaybarContrast(page) {
  const selector = '.playbar .now-playing :is(strong, small)';
  const boxes = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    const { color, visibility } = getComputedStyle(element);
    if (visibility !== 'visible' || !element.textContent.trim()) throw new Error('Expected visible playbar text');
    return { left, top, right, bottom, color };
  }));
  assert.equal(boxes.length, 2);
  const clip = {
    x: Math.floor(Math.min(...boxes.map(box => box.left))),
    y: Math.floor(Math.min(...boxes.map(box => box.top))),
  };
  clip.width = Math.ceil(Math.max(...boxes.map(box => box.right))) - clip.x;
  clip.height = Math.ceil(Math.max(...boxes.map(box => box.bottom))) - clip.y;
  const hidden = await page.addStyleTag({ content: selector + ' { visibility:hidden !important; }' });
  let background;
  try {
    background = await page.screenshot({ clip, scale: 'device' });
  } finally {
    await hidden.evaluate(style => style.remove());
  }
  const ratios = await page.evaluate(async ({ boxes, clip, png }) => {
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const scale = devicePixelRatio;
    if (bitmap.width !== clip.width * scale || bitmap.height !== clip.height * scale) throw new Error('Unexpected screenshot scale');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const channel = Array.from({ length: 256 }, (_, i) => {
      const value = i / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    const luminance = (r, g, b) => .2126 * channel[r] + .7152 * channel[g] + .0722 * channel[b];
    return boxes.map(box => {
      // Select pixels by their centers so the crop excludes adjoining elements.
      const x = Math.ceil((box.left - clip.x) * scale - .5);
      const y = Math.ceil((box.top - clip.y) * scale - .5);
      const width = Math.ceil((box.right - clip.x) * scale - .5) - x;
      const height = Math.ceil((box.bottom - clip.y) * scale - .5) - y;
      const { data } = context.getImageData(x, y, width, height);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = box.color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (alpha !== 255) throw new Error('Expected opaque playbar text: ' + box.color);
      const text = luminance(r, g, b);
      let minimum = Infinity;
      for (let i = 0; i < data.length; i += 4) {
        const background = luminance(data[i], data[i + 1], data[i + 2]);
        minimum = Math.min(minimum, (Math.max(text, background) + .05) / (Math.min(text, background) + .05));
      }
      return minimum;
    });
  }, { boxes, clip, png: background.toString('base64') });
  return { ratios, background };
}
