import type { CSSProperties } from 'react';

// 播放与暂停共用两块四边形：三角形沿竖线切成左右两块，分别对应暂停的两根竖条。
// 两组路径的指令结构一致、顶点顺序相同（左上、右上、右下、左下），浏览器才能在两种形状之间插值。
// 圆角来自 2px 同色描边：竖条视觉宽 4、间距 4、高 14，与三角形的视觉面积相当，切换时图标不忽轻忽重。
const shapes = {
  play: ['M8 4.5L14 8.25L14 15.75L8 19.5Z', 'M14 8.25L20 12L20 12L14 15.75Z'],
  pause: ['M7 6L9 6L9 18L7 18Z', 'M15 6L17 6L17 18L15 18Z'],
} as const;

/**
 * 播放／暂停图标：支持 CSS `d` 的浏览器形变过渡，其余浏览器直接切换。
 * 只用于切换播放状态的按钮；「播放此项」等一次性动作仍用普通播放图标。
 */
export function PlayGlyph({ playing, size = 24 }: { playing: boolean; size?: number }) {
  return <svg className="play-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {shapes[playing ? 'pause' : 'play'].map((d, index) => <path key={index} d={d} style={{ d: `path('${d}')` } as CSSProperties}/>)}
  </svg>;
}
