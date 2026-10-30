import { LyricPlayer, type LyricLine, type LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
import stylesheet from '@applemusic-like-lyrics/core/style.css?inline';

// Suppress AMLL's early automatic return while the host's five-second browse timer runs.
class DesktopPlayer extends LyricPlayer {
  browsing = false;
  override resetScroll() { if (!this.browsing) super.resetScroll(); }
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
.amll-lyric-player.dom { --amll-lp-font-size:inherit; --amll-lp-color:var(--text); --lyric-line-padding-x:8px; --amll-lp-line-width-aspect:1; --amll-lp-hover-bg-color:color-mix(in srgb,var(--text) 5%,transparent); font:inherit; line-height:1.4; mix-blend-mode:normal; }
.slow-lyric-line { padding:12px 8px !important; cursor:pointer; opacity:var(--slow-line-opacity,.45) !important; filter:blur(var(--slow-line-blur,0px)) !important; transition:opacity 180ms ease,filter 180ms ease; }
.slow-lyric-line:focus-visible { outline:2px solid var(--accent-text); outline-offset:-2px; }
.slow-lyric-line:focus-visible,.slow-lyric-line:hover { opacity:1 !important; filter:none !important; }
.slow-lyric-line [class*="_lyricLine"] { --bright-mask-alpha:1; --dark-mask-alpha:.4; }
.slow-lyric-line [class*="_lyricMainLine"] { line-height:1.4; overflow-wrap:break-word; }
.slow-lyric-line [class*="_lyricSubLine"] { font-size:18px; line-height:1.6; opacity:.65; margin-top:8px; font-weight:400; }
.slow-static-line [class*="_lyricMainLine"],.slow-static-line [class*="_lyricMainLine"] * { mask-image:none !important; -webkit-mask-image:none !important; opacity:1 !important; filter:none !important; transform:none !important; text-shadow:none !important; }
.amll-lyric-player[data-reduced="true"] * { transition:none !important; animation:none !important; }
.amll-lyric-player[data-reduced="true"] [class*="_lyricMainLine"],.amll-lyric-player[data-reduced="true"] [class*="_lyricMainLine"] * { mask-image:none !important; -webkit-mask-image:none !important; text-shadow:none !important; }
`;

export function mountDesktopLyricEngine(host: HTMLElement, lines: LyricLine[], timedWords: boolean[], initialTime: number, onSeek: (index: number) => void) {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = stylesheet + '\n' + hostStyles;
  shadow.replaceChildren(style);
  const player = new DesktopPlayer();
  try {
  const element = player.getElement();
  shadow.append(element);
  player.setOptimizeOptions({ normalizeSpaces: false, resetLineTimestamps: false });
  player.setAlignPosition(.45); player.setAlignAnchor('center');
  player.setEnableBlur(false); player.setOverscanPx(240);
  player.setLinePosYSpringParams({ mass: 1, stiffness: 130, damping: 23 });
  player.setLyricLines(lines, initialTime);
  const groups = player.currentLyricGroups.map((group, index) => {
    const row = group.getElement();
    row.classList.add('slow-lyric-line');
    if (!timedWords[index]) row.classList.add('slow-static-line');
    row.dataset.lineIndex = String(index); row.tabIndex = 0; row.setAttribute('role', 'button');
    row.setAttribute('aria-label', lines[index].words.map(word => word.word).join(''));
    return row;
  });
  const click = (event: Event) => { const index = (event as LyricLineMouseEvent).lineIndex; if (index >= 0) onSeek(index); };
  const keyboard = (event: KeyboardEvent) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-line-index]');
    if (row) { event.preventDefault(); event.stopPropagation(); onSeek(Number(row.dataset.lineIndex)); }
  };
  player.addEventListener('line-click', click); element.addEventListener('keydown', keyboard);
  let active = -2, playing = false, reduced = false;
  const sync = (time: number, isPlaying: boolean, reduce: boolean, seek = false, delta = 0) => {
    if (playing !== isPlaying) { playing = isPlaying; if (playing) player.resume(); else player.pause(); }
    if (element.dataset.reduced === undefined || reduced !== reduce) {
      reduced = reduce; element.dataset.reduced = String(reduce);
      player.setEnableSpring(!reduce); player.setEnableScale(!reduce);
      active = -2;
      if (!reduce && playing) player.resume();
    }
    player.setCurrentTime(time, seek || reduce);
    player.update(delta);
    player.syncWordClock(time, timedWords);
    let lo = 0, hi = lines.length;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (lines[middle].startTime <= time) lo = middle + 1; else hi = middle; }
    const current = lo - 1;
    if (active !== current) {
      active = current;
      groups.forEach((row, index) => {
        const distance = Math.abs(index - Math.max(0, current));
        row.style.setProperty('--slow-line-opacity', index === current ? '1' : index < current ? '.36' : distance <= 1 ? '.60' : '.42');
        row.style.setProperty('--slow-line-blur', reduce || distance < 3 ? '0px' : '1px');
        if (index === current) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
      });
    }
    // Single-word LRC rows never receive an invented progressive mask.
    if (reduce) element.getAnimations({ subtree: true }).forEach(animation => animation.pause());
    host.dataset.activeLine = String(current); host.dataset.time = String(time);
  };
  player.pause(); sync(initialTime, false, false, true);
  return {
    sync,
    browse: () => { player.browsing = true; },
    resume: () => { player.browsing = false; player.resetScroll(); },
    scroll: (deltaY: number) => element.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })),
    dispose: () => { player.removeEventListener('line-click', click); element.removeEventListener('keydown', keyboard); player.dispose(); shadow.replaceChildren(); },
  };
  } catch (error) { player.dispose(); shadow.replaceChildren(); throw error; }
}
