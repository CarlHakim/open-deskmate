import { getAccomplish } from "@/lib/accomplish";
import { cn } from "@/lib/utils";
import type { BuildTerminalEntry, BuildTerminalSessionSummary } from "@accomplish/shared";
import { FitAddon } from "@xterm/addon-fit";
import { memo, useEffect, useRef } from "react";
import { Terminal as XTermTerminal } from "xterm";
import { pathLeaf } from '../../lib/workspace-paths';

export type BuildTerminalPaneProps = {
  accomplish: ReturnType<typeof getAccomplish>;
  agentId: string | null;
  session: BuildTerminalSessionSummary;
  layoutHeightToken: number;
  isActive: boolean;
  onActivate: () => void;
  onNewTerminal: () => void;
  onSplitTerminal: () => void;
  onClearTerminal: () => void;
  onInterruptTerminal: () => void;
};

export const BuildTerminalPane = memo(function BuildTerminalPane({
  accomplish,
  agentId,
  session,
  layoutHeightToken,
  isActive,
  onActivate,
  onNewTerminal,
  onSplitTerminal,
  onClearTerminal,
  onInterruptTerminal,
}: BuildTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeToContainerRef = useRef<(() => void) | null>(null);
  const renderedSeqRef = useRef(0);
  const outputCursorRef = useRef(0);
  const followOutputRef = useRef(true);
  const onNewTerminalRef = useRef(onNewTerminal);
  const onSplitTerminalRef = useRef(onSplitTerminal);
  const onClearTerminalRef = useRef(onClearTerminal);
  const onInterruptTerminalRef = useRef(onInterruptTerminal);

  useEffect(() => {
    onNewTerminalRef.current = onNewTerminal;
  }, [onNewTerminal]);

  useEffect(() => {
    onSplitTerminalRef.current = onSplitTerminal;
  }, [onSplitTerminal]);

  useEffect(() => {
    onClearTerminalRef.current = onClearTerminal;
  }, [onClearTerminal]);

  useEffect(() => {
    onInterruptTerminalRef.current = onInterruptTerminal;
  }, [onInterruptTerminal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new XTermTerminal({
      allowTransparency: true,
      cursorBlink: true,
      convertEol: false,
      cursorStyle: 'bar',
      fontFamily: 'Consolas, "SFMono-Regular", Menlo, Monaco, "Liberation Mono", monospace',
      fontSize: 11,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#0b1220',
        foreground: '#f4f4f5',
        cursor: '#5eead4',
        cursorAccent: '#0b1220',
        selectionBackground: 'rgba(148, 163, 184, 0.28)',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedSeqRef.current = 0;

    const resizeToContainer = () => {
      fitAddon.fit();
      if (!agentId) return;
      void accomplish.resizeBuildTerminalSession({
        agentId,
        sessionId: session.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };
    resizeToContainerRef.current = resizeToContainer;

    const dataDisposable = terminal.onData((data) => {
      if (!agentId) return;
      followOutputRef.current = true;
      void accomplish.writeBuildTerminalInput({
        agentId,
        sessionId: session.id,
        input: data,
      });
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 't') {
        event.preventDefault();
        void onNewTerminalRef.current();
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'd') {
        event.preventDefault();
        void onSplitTerminalRef.current();
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'l') {
        event.preventDefault();
        void onClearTerminalRef.current();
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c' && !terminal.hasSelection()) {
        event.preventDefault();
        void onInterruptTerminalRef.current();
        return false;
      }
      return true;
    });

    const scrollDisposable = terminal.onScroll(() => {
      followOutputRef.current = isTerminalNearBottom(terminal);
    });

    const resizeObserver = new ResizeObserver(() => {
      scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    });
    resizeObserver.observe(container);
    window.setTimeout(() => {
      scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    }, 0);
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(() => {
        if (!xtermRef.current) return;
        scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
      });
    }

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      scrollDisposable.dispose();
      fitAddonRef.current = null;
      resizeToContainerRef.current = null;
      xtermRef.current = null;
      outputCursorRef.current = 0;
      terminal.dispose();
    };
  }, [accomplish, agentId, session.id]);

  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal || !agentId) return;

    let cancelled = false;

    const appendEntries = (incomingEntries: BuildTerminalEntry[], reset = false) => {
      const instance = xtermRef.current;
      if (!instance) return;
      const hasIncomingEntries = incomingEntries.length > 0;
      const lastSeq = incomingEntries[incomingEntries.length - 1]?.seq || 0;
      const shouldReplayReset = reset && renderedSeqRef.current === 0 && hasIncomingEntries;
      const shouldSeqReset = hasIncomingEntries && lastSeq < renderedSeqRef.current;
      if (shouldReplayReset || shouldSeqReset) {
        instance.reset();
        renderedSeqRef.current = 0;
        outputCursorRef.current = 0;
      }
      const pendingEntries = incomingEntries.filter((entry) => entry.seq > renderedSeqRef.current);
      if (pendingEntries.length === 0) return;
      const shouldFollowOutput = followOutputRef.current || isTerminalNearBottom(instance);
      const pendingText = pendingEntries.map((entry) => entry.text).join('');
      renderedSeqRef.current = pendingEntries[pendingEntries.length - 1]?.seq || renderedSeqRef.current;
      outputCursorRef.current = renderedSeqRef.current;
      instance.write(pendingText, () => {
        if (shouldFollowOutput) {
          followOutputRef.current = true;
          scheduleTerminalScrollToBottom(instance);
        }
      });
    };

    const syncOutput = async (reset = false) => {
      try {
        const response = await accomplish.getBuildTerminalOutput({
          agentId,
          sessionId: session.id,
          cursor: reset ? 0 : outputCursorRef.current,
          limit: 800,
        });
        if (cancelled) return;
        appendEntries(response.entries, reset);
        outputCursorRef.current = Math.max(outputCursorRef.current, response.nextCursor);
      } catch {
        // Ignore transient terminal sync errors.
      }
    };

    const unsubscribe = accomplish.onBuildTerminalEntry((payload) => {
      if (payload.agentId !== agentId || payload.sessionId !== session.id) return;
      appendEntries([payload.entry]);
      outputCursorRef.current = Math.max(outputCursorRef.current, payload.entry.seq);
    });

    void syncOutput(true);

    const interval = window.setInterval(() => {
      void syncOutput(false);
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [accomplish, agentId, session.id]);

  useEffect(() => {
    const resizeToContainer = resizeToContainerRef.current;
    const terminal = xtermRef.current;
    if (!resizeToContainer || !terminal) return;
    const timeout = window.setTimeout(() => {
      scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [layoutHeightToken]);

  useEffect(() => {
    if (!isActive) return;
    const terminal = xtermRef.current;
    const resizeToContainer = resizeToContainerRef.current;
    if (!terminal || !resizeToContainer) return;
    scheduleTerminalRefit(resizeToContainer, terminal, followOutputRef.current);
    terminal.focus();
  }, [isActive]);

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0b1220]',
        isActive ? 'ring-1 ring-emerald-400/30' : 'ring-1 ring-transparent'
      )}
      onMouseDown={onActivate}
    >
      <div className={cn(
        'flex items-center justify-between border-b px-2 py-1 text-[11px]',
        isActive ? 'border-emerald-400/20 bg-emerald-400/5 text-foreground' : 'border-border/40 bg-background/5 text-muted-foreground'
      )}>
        <span className="truncate">{session.title}</span>
        <span className="truncate text-[10px] opacity-80">{pathLeaf(session.cwd)}</span>
      </div>
      <div
        ref={containerRef}
        className="relative h-full min-h-0 flex-1 overflow-hidden pl-2 pt-1"
        onClick={() => {
          onActivate();
          xtermRef.current?.focus();
        }}
      />
    </div>
  );
}, (prev, next) => (
  prev.accomplish === next.accomplish
  && prev.agentId === next.agentId
  && prev.layoutHeightToken === next.layoutHeightToken
  && prev.isActive === next.isActive
  && prev.session.id === next.session.id
  && prev.session.title === next.session.title
  && prev.session.shellLabel === next.session.shellLabel
  && prev.session.cwd === next.session.cwd
  && prev.session.workspaceRelativePath === next.session.workspaceRelativePath
  && prev.session.running === next.session.running
  && prev.session.pid === next.session.pid
));

export function isTerminalNearBottom(terminal: XTermTerminal): boolean {
  const buffer = terminal.buffer.active;
  return (buffer.baseY - buffer.viewportY) <= 1;
}

export function scheduleTerminalScrollToBottom(terminal: XTermTerminal): void {
  const syncViewport = () => {
    terminal.scrollToBottom();
    const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null | undefined;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  };
  syncViewport();
  window.requestAnimationFrame(() => {
    syncViewport();
    window.setTimeout(() => {
      syncViewport();
    }, 0);
  });
}

export function scheduleTerminalRefit(
  resizeToContainer: () => void,
  terminal: XTermTerminal,
  shouldFollowOutput: boolean,
): void {
  const run = () => {
    resizeToContainer();
    if (shouldFollowOutput) {
      scheduleTerminalScrollToBottom(terminal);
    }
  };
  run();
  window.requestAnimationFrame(() => {
    run();
    window.setTimeout(run, 80);
  });
}
