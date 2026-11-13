import { LyricPlayer, type LyricLine, type LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import stylesheet from '@applemusic-like-lyrics/core/style.css?inline';

// Suppress AMLL's early automatic return while the host's five-second browse timer runs.
class DesktopPlayer extends LyricPlayer {
  browsing = false;
  snapLayout = false;
  override resetScroll() { if (!this.browsing) super.resetScroll(); }
  override setLinePosYSpringParams() {
    // AMLL otherwise replaces this policy on every new line. Keep the whole
    // paragraph moving at one settled pace instead of varying with line length.
    super.setLinePosYSpringParams({mass:1,stiffness:180,damping:27});
  }
  override calcLayout(reason:Parameters<LyricPlayer['calcLayout']>[0]) {
    // PlaybackTick adds a per-row stagger; the reference scrolls as one block.
    super.calcLayout(reason==='playback-tick'?'config-change':reason);
    if(this.snapLayout)for(const group of this.currentLyricGroups)group.setTransform(group.top,true,group.delay,group.isActive,group.opacity,group.blur);
  }
  syncWordClock(time: number, timedWords: boolean[]) {
    // AMLL's word animations otherwise run at wall-clock speed. The media clock
    // owns active timed rows, including rate changes, seeks and stalled playback.
    for (const index of this.timelineController.getSnapshot().highlightedGroups) {
      if (timedWords[index]) this.currentLyricGroups[index]?.enable(time, false);
    }
  }
}

const hostStyles = `
:host { display:block; width:100%; height:100%; font:inherit; color:var(--text); }
.amll-lyric-player.dom { --amll-lp-font-size:inherit; --amll-lp-color:var(--text); --lyric-line-padding-x:8px; --amll-lp-line-width-aspect:1; --amll-lp-hover-bg-color:transparent; font:inherit; line-height:1.4; mix-blend-mode:normal; overflow:clip; }
.slow-lyric-line { padding:8px !important; pointer-events:none; opacity:var(--slow-line-opacity,.6) !important; filter:none !important; transition:opacity 300ms ease-out; }
.slow-lyric-line:focus-visible { outline:2px solid var(--accent-text); outline-offset:-2px; }
.slow-lyric-line:focus-visible,.slow-lyric-line:hover { opacity:1 !important; filter:none !important; }
.slow-lyric-line [class*="_lyricLine"] { --bright-mask-alpha:1; --dark-mask-alpha:.4; }
.slow-lyric-line :is([class*="_lyricMainLine"],[class*="_lyricSubLine"]):not(:empty) { width:fit-content; max-width:100%; overflow-wrap:anywhere; pointer-events:auto; cursor:pointer; }
.slow-lyric-line [class*="_lyricMainLine"] { margin:0; padding:0; line-height:1.4; font-weight:400; scale:.666667; transform-origin:left center; transition:scale 300ms cubic-bezier(.2,0,0,1),font-weight 300ms ease-out,text-shadow 300ms ease-out; }
.slow-lyric-line [class*="_lyricMainLine"] * { pointer-events:none; }
.slow-lyric-line[aria-current="true"] [class*="_lyricMainLine"] { scale:1; font-weight:800; text-shadow:0 4px 24px color-mix(in srgb,var(--text) 12%,transparent); }
.slow-lyric-line [class*="_lyricSubLine"] { font-size:14px; line-height:1.6; opacity:.8; margin-top:4px; font-weight:400; }
.slow-static-line [class*="_lyricMainLine"],.slow-static-line [class*="_lyricMainLine"] * { mask-image:none !important; -webkit-mask-image:none !important; opacity:1 !important; filter:none !important; transform:none !important; }
.slow-static-line [class*="_lyricMainLine"] * { text-shadow:inherit !important; }
.amll-lyric-player[data-snap="true"] * { transition:none !important; animation:none !important; }
`;

function containsLyricText(element: Element, x: number, y: number) {
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

export function mountDesktopLyricEngine(host: HTMLElement, lines: LyricLine[], timedWords: boolean[], initialTime: number, onSeek: (index: number) => void) {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = stylesheet + '\n' + hostStyles;
  shadow.replaceChildren(style);
  const player = new DesktopPlayer();
  try {
  const element = player.getElement();
  shadow.append(element);
  player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
  player.setAlignPosition(.5); player.setAlignAnchor('center');
  player.setEnableBlur(false); player.setOverscanPx(240);
  // One typography transition owns emphasis for both LRC and timed-word rows.
  // Keep the measured line box stable so growing text cannot kick the scroll target.
  player.setEnableScale(false);
  player.setLyricLines(lines, initialTime);
  const groups = player.currentLyricGroups.map((group, index) => {
    const row = group.getElement();
    row.classList.add('slow-lyric-line');
    if (!timedWords[index]) row.classList.add('slow-static-line');
    row.dataset.lineIndex = String(index); row.tabIndex = 0; row.setAttribute('role', 'button');
    row.setAttribute('aria-label', lines[index].words.map(word => word.word).join(''));
    return row;
  });
  const click = (event: Event) => {
    const { lineIndex, detail, clientX, clientY } = event as LyricLineMouseEvent;
    if (lineIndex < 0) return;
    if (detail === 0) { onSeek(lineIndex); return; }
    const text = shadow.elementFromPoint(clientX, clientY);
    // Wrapped text has a rectangular box even where its last row is shorter.
    if (text && containsLyricText(text, clientX, clientY)) onSeek(lineIndex);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-line-index]');
    if (row) { event.preventDefault(); event.stopPropagation(); onSeek(Number(row.dataset.lineIndex)); }
  };
  player.addEventListener('line-click', click); element.addEventListener('keydown', keyboard);
  let active = -2, playing = false, previousTime = initialTime;
  const sync = (time: number, isPlaying: boolean, seek = false, delta = 0) => {
    const snap=seek||time<previousTime||Math.abs(time-previousTime)>1200;
    player.snapLayout=snap;
    element.dataset.snap=String(snap);previousTime=time;
    if (playing !== isPlaying) { playing = isPlaying; if (playing) player.resume(); else player.pause(); }
    player.setCurrentTime(time, snap);
    player.update(delta);
    player.syncWordClock(time, timedWords);
    let lo = 0, hi = lines.length;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (lines[middle].startTime <= time) lo = middle + 1; else hi = middle; }
    const current = lo - 1;
    if (active !== current) {
      active = current;
      groups.forEach((row, index) => {
        row.style.setProperty('--slow-line-opacity', index === current ? '1' : '.6');
        if (index === current) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
      });
    }
    host.dataset.activeLine = String(current); host.dataset.time = String(time);
  };
  player.pause(); sync(initialTime, false, true);
  return {
    sync,
    browse: () => { player.browsing = true; },
    resume: () => { player.browsing = false; player.resetScroll(); },
    scroll: (deltaY: number) => element.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })),
    dispose: () => { player.removeEventListener('line-click', click); element.removeEventListener('keydown', keyboard); player.dispose(); shadow.replaceChildren(); },
  };
  } catch (error) { player.dispose(); shadow.replaceChildren(); throw error; }
}
