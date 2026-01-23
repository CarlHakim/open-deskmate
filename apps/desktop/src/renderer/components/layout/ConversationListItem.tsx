'use client';

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Task, FolderConfig } from '@accomplish/shared';
import { cn } from '@/lib/utils';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Square,
  PauseCircle,
  MoreHorizontal,
  Trash2,
  FolderInput,
  FolderPlus,
  Folder,
  Pencil,
} from 'lucide-react';
import { useTaskStore } from '@/stores/taskStore';
import { useFolderStore } from '@/stores/folderStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CreateFolderDialog from './CreateFolderDialog';

interface ConversationListItemProps {
  task: Task;
  draggable?: boolean;
}

export default function ConversationListItem({ task, draggable = true }: ConversationListItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === `/execution/${task.id}`;
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const setTaskFolder = useTaskStore((state) => state.setTaskFolder);
  const setTaskSummary = useTaskStore((state) => state.setTaskSummary);
  const { folders, createFolder } = useFolderStore();
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [pendingMoveAfterCreate, setPendingMoveAfterCreate] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newName, setNewName] = useState(task.summary || task.prompt);

  // Sort folders by order
  const sortedFolders = [...folders].sort((a, b) => a.order - b.order);

  const handleClick = () => {
    navigate(`/execution/${task.id}`);
  };

  const handleDelete = () => {
    if (!window.confirm('Are you sure you want to delete this task?')) {
      return;
    }

    deleteTask(task.id);

    // Navigate to home if deleting the currently active task
    if (isActive) {
      navigate('/');
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!draggable) return;
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleMoveToFolder = (folderId: string) => {
    setTaskFolder(task.id, folderId);
  };

  const handleNewProjectClick = () => {
    setPendingMoveAfterCreate(true);
    setShowCreateFolder(true);
  };

  const handleFolderCreated = (config: FolderConfig) => {
    const newFolder = createFolder(config);
    if (pendingMoveAfterCreate) {
      setTaskFolder(task.id, newFolder.id);
      setPendingMoveAfterCreate(false);
    }
    setShowCreateFolder(false);
  };

  const handleRename = () => {
    if (newName.trim()) {
      setTaskSummary(task.id, newName.trim());
    }
    setShowRenameDialog(false);
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
    <>
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
        draggable={draggable}
        onDragStart={handleDragStart}
        title={task.summary || task.prompt}
        className={cn(
          'task-item w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all duration-200',
          'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
          'flex items-center gap-2.5 group relative cursor-pointer',
          'border border-transparent hover:border-border/50',
          isActive && 'active bg-accent text-foreground border-primary/20 shadow-soft',
          draggable && 'cursor-grab active:cursor-grabbing'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded-lg',
            isActive ? 'bg-primary/10' : 'bg-muted/50'
          )}
        >
          {getStatusIcon()}
        </div>
        <span className="block truncate flex-1 font-medium">{task.summary || task.prompt}</span>

        {/* Three-dot dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={cn(
                'opacity-0 group-hover:opacity-100 transition-all duration-200',
                'p-1.5 rounded-lg hover:bg-accent',
                'text-muted-foreground hover:text-foreground',
                'shrink-0'
              )}
              aria-label="Task options"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* Rename option */}
            <DropdownMenuItem onClick={() => setShowRenameDialog(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Move to project submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-4 w-4 mr-2" />
                Move to project
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {/* New project option */}
                <DropdownMenuItem onClick={handleNewProjectClick}>
                  <FolderPlus className="h-4 w-4 mr-2 text-primary" />
                  <span className="text-primary font-medium">+ New project</span>
                </DropdownMenuItem>

                {sortedFolders.length > 0 && <DropdownMenuSeparator />}

                {/* Existing folders */}
                {sortedFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => handleMoveToFolder(folder.id)}
                    disabled={task.folderId === folder.id}
                  >
                    <Folder
                      className="h-4 w-4 mr-2"
                      style={folder.color ? { color: folder.color } : undefined}
                    />
                    <span className="truncate">{folder.name}</span>
                    {task.folderId === folder.id && (
                      <span className="ml-auto text-xs text-muted-foreground">(current)</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* Delete option */}
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Create folder dialog */}
      <CreateFolderDialog
        open={showCreateFolder}
        onOpenChange={setShowCreateFolder}
        onFolderCreated={handleFolderCreated}
      />

      {/* Rename dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Chat name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
