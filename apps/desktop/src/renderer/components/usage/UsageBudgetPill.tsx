import { useEffect } from 'react';
import { WalletCards } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUsageProjectStore } from '@/stores/usageProjectStore';

export function UsageBudgetPill({
  usageProjectId,
  label = 'Budget',
  className,
}: {
  usageProjectId?: string | null;
  label?: string;
  className?: string;
}) {
  const { projects, archivedProjects, loadProjects } = useUsageProjectStore();

  useEffect(() => {
    if (usageProjectId) {
      void loadProjects(true);
    }
  }, [loadProjects, usageProjectId]);

  if (!usageProjectId) return null;

  const project = [...projects, ...archivedProjects].find((entry) => entry.id === usageProjectId);
  const projectName = project?.name || 'Selected budget';

  return (
    <div
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-400/10 px-2 py-1 text-[11px] font-medium text-teal-700',
        className
      )}
      title={`${label}: ${projectName}`}
    >
      <WalletCards className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0">{label}:</span>
      <span className="truncate">{projectName}</span>
    </div>
  );
}
