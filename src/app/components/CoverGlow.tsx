import { useArtworkLayers } from '../../use-artwork-layers';

/**
 * 播放栏封面微光：把当前封面高度模糊后铺在播放栏底层，像封面的光漫到条面上。
 * 换歌时新封面淡入、旧封面淡出；没有封面或加载失败时不显示。
 */
export function CoverGlow({ artwork, playing }: { artwork?: string; playing: boolean }) {
  const { layers, settle } = useArtworkLayers(artwork);
  return <div className="playbar-glow" aria-hidden="true" data-playing={playing || undefined}>
    {layers.map(layer => <img key={layer.key} src={layer.url} alt="" referrerPolicy="no-referrer"
      onAnimationEnd={() => settle(layer.key)}/>)}
  </div>;
}
