import { useEffect, useRef } from 'react';
import type { PlaybackAudioAnalysis } from './audio-analysis';

/** The original centred bars and a separate circular halo share the same real frequency analysis. */
export function PlayingSpectrum({ variant = 'bars', active, playing, muted, analysis, state }: {
  variant?: 'bars' | 'halo';
  active: boolean; playing: boolean; muted: boolean;
  analysis: PlaybackAudioAnalysis | null; state: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(48));
  const phase = useRef(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const analyser = analysis?.analyser;
    const samples = new Uint8Array(analyser?.frequencyBinCount ?? 0);
    let width = 0, height = 0, color = '', count = levels.current.length, bands = levels.current;
    let frame = 0, lastPaint = 0;
    const live = playing && !muted && state === 'ready' && !!analyser;
    let lastMotion = 0;
    const paint = (now = performance.now()) => {
      if (live) analyser.getByteFrequencyData(samples);
      let energy = 0, settling = false;
      for (let index = 0; index < count; index++) {
        let target = 0;
        if (live) {
          const lower = 40 * Math.pow(400, index / count), upper = 40 * Math.pow(400, (index + 1) / count);
          const binWidth = analyser.context.sampleRate / analyser.fftSize;
          const start = Math.max(1, Math.floor(lower / binWidth)), end = Math.min(samples.length, Math.max(start + 1, Math.ceil(upper / binWidth)));
          for (let bin = start; bin < end; bin++) target = Math.max(target, samples[bin] / 255);
          target = Math.pow(target, 1.25);
        }
        bands[index] += (target - bands[index]) * (target > bands[index] ? .45 : .22);
        if (bands[index] < .002) bands[index] = 0;
        energy += bands[index];
        settling ||= bands[index] > 0;
      }
      energy /= count;
      const size = Math.min(width, height), x = width / 2, y = height / 2;
      context.clearRect(0, 0, width, height);
      if (variant === 'bars') {
        const breath = Math.min(1, Math.sqrt(energy) * 1.8);
        if (live && energy > .001 && lastMotion) phase.current += Math.min(.067, (now - lastMotion) / 1000) * .9;
        lastMotion = now;
        const swell = 1 + Math.sin(phase.current) * .035 * breath;
        context.fillStyle = color;
        const gap = width < 340 ? 2 : 3, step = width * .92 / count, barWidth = Math.max(1, step - gap);
        for (let index = 0; index < count; index++) {
          const barHeight = Math.max(3, bands[index] * height * .76 * swell);
          context.beginPath();
          context.roundRect(width * .04 + index * step + gap / 2, y - barHeight / 2, barWidth, barHeight, Math.min(barWidth / 2, 4));
          context.fill();
        }
        return live || settling;
      }
      const radius = size * (.32 + energy * .012), glow = Math.min(16, size * .035);
      context.strokeStyle = color;
      context.lineCap = 'round';
      // Soft bloom is a second stroke of the same measured ring, not a synthetic pulse.
      context.globalAlpha = .16 + energy * .2;
      context.shadowColor = color;
      context.shadowBlur = glow;
      context.lineWidth = Math.max(1, size * .006);
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
      context.shadowBlur = 0;
      context.globalAlpha = .42;
      context.lineWidth = Math.max(1, size * .0025);
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = .92;
      context.lineWidth = size < 340 ? 1.7 : 2.4;
      for (let index = 0; index < count * 2; index++) {
        const band = index < count ? index : count * 2 - index - 1;
        const length = bands[band] * size * .12;
        if (length < .6) continue;
        const angle = index / (count * 2) * Math.PI * 2 - Math.PI / 2;
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        context.beginPath();
        context.moveTo(x + cosine * (radius + 4), y + sine * (radius + 4));
        context.lineTo(x + cosine * (radius + 4 + length), y + sine * (radius + 4 + length));
        context.stroke();
      }
      context.globalAlpha = 1;
      return live || settling;
    };
    const tick = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (now - lastPaint < 1000 / 30) { frame = requestAnimationFrame(tick); return; }
      lastPaint = now;
      if (paint(now)) frame = requestAnimationFrame(tick);
    };
    const redraw = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (document.hidden) return;
      const rect = canvas.getBoundingClientRect(), scale = Math.min(devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      color = getComputedStyle(canvas).color;
      const nextCount = width < 340 ? 32 : 48;
      if (nextCount !== count) { count = nextCount; bands = new Float32Array(count); levels.current = bands; }
      lastPaint = 0; lastMotion = 0;
      if (paint()) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(redraw); resize.observe(canvas);
    const theme = new MutationObserver(redraw); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style', 'class'] });
    document.addEventListener('visibilitychange', redraw);
    redraw();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); document.removeEventListener('visibilitychange', redraw); };
  }, [variant, active, playing, muted, analysis, state]);
  return <canvas ref={ref} className="playing-spectrum" aria-hidden="true"/>;
}
