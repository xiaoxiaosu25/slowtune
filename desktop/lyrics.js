import { currentLines, hasDisplayableLyrics } from './model.mjs';
import { floatingLineEnd, floatingLinePan } from './lyric-layout.mjs';
const api = window.slowTuneLyrics;
const current = document.querySelector('#current'), secondary = document.querySelector('#secondary');
const options = document.querySelector('#options'), panel = document.querySelector('#display-options');
const unlock = document.querySelector('#unlock'), fontSize = document.querySelector('#font-size'), feedback = document.querySelector('#feedback');
const lyrics = document.querySelector('#lyrics'), controls = document.querySelector('#controls'), lockNotice = document.querySelector('#lock-notice');
let doc = null, clock = null, prefs, identity = '', wordFills = [];
let primaryContent, lastFrame, metrics, lineEnd;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let pointer, dwellOrigin, dwellTimer, noticeTimer, unlockVisible = false;
const report = error => { feedback.textContent = error?.message || '设置未保存，请重试'; };
const update = value => api.updatePreferences(value).catch(report);
const contains = (point, rect) => !!point && point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
function publishUnlockTarget() {
  const { x, y, width, height } = unlock.getBoundingClientRect();
  api.setUnlockTarget(unlockVisible ? { x, y, width, height } : null);
}
function showUnlock(visible) {
  if (unlockVisible === visible) return;
  unlockVisible = visible;
  document.body.dataset.unlockVisible = String(visible);
  unlock.inert = !visible; unlock.tabIndex = visible ? 0 : -1;
  unlock.setAttribute('aria-hidden', String(!visible));
  publishUnlockTarget();
}
function resetUnlock() {
  clearTimeout(dwellTimer); dwellTimer = undefined; dwellOrigin = pointer = undefined;
  showUnlock(false);
}
function clearLockNotice() {
  clearTimeout(noticeTimer); document.body.dataset.lockNotice = 'false'; lockNotice.textContent = '';
}
function trackPointer(event) {
  pointer = { x: event.clientX, y: event.clientY };
  if (!prefs?.locked || !prefs.visible || !hasDisplayableLyrics(doc)) return;
  if (unlockVisible) {
    // Keep the route from the lyric text to the button open, without making
    // that route intercept clicks. Only the visible button accepts input.
    if (!contains(pointer, lyrics.getBoundingClientRect()) && !contains(pointer, controls.getBoundingClientRect())) { resetUnlock(); return; }
    publishUnlockTarget(); return;
  }
  if (!contains(pointer, lyrics.getBoundingClientRect())) { resetUnlock(); return; }
  if (dwellTimer && Math.hypot(pointer.x - dwellOrigin.x, pointer.y - dwellOrigin.y) <= 6) return;
  clearTimeout(dwellTimer); dwellOrigin = pointer;
  dwellTimer = setTimeout(() => { dwellTimer = undefined; if (prefs?.locked && prefs.visible && hasDisplayableLyrics(doc) && contains(pointer, lyrics.getBoundingClientRect())) showUnlock(true); }, 600);
}
function render() {
  const hasLyrics = hasDisplayableLyrics(doc), hadLyrics = document.body.dataset.hasLyrics === 'true';
  document.body.dataset.hasLyrics = String(hasLyrics);
  if (hadLyrics && !hasLyrics) {
    resetUnlock(); clearLockNotice();
    if (panel.matches(':popover-open')) panel.hidePopover();
  }
  const { index, time } = currentLines(doc, clock);
  const firstIndex = doc?.lines.findIndex(line => line.text.trim()) ?? -1, first = doc?.lines[firstIndex];
  const line = !hasLyrics ? undefined : index >= 0 ? doc.lines[index] : !doc?.synced ? first : undefined;
  const waiting = hasLyrics && index < 0 && doc?.synced && first;
  const primaryText = hasLyrics ? line?.text ?? first?.text ?? '' : '';
  const secondaryText = !hasLyrics ? '' : line ? prefs?.translations && line.translation ? line.translation : doc.lines[(index >= 0 ? index : firstIndex) + 1]?.text || '' : waiting ? '前奏 · 等待第一句' : '';
  const nextIdentity = JSON.stringify([doc?.sourceKey, index, primaryText, secondaryText, line?.words]);
  if (nextIdentity !== identity) {
    const advance=lastFrame?.source===doc?.sourceKey&&lastFrame.index+1===index&&time>=lastFrame.time&&time-lastFrame.time<1500&&clock?.playing;
    identity = nextIdentity; wordFills = []; current.replaceChildren();metrics=undefined;
    primaryContent=document.createElement('span');primaryContent.className='line-content';current.append(primaryContent);
    if (line?.words?.length) for (const word of line.words) {
      const element = document.createElement('span'); element.className = 'word';
      const base = document.createElement('span'), fill = document.createElement('span');
      base.textContent = fill.textContent = word.text; fill.className = 'fill'; fill.setAttribute('aria-hidden', 'true');
      element.append(base, fill); primaryContent.append(element); wordFills.push({ element, word });
    } else primaryContent.textContent = primaryText;
    current.title=primaryText;
    secondary.textContent = secondaryText; current.classList.toggle('active', !!doc?.synced && !!line && !line.words?.length);
    secondary.title=secondaryText;
    if(advance&&!reducedMotion.matches)primaryContent.animate([{opacity:.65,transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
  }
  lineEnd=floatingLineEnd(doc,index);
  for (const { element, word } of wordFills) element.style.setProperty('--fill', String(Math.max(0, Math.min(1, (time - word.startMs) / (word.endMs - word.startMs)))));
  if(primaryContent){
    if(!metrics){metrics={width:current.clientWidth,overflow:Math.max(0,primaryContent.scrollWidth-current.clientWidth)};if(metrics.overflow)for(const entry of wordFills){entry.left=entry.element.offsetLeft;entry.width=entry.element.offsetWidth;}}
    current.dataset.overflow=String(metrics.overflow>0);
    let shift=0;
    if(metrics.overflow>0&&!reducedMotion.matches&&line){
      if(wordFills.length){const entry=wordFills.find(entry=>entry.word.endMs>time)??wordFills.at(-1),fraction=Math.max(0,Math.min(1,(time-entry.word.startMs)/(entry.word.endMs-entry.word.startMs)));shift=-Math.max(0,Math.min(metrics.overflow,entry.left+entry.width*fraction-metrics.width*.55));}
      else shift=floatingLinePan(time,line.startMs,lineEnd,metrics.overflow);
    }
    primaryContent.style.setProperty('--line-shift',shift+'px');
  }
  lastFrame={source:doc?.sourceKey,index,time};
  current.dataset.line = String(index); current.dataset.time = String(time);
  document.body.dataset.empty = String(!line && !waiting);
  document.querySelector('#toggle').title = clock?.playing ? '暂停' : '播放';
  document.querySelector('#play-icon').toggleAttribute('hidden', !!clock?.playing);
  document.querySelector('#pause-icon').toggleAttribute('hidden', !clock?.playing);
}
function applyState(state) {
  const previous = prefs;
  prefs = state.preferences; doc = state.document; clock = state.clock;
  document.body.dataset.locked = String(prefs.locked); document.body.dataset.lines = String(prefs.lines);
  if (!previous || previous.locked !== prefs.locked || previous.visible !== prefs.visible || previous.fontSize !== prefs.fontSize || previous.lines !== prefs.lines) resetUnlock();
  if(!previous||previous.fontSize!==prefs.fontSize)metrics=undefined;
  if (!prefs.locked || !prefs.visible) clearLockNotice();
  else if (previous && !previous.locked && hasDisplayableLyrics(doc)) {
    clearLockNotice(); lockNotice.textContent = '已锁定 · 悬停或从托盘解锁'; document.body.dataset.lockNotice = 'true';
    noticeTimer = setTimeout(clearLockNotice, 2000);
  }
  document.documentElement.style.setProperty('--lyric-size', prefs.fontSize + 'px');
  document.documentElement.style.setProperty('--lyric-color', prefs.color); document.documentElement.style.setProperty('--lyric-highlight', prefs.highlight);
  document.querySelector('#double-lines').checked = prefs.lines === 2;
  document.querySelector('#translations').checked = prefs.translations;
  fontSize.value = String(prefs.fontSize); document.querySelector('#font-size-value').value = prefs.fontSize + ' px';
  document.querySelector('#lyric-color').value = prefs.color; document.querySelector('#highlight-color').value = prefs.highlight;
  document.querySelectorAll('[data-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === prefs.highlight)));
  document.querySelector('#font-smaller').disabled = prefs.fontSize <= 18; document.querySelector('#font-larger').disabled = prefs.fontSize >= 64;
  if ((prefs.locked || !prefs.visible) && panel.matches(':popover-open')) panel.hidePopover();
  render();
}
api.onState(applyState);
api.onDocument(value => { if (doc?.sourceKey !== value.sourceKey) clock = null; doc = value; render(); });
api.onClock(value => { clock = value; render(); });
void api.getState().then(applyState);
for (const command of ['previous', 'toggle', 'next']) document.querySelector('#' + command).onclick = () => api.command(command);
document.querySelector('#show-player').onclick = () => api.showPlayer();
document.querySelector('#lock').onclick = () => void update({ locked: true });
unlock.onclick = () => void update({ locked: false });
// Electron forwards mouse movement even while the window ignores clicks.
window.addEventListener('mousemove', trackPointer);
// Changing native click-through can synthesize mouseleave. Once the button is
// visible, the main process checks the real cursor to distinguish an exit.
document.documentElement.addEventListener('mouseleave', () => { if (!unlockVisible) resetUnlock(); });
api.onPointerLeave(resetUnlock);
window.addEventListener('blur', resetUnlock);
document.addEventListener('visibilitychange', () => { if (document.hidden) { resetUnlock(); clearLockNotice(); } });
document.querySelector('#hide').onclick = () => void update({ visible: false });
document.querySelector('#double-lines').onchange = event => void update({ lines: event.target.checked ? 2 : 1 });
document.querySelector('#translations').onchange = event => void update({ translations: event.target.checked });
fontSize.oninput = () => void update({ fontSize: Number(fontSize.value) });
document.querySelector('#font-smaller').onclick = () => void update({ fontSize: Math.max(18, prefs.fontSize - 2) });
document.querySelector('#font-larger').onclick = () => void update({ fontSize: Math.min(64, prefs.fontSize + 2) });
document.querySelector('#lyric-color').oninput = event => void update({ color: event.target.value });
document.querySelector('#highlight-color').oninput = event => void update({ highlight: event.target.value });
document.querySelectorAll('[data-color]').forEach(button => { button.onclick = () => void update({ highlight: button.dataset.color }); });
document.querySelector('#reset-position').onclick = () => void api.resetPosition().then(() => { feedback.textContent = '歌词位置已重置'; placeOptions(); }).catch(report);
document.querySelector('#lyric-settings').onclick = () => { panel.hidePopover(); api.openSettings(); };
const placeOptions = () => {
  const anchor = options.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
  const width = bounds.width || 320, height = bounds.height || 290;
  panel.style.left = Math.max(8, Math.min(anchor.right - width, innerWidth - width - 8)) + 'px';
  panel.style.top = Math.max(8, anchor.top - height - 8) + 'px';
};
options.onclick = async event => {
  // Keep the native invoker relationship for light-dismiss, while resizing the
  // host window before opening rather than using the default synchronous toggle.
  event.preventDefault();
  if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
  try { await api.setOptionsOpen(true); requestAnimationFrame(() => { if (!prefs?.locked && hasDisplayableLyrics(doc)) panel.showPopover(); }); }
  catch (error) { report(error); }
};
panel.addEventListener('beforetoggle', event => { if (event.newState === 'open') placeOptions(); });
panel.addEventListener('toggle', event => { const open = event.newState === 'open'; options.setAttribute('aria-expanded', String(open)); if (open) placeOptions(); else void api.setOptionsOpen(false).catch(report); });
window.addEventListener('resize', () => { metrics=undefined;render();resetUnlock(); if (panel.matches(':popover-open')) placeOptions(); });
reducedMotion.addEventListener('change',()=>{primaryContent?.getAnimations().forEach(animation=>animation.cancel());render();});
