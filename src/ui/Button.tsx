import type { ComponentPropsWithRef } from 'react';
import { ArrowLeftIcon, CaretDownIcon, XIcon } from '@phosphor-icons/react';

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' | 'plain';
  compact?: boolean;
};

/** The native button contract is shared by actions, navigation and widget items.
 * Forms opt into type="submit"; busy controls remain clickable when they cancel work.
 * React 19 passes ref through props, including refs composed by Radix asChild.
 */
export function Button({ variant = 'default', compact = false, type = 'button', className = '', ...props }: ButtonProps) {
  const classes = [variant !== 'plain' && 'btn', variant !== 'plain' && variant !== 'default' && 'btn-' + variant, compact && 'btn-sm', className].filter(Boolean).join(' ');
  return <button {...props} type={type} className={classes || undefined} data-ui-button="" />;
}

export type IconButtonProps = Omit<ButtonProps, 'variant'> & { 'aria-label': string };

export function IconButton({ title, ...props }: IconButtonProps) {
  return <Button {...props} variant="icon" title={title ?? props['aria-label']} />;
}

type DismissButtonProps = Omit<IconButtonProps, 'aria-label' | 'children'> & {
  action?: 'close' | 'back' | 'collapse';
  'aria-label'?: string;
};

export function DismissButton({ action = 'close', 'aria-label': label, title, className = '', ...props }: DismissButtonProps) {
  const name = label ?? { close: '关闭', back: '返回上一级', collapse: '收起' }[action];
  const Icon = { close: XIcon, back: ArrowLeftIcon, collapse: CaretDownIcon }[action];
  return <IconButton {...props} className={'btn-dismiss ' + className} aria-label={name} title={title ?? name}><Icon size={action === 'close' ? 22 : 24} aria-hidden="true" /></IconButton>;
}
