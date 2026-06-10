import { useEffect } from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUsageProjectStore } from '@/stores/usageProjectStore';

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
      <Folder className="h-3.5 w-3.5 shrink-0" />
      {!compact && <span className="shrink-0">Project</span>}
      <select
        value={selected || ''}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value || null;
          if (persistSelection) {
            setSelectedProject(mode, next);
          }
          onChange?.(next);
        }}
        className="h-8 min-w-[150px] max-w-[220px] rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        title="Assign this run to a usage project"
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
    </label>
  );
}
