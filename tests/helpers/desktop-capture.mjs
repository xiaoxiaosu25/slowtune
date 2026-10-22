import { writeFileSync } from 'node:fs';

// Capture the app's own native window, including caption buttons omitted by CDP.
export async function captureDesktopWindow(application, page, path) {
  const image = await application.evaluate(async ({ BrowserWindow, desktopCapturer }, url) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    if (!window) throw new Error('Screenshot target is not an application window');
    const [width, height] = window.getSize(), id = window.getMediaSourceId();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width, height }, fetchWindowIcons: false });
    const source = sources.find(source => source.id === id);
    if (!source || source.thumbnail.isEmpty()) throw new Error('Native window capture is unavailable');
    return source.thumbnail.toPNG().toString('base64');
  }, page.url());
  writeFileSync(path, Buffer.from(image, 'base64'));
}
