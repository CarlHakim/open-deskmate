import { Hammer, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAccomplish } from '@/lib/accomplish';
import { useAgentStore } from '@/stores/agentStore';
import { cn } from '@/lib/utils';

interface ModeSwitchProps {
  className?: string;
}

export default function ModeSwitch({ className }: ModeSwitchProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const accomplish = getAccomplish();
  const { activeAgentId } = useAgentStore();
  const [switchBusy, setSwitchBusy] = useState(false);
  const [runtimeSwitchDialogOpen, setRuntimeSwitchDialogOpen] = useState(false);

  const inBuildMode = location.pathname.startsWith('/build');

  const handleChatModeClick = async () => {
    if (!inBuildMode || !activeAgentId) {
      navigate('/');
      return;
    }

    setSwitchBusy(true);
    try {
      const snapshot = await accomplish.getBuildRuntimeSnapshot({ agentId: activeAgentId });
      const runtimeActive = snapshot.runtime.status === 'running' || snapshot.runtime.status === 'starting';
      if (runtimeActive) {
        setRuntimeSwitchDialogOpen(true);
        return;
      }
      navigate('/');
    } finally {
      setSwitchBusy(false);
    }
  };

  return (
    <>
      <Dialog open={runtimeSwitchDialogOpen} onOpenChange={(open) => { if (!switchBusy) setRuntimeSwitchDialogOpen(open); }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Build runtime is still running</DialogTitle>
            <DialogDescription>
              A Build Mode runtime is still active. You can stop it before switching to Chat Mode, or keep it running and switch anyway.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={switchBusy}
              onClick={() => {
                setRuntimeSwitchDialogOpen(false);
                navigate('/');
              }}
            >
              Keep runtime running
            </Button>
            <Button
              disabled={switchBusy}
              onClick={async () => {
                if (!activeAgentId) return;
                setSwitchBusy(true);
                try {
                  await accomplish.stopBuildRuntime({ agentId: activeAgentId });
                  setRuntimeSwitchDialogOpen(false);
                  navigate('/');
                } finally {
                  setSwitchBusy(false);
                }
              }}
            >
              Stop runtime and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className={cn('inline-flex items-center rounded-full border border-border/70 bg-muted/40 p-1', className)}>
        <button
          type="button"
          onClick={() => void handleChatModeClick()}
          disabled={switchBusy}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-60',
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
    </>
  );
}
