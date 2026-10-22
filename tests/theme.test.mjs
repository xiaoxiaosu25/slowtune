import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { registerHooks } from 'node:module';

// theme.ts is normally resolved by Vite; this native-TS unit harness also
// resolves its desktop storage dependency without changing the app's imports.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './preference-storage' && context.parentURL?.includes('/src/theme.ts') ? new URL('../src/preference-storage.ts', import.meta.url).href : specifier, context);
} });

const key = 'slow-listening:theme:v1';
const paletteKey = 'slow-listening:palette:v1';
let moduleId = 0;
const NativeDate = Date;
after(() => { globalThis.Date = NativeDate; });

function environment({ saved = null, savedPalette = null, dark = true, blocked = false, hour = 12, minute = 0 } = {}) {
  let now = new NativeDate(2026, 9, 15, hour, minute).getTime();
  class ThemeDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const values = new Map();
  if (saved !== null) values.set(key, saved);
  if (savedPalette !== null) values.set(paletteKey, savedPalette);
  const events = new Map();
  const documentEvents = new Map();
  const timers = new Map();
  let timerId = 0;
  const mediaEvents = new Map();
  const media = { matches: dark, addEventListener: (name, listener) => mediaEvents.set(name, listener) };
  const root = { dataset: {}, style: {} };
  const meta = { content: '', setAttribute(name, value) { this[name] = value; } };
  const storage = {
    blocked,
    getItem(name) { if (this.blocked) throw new Error('Storage denied'); return values.get(name) ?? null; },
    setItem(name, value) { if (this.blocked) throw new Error('Storage denied'); values.set(name, value); },
  };
  const document = { documentElement: root, hidden: false, querySelector: () => meta, addEventListener: (name, listener) => documentEvents.set(name, listener) };
  const window = { localStorage: storage, matchMedia: () => media, addEventListener: (name, listener) => events.set(name, listener),
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  return { window, document, storage, root, meta, values, Date: ThemeDate, timers,
    at(hour, minute = 0) { now = new NativeDate(2026, 9, 15, hour, minute).getTime(); },
    tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
    focus() { events.get('focus')(); },
    visible(hidden) { document.hidden = hidden; documentEvents.get('visibilitychange')(); },
    system(dark) { media.matches = dark; mediaEvents.get('change')(); },
    external(value, { eventKey = key, storageArea = storage } = {}) {
      events.get('storage')({ key: eventKey, newValue: value, storageArea });
    },
  };
}

async function load(env) {
  globalThis.window = env.window;
  globalThis.document = env.document;
  globalThis.Date = env.Date;
  const theme = await import('../src/theme.ts?test=' + ++moduleId);
  theme.initializeTheme();
  return theme;
}

test('global appearance follows the system, persists manual choices and responds to another tab', async () => {
  const env = environment();
  const theme = await load(env);
  assert.deepEqual(theme.getThemeState(), { preference: 'system', resolved: 'dark', palette: 'paper', persistent: true });
  assert.equal(env.root.dataset.theme, 'dark');
  assert.equal(env.meta.content, '#1B1916');
  let updates = 0;
  const unsubscribe = theme.subscribeTheme(() => updates++);
  env.system(false);
  assert.equal(env.root.dataset.theme, 'light');
  assert.equal(env.root.style.colorScheme, 'light');
  theme.setThemePreference('dark');
  assert.equal(env.values.get(key), 'dark');
  env.system(true);
  env.system(false);
  assert.equal(theme.getThemeState().resolved, 'dark', 'manual selection survives changes to the system');
  assert.equal(updates, 2, 'system events do not notify manual-theme subscribers');
  env.external('light');
  assert.equal(theme.getThemeState().preference, 'light');
  assert.equal(env.meta.content, '#F3F0E9');
  env.external('dark', { storageArea: {} });
  assert.equal(theme.getThemeState().resolved, 'light', 'unrelated storage events are ignored');
  env.external(null, { eventKey: null });
  assert.equal(theme.getThemeState().preference, 'system', 'clearing storage restores system mode');
  unsubscribe();
  const before = updates;
  theme.setThemePreference('dark');
  assert.equal(updates, before);
});

test('automatic mode switches at local 18:00 and 06:00, including suspended tabs, without overriding manual choices', async () => {
  const env = environment({ dark: false, hour: 17, minute: 59 });
  const theme = await load(env);
  assert.equal(theme.getThemeState().resolved, 'light');
  assert.equal([...env.timers.values()][0].delay, 60000);
  env.at(18); env.tick();
  assert.equal(theme.getThemeState().resolved, 'dark', 'night mode does not depend on a dark system theme');
  assert.equal(env.meta.content, '#1B1916');
  assert.equal([...env.timers.values()][0].delay, 12 * 60 * 60 * 1000);
  env.system(false);
  assert.equal(theme.getThemeState().resolved, 'dark', 'a light system event cannot undo night mode');
  env.at(6); env.tick();
  assert.equal(theme.getThemeState().resolved, 'light');
  env.at(23); env.visible(true);
  assert.equal(theme.getThemeState().resolved, 'light', 'hidden pages wait until they are shown');
  env.visible(false);
  assert.equal(theme.getThemeState().resolved, 'dark');
  env.at(8); env.focus();
  assert.equal(theme.getThemeState().resolved, 'light');
  env.system(true);
  assert.equal(theme.getThemeState().resolved, 'dark', 'system dark mode also applies during daytime');
  theme.setThemePreference('light');
  env.at(22); env.tick(); env.focus(); env.visible(false);
  assert.equal(theme.getThemeState().resolved, 'light', 'manual light stays light at night');
  theme.setThemePreference('dark');
  env.system(false); env.at(9); env.focus();
  assert.equal(theme.getThemeState().resolved, 'dark', 'manual dark stays dark during daytime');
  theme.setThemePreference('system');
  assert.equal(theme.getThemeState().resolved, 'light');
  assert.equal(env.timers.size, 1, 'focus and visibility changes never duplicate boundary timers');
});

test('saved appearance is restored and unavailable storage does not prevent switching', async () => {
  const saved = environment({ saved: 'light', dark: true });
  const theme = await load(saved);
  assert.equal(theme.getThemeState().resolved, 'light');
  theme.initializeTheme();
  saved.storage.blocked = true;
  theme.setThemePreference('dark');
  assert.equal(saved.root.dataset.theme, 'dark');
  assert.equal(theme.getThemeState().persistent, false);
  const blocked = environment({ blocked: true, dark: false });
  const fallback = await load(blocked);
  assert.equal(fallback.getThemeState().preference, 'system');
  assert.equal(fallback.getThemeState().resolved, 'light');
  assert.equal(fallback.getThemeState().persistent, false);
});

test('palette selection persists independently of the mode and follows system changes', async () => {
  const env = environment({ saved: 'light', savedPalette: 'mint' });
  const theme = await load(env);
  assert.equal(theme.getThemeState().palette, 'mint');
  for (const palette of theme.themePalettes) {
    theme.setThemePalette(palette.id);
    assert.equal(env.values.get(paletteKey), palette.id);
    assert.equal(env.root.dataset.palette, palette.id);
    assert.equal(theme.getThemeState().preference, 'light');
    assert.equal(env.meta.content, palette.backgrounds.light);
    theme.setThemePreference('dark');
    assert.equal(theme.getThemeState().palette, palette.id);
    assert.equal(env.meta.content, palette.backgrounds.dark);
    theme.setThemePreference('light');
  }
  theme.setThemePreference('system');
  env.system(false);
  assert.equal(theme.getThemeState().palette, 'plum');
  assert.equal(env.meta.content, '#F3F0E9');
  env.system(true);
  assert.equal(env.meta.content, '#1B1916');
  env.storage.blocked = true;
  theme.setThemePalette('ocean');
  assert.equal(theme.getThemeState().palette, 'ocean');
  assert.equal(theme.getThemeState().persistent, false);
});

test('palette changes from other tabs notify subscribers, ignore unrelated events and clear safely', async () => {
  const env = environment({ saved: 'dark', savedPalette: 'ocean' });
  const theme = await load(env);
  let updates = 0;
  theme.subscribeTheme(() => updates++);
  env.external('mint', { eventKey: paletteKey });
  assert.equal(theme.getThemeState().palette, 'mint');
  assert.equal(theme.getThemeState().preference, 'dark');
  assert.equal(updates, 1);
  env.external('mint', { eventKey: paletteKey });
  assert.equal(updates, 1, 'unchanged palettes do not trigger another render');
  env.external('plum', { eventKey: paletteKey, storageArea: {} });
  env.external('plum', { eventKey: 'unrelated' });
  assert.equal(theme.getThemeState().palette, 'mint');
  env.external('light');
  assert.equal(theme.getThemeState().palette, 'mint');
  assert.equal(env.meta.content, '#F3F0E9');
  env.external('invalid', { eventKey: paletteKey });
  assert.equal(theme.getThemeState().palette, 'paper');
  theme.setThemePalette('plum');
  env.external(null, { eventKey: paletteKey });
  assert.equal(theme.getThemeState().palette, 'paper');
  assert.equal(theme.getThemeState().preference, 'light');
  theme.setThemePalette('ocean');
  env.external(null, { eventKey: null });
  assert.equal(theme.getThemeState().palette, 'paper');
  assert.equal(theme.getThemeState().preference, 'system');
});

test('the prepaint theme agrees with the application for saved, system and blocked-storage states', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert(html.includes('<script src="/theme-init.js"></script>'), 'the prepaint script can run under the same-origin script policy');
  const boot = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  const combinations = ['paper', 'mint', 'ocean', 'plum'].flatMap(savedPalette =>
    ['light', 'dark', 'system'].flatMap(saved => [true, false].flatMap(dark => [0, 5, 6, 12, 17, 18, 23].map(hour => ({ savedPalette, saved, dark, hour })))));
  for (const options of [...combinations, { saved: 'light' }, { savedPalette: 'invalid' }, { savedPalette: '__proto__' }, { saved: 'invalid' }, { blocked: true, dark: false }]) {
    const env = environment(options);
    runInNewContext(boot, { document: env.document, localStorage: env.storage, matchMedia: env.window.matchMedia, Date: env.Date });
    const initial = { ...env.root.dataset };
    const initialMeta = env.meta.content;
    const theme = await load(env);
    assert.equal(initial.theme, theme.getThemeState().resolved);
    assert.equal(initial.palette, theme.getThemeState().palette);
    assert.equal(initial.themePreference, theme.getThemeState().preference);
    assert.equal(env.meta.content, initialMeta);
    assert.equal(env.meta.content, theme.themePalettes.find(item => item.id === initial.palette).backgrounds[initial.theme]);
  }
});
