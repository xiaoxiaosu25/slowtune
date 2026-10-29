/** A browsing title plays the same item as its cover. Details stay in the item menu. */
export function MobileBrowseTitle({ title, originalTitle, className, disabled, onPlay }: {
  title: string; originalTitle?: string; className: string; disabled?: boolean; onPlay: () => void;
}) {
  return <button type="button" className={className + ' mobile-browse-title'} title={originalTitle || title} disabled={disabled} onClick={onPlay}>
    <span className="mobile-browse-title-text">{title}</span>
  </button>;
}
