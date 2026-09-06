import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';

// Keep feature panels out of startup; preserve their state once initialized.
function deferDialog<Props extends { open: boolean }>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  prepareWhenIdle = false,
) {
  let pending: ReturnType<typeof load> | undefined;
  const loadOnce = () => pending ??= load().catch(error => {
    pending = undefined;
    throw error;
  });
  const Dialog = lazy(loadOnce);
  return function DeferredDialog(props: Props) {
    const [opened, setOpened] = useState(false);
    useEffect(() => {
      if (!prepareWhenIdle) return;
      let cancelled = false;
      let idleCallback: number | undefined;
      // Settings has expensive initial state even when closed. Prepare it after
      // startup so opening it does not pay both import and initialization costs.
      // Its open-gated data requests still wait for the user to open the dialog.
      const timer = window.setTimeout(() => {
        const prefetch = () => {
          void loadOnce().then(() => {
            if (!cancelled) setOpened(true);
          }).catch(() => {});
        };
        if (window.requestIdleCallback) {
          idleCallback = window.requestIdleCallback(prefetch, { timeout: 3000 });
        } else {
          prefetch();
        }
      }, 1500);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
      };
    }, []);
    useEffect(() => {
      if (props.open) setOpened(true);
    }, [props.open]);
    if (!props.open && !opened) return null;
    return (
      <Suspense fallback={props.open ? <div role="status" className="fixed bottom-4 right-4 z-50 rounded-md border bg-background p-3 text-sm">Loading…</div> : null}>
        <Dialog {...props} />
      </Suspense>
    );
  };
}

export const DeferredSettingsDialog = deferDialog(() => import('./SettingsDialog'), true);
export const DeferredSearchAuditDialog = deferDialog(() => import('./SearchAuditDialog'));
export const DeferredProjectManagementDialog = deferDialog(() => import('../usage/ProjectManagementDialog'));
