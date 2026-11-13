import { Button } from '../../ui/Button';
import { useEffect, useId } from 'react';
import { Toaster, toast } from 'sonner';

export function WorkspaceNotice({ text, action, desktop }: {
  text: string;
  action?: { label: string; run: () => void };
  desktop: boolean;
}) {
  const id = useId();
  useEffect(() => {
    const toastId = toast.custom(() => (
      <div className="toast-copy" role="status">
        {text}
        {action && <Button variant="ghost" compact type="button"  onClick={action.run}>{action.label}</Button>}
      </div>
    ), { toasterId: id, duration: Infinity, dismissible: false });
    return () => { toast.dismiss(toastId); };
  }, [action, id, text]);
  return (
    <Toaster id={id} className="workspace-toaster" position={desktop ? 'bottom-right' : 'bottom-center'}
      offset={{ bottom: 'var(--notice-offset)', right: 'var(--sp-5)' }}
      mobileOffset={{ bottom: 'var(--notice-offset)', left: 'var(--sp-4)', right: 'var(--sp-4)' }}
      toastOptions={{ unstyled: true, className: 'toast' }} containerAriaLabel="操作通知" />
  );
}
