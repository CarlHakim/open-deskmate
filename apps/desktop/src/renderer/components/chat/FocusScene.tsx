import { useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { Focus, Minimize2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useFocusSceneStore } from '../../stores/focusSceneStore';

export function supportsFocusScene(path: string) {
  return path === '/build' || path.startsWith('/execution/');
}

export function focusSceneBackground(src: string): CSSProperties {
  return {
    backgroundImage: `linear-gradient(135deg, hsl(var(--background) / 0.62), hsl(var(--background) / 0.78)), url("${src}")`,
    backgroundPosition: 'center', backgroundSize: 'cover', backgroundRepeat: 'no-repeat',
  };
}

export function FocusSceneLifecycle() {
  const location = useLocation();
  const exit = useFocusSceneStore(state => state.exit);
  useLayoutEffect(() => { exit(); }, [location.pathname, location.search, exit]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // Let dialogs and menus handle their own Escape before leaving Focus.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) return;
      exit();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [exit]);
  return null;
}

export function FocusSceneButton() {
  const { pathname } = useLocation();
  const active = useFocusSceneStore(state => state.active);
  const toggle = useFocusSceneStore(state => state.toggle);
  if (!supportsFocusScene(pathname)) return null;
  return <button type="button" aria-pressed={active}
    title={active ? 'Restore your previous layout (Escape)' : 'Focus on this task; temporarily hide navigation and tool panels'}
    onClick={event => { event.stopPropagation(); toggle(); }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
    className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-foreground hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {active ? <Minimize2 className="h-3.5 w-3.5" /> : <Focus className="h-3.5 w-3.5" />}
    {active ? 'Exit Focus' : 'Focus'}
  </button>;
}
