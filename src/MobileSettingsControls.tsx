import { Button } from './ui/Button';
import type { ReactNode } from 'react';
import { CaretRightIcon, CheckIcon } from '@phosphor-icons/react';
import { Dialog } from './ui/Dialog';

export function MobileSettingRow({ label, value, description, onClick }: { label: string; value?: string; description?: string; onClick: () => void }) {
  return <Button variant="plain" className="mobile-setting-row" onClick={onClick}>
    <span className="mobile-setting-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span>
    {value && <span className="mobile-setting-value">{value}</span>}<CaretRightIcon size={18}/>
  </Button>;
}

export function MobileChoiceSheet<T extends string>({ title, value, choices, onChoose, onClose }: {
  title: string; value: T; choices: readonly { value: T; label: string; description?: string; leading?: ReactNode }[];
  onChoose: (value: T) => void; onClose: () => void;
}) {
  return <Dialog title={title} className="mobile-choice-sheet" onClose={onClose}>
    <div className="mobile-choice-list" role="group" aria-label={title}>{choices.map(choice =>
      <Button variant="plain" key={choice.value} aria-pressed={value === choice.value} onClick={() => onChoose(choice.value)}>
        {choice.leading}<span className="mobile-setting-copy"><strong>{choice.label}</strong>{choice.description && <small>{choice.description}</small>}</span>
        {value === choice.value && <CheckIcon size={22} weight="bold"/>}
      </Button>
    )}</div>
  </Dialog>;
}
