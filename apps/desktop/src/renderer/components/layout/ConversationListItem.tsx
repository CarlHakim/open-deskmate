'use client';

import { useNavigate, useLocation } from 'react-router-dom';
import type { Task } from '@accomplish/shared';
import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle, Clock, Square, PauseCircle, X } from 'lucide-react';
import { useTaskStore } from '@/stores/taskStore';

interface ConversationListItemProps {
  task: Task;
}

export default function ConversationListItem({ task }: ConversationListItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === `/execution/${task.id}`;
  const deleteTask = useTaskStore((state) => state.deleteTask);

  const handleClick = () => {
    navigate(`/execution/${task.id}`);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!window.confirm('Are you sure you want to delete this task?')) {
      return;
    }

    await deleteTask(task.id);

    // Navigate to home if deleting the currently active task
    if (isActive) {
      navigate('/');
    }
  };

  const getStatusIcon = () => {
    switch (task.status) {
      case 'running':
        return <Loader2 className="h-3 w-3 animate-spin-ccw text-primary shrink-0" />;
      case 'completed':
        return <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-red-500 shrink-0" />;
      case 'cancelled':
        return <Square className="h-3 w-3 text-zinc-400 shrink-0" />;
      case 'interrupted':
        return <PauseCircle className="h-3 w-3 text-amber-500 shrink-0" />;
      case 'queued':
        return <Clock className="h-3 w-3 text-amber-500 shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      title={task.summary || task.prompt}
      className={cn(
        'task-item w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all duration-200',
        'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
        'flex items-center gap-2.5 group relative cursor-pointer',
        'border border-transparent hover:border-border/50',
        isActive && 'active bg-accent text-foreground border-primary/20 shadow-soft'
      )}
    >
      <div className={cn(
        'flex items-center justify-center w-6 h-6 rounded-lg',
        isActive ? 'bg-primary/10' : 'bg-muted/50'
      )}>
        {getStatusIcon()}
      </div>
      <span className="block truncate flex-1 font-medium">{task.summary || task.prompt}</span>
      <button
        type="button"
        onClick={handleDelete}
        className={cn(
          'opacity-0 group-hover:opacity-100 transition-all duration-200',
          'p-1.5 rounded-lg hover:bg-destructive/10',
          'text-muted-foreground hover:text-destructive',
          'shrink-0'
        )}
        aria-label="Delete task"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
