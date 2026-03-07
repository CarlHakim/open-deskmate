import { Hammer, MessageSquare } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface ModeSwitchProps {
  className?: string;
}

export default function ModeSwitch({ className }: ModeSwitchProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const inBuildMode = location.pathname.startsWith('/build');

  return (
    <div className={cn('inline-flex items-center rounded-full border border-border/70 bg-muted/40 p-1', className)}>
      <button
        type="button"
        onClick={() => navigate('/')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
          !inBuildMode
            ? 'bg-background text-foreground shadow-soft'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title="Switch to Chat Mode"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Chat Mode
      </button>
      <button
        type="button"
        onClick={() => navigate('/build')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
          inBuildMode
            ? 'bg-background text-foreground shadow-soft'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title="Switch to Build Mode"
      >
        <Hammer className="h-3.5 w-3.5" />
        Build Mode
      </button>
    </div>
  );
}
