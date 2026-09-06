import { useEffect, useId, useState } from 'react';
import { BriefcaseBusiness } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUsageProjectStore } from '@/stores/usageProjectStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

const projectHelp = 'Assign this task to a project for organisation, usage tracking, and project budgets. The separate working-folder button chooses the files the agent works with.';

export function UsageProjectSelector({
  mode,
  value,
  onChange,
  disabled,
  compact = false,
  className,
  persistSelection = true,
}: {
  mode: 'chat' | 'build';
  value?: string | null;
  onChange?: (projectId: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  persistSelection?: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const {
    projects,
    statuses,
    loadProjects,
    selectedChatProjectId,
    selectedBuildProjectId,
    setSelectedProject,
  } = useUsageProjectStore();
  const selected = value !== undefined ? value : mode === 'chat' ? selectedChatProjectId : selectedBuildProjectId;

  useEffect(() => {
    void loadProjects(true);
  }, [loadProjects]);

  const statusByProject = new Map<string, { blocking: boolean; exceeded: boolean }>();
  for (const status of statuses) {
    const current = statusByProject.get(status.projectId);
    statusByProject.set(status.projectId, {
      blocking: Boolean(current?.blocking || status.blocking),
      exceeded: Boolean(current?.exceeded || status.exceeded),
    });
  }

  return (
    <label className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}>
      {!compact && <span className="shrink-0">Project</span>}
      <TooltipProvider delayDuration={300}>
        <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
          <TooltipTrigger asChild>
            <span className="relative inline-flex min-w-0" onMouseEnter={() => setHelpOpen(true)} onMouseLeave={() => setHelpOpen(false)} onFocus={() => setHelpOpen(true)} onBlur={() => setHelpOpen(false)}>
              <BriefcaseBusiness aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-foreground/80" />
              <select
                aria-label="Task project"
                aria-describedby={helpId}
                value={selected || ''}
                disabled={disabled}
                data-usage-project-selector={mode}
                onChange={(event) => {
                  const next = event.target.value || null;
                  if (persistSelection) {
                    setSelectedProject(mode, next);
                  }
                  onChange?.(next);
                }}
                className={cn(
                  'h-8 cursor-pointer rounded-md border border-border/70 bg-background pl-7 pr-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                  compact ? 'min-w-[132px] max-w-[160px]' : 'min-w-[178px] max-w-[248px]'
                )}
              >
                <option value="">No project</option>
                {projects.map((project) => {
                  const status = statusByProject.get(project.id);
                  const suffix = status?.blocking ? ' (blocked)' : status?.exceeded ? ' (over)' : '';
                  return (
                    <option key={project.id} value={project.id}>
                      {project.name}{suffix}
                    </option>
                  );
                })}
              </select>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
            {projectHelp}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span id={helpId} className="sr-only">{projectHelp}</span>
    </label>
  );
}
