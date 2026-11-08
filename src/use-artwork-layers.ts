import { useEffect, useRef, useState } from 'react';

export function useArtworkLayers(artwork?: string): {
  layers: { url: string; key: number }[];
  settle: (key: number) => void;
} {
  const [layers, setLayers] = useState<{ url: string; key: number }[]>([]);
  const sequence = useRef(0);
  useEffect(() => {
    let cancelled = false;
    if (!artwork) { setLayers([]); return; }
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { if (!cancelled) setLayers(old => [...old.slice(-1), { url: artwork, key: ++sequence.current }]); };
    img.onerror = () => { if (!cancelled) setLayers([]); };
    img.src = artwork;
    return () => { cancelled = true; img.onload = img.onerror = null; };
  }, [artwork]);

  const settle = (key: number) => setLayers(old => {
    const latest = old.at(-1);
    return latest?.key === key ? [latest] : old;
  });
  return { layers, settle };
}
