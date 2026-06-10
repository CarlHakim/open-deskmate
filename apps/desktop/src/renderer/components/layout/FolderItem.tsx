'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Task, Folder } from '@accomplish/shared';
import { cn } from '@/lib/utils';
import { useFolderStore } from '@/stores/folderStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUsageProjectStore } from '@/stores/usageProjectStore';
import {
  ChevronRight,
  MoreHorizontal,
  Pencil,
  WalletCards,
  Trash2,
} from 'lucide-react';
import ConversationListItem from './ConversationListItem';
import ProjectIconPicker, { getIconByName } from './ProjectIconPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FolderItemProps {
  folder: Folder;
  tasks: Task[];
  onOpenBudgetProject?: (projectId: string) => void;
}

export default function FolderItem({
  folder,
  tasks,
  onOpenBudgetProject,
}: FolderItemProps) {
  const { toggleFolderExpanded, updateFolder, deleteFolder } = useFolderStore();
  const { setTaskFolder } = useTaskStore();
  const { projects: usageProjects, archivedProjects: archivedUsageProjects, loadProjects: loadUsageProjects } = useUsageProjectStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(folder.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBudgetDialog, setShowBudgetDialog] = useState(false);
  const [budgetProjectId, setBudgetProjectId] = useState(folder.usageProjectId || '');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showBudgetPopover, setShowBudgetPopover] = useState(false);
  const [editIcon, setEditIcon] = useState(folder.icon || 'Folder');
  const [editColor, setEditColor] = useState(folder.color);
  const budgetProject = [...usageProjects, ...archivedUsageProjects].find((project) => project.id === folder.usageProjectId);
  const budgetColor = budgetProject?.color || '#2dd4bf';

  const handleToggle = () => {
    toggleFolderExpanded(folder.id);
  };

  const handleRename = () => {
    if (newName.trim() && newName !== folder.name) {
      updateFolder(folder.id, { name: newName.trim() });
    }
    setIsRenaming(false);
  };

  useEffect(() => {
    if (!showBudgetDialog) return;
    setBudgetProjectId(folder.usageProjectId || '');
    void loadUsageProjects(true);
  }, [folder.usageProjectId, loadUsageProjects, showBudgetDialog]);

  useEffect(() => {
    if (folder.usageProjectId) {
      void loadUsageProjects(true);
    }
  }, [folder.usageProjectId, loadUsageProjects]);

  const handleDelete = () => {
    // Move all tasks to unfiled before deleting folder
    tasks.forEach((task) => {
      setTaskFolder(task.id, null);
    });
    deleteFolder(folder.id);
    setShowDeleteConfirm(false);
  };

  const handleIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditIcon(folder.icon || 'Folder');
    setEditColor(folder.color);
    setShowIconPicker(true);
  };

  const handleSaveIconColor = () => {
    updateFolder(folder.id, { icon: editIcon, color: editColor });
    setShowIconPicker(false);
  };

  const handleSaveBudgetProject = async () => {
    await updateFolder(folder.id, { usageProjectId: budgetProjectId || null });
    setShowBudgetDialog(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('bg-primary/10', 'border-primary/30');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('bg-primary/10', 'border-primary/30');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-primary/10', 'border-primary/30');
    const taskId = e.dataTransfer.getData('text/plain');
    // Only handle task drops, not folder reordering
    if (taskId && !taskId.startsWith('folder_')) {
      setTaskFolder(taskId, folder.id);
    }
  };

  // Get the icon component
  const IconComponent = getIconByName(folder.icon || 'Folder');

  return (
    <>
      <div className="space-y-0.5">
        {/* Folder Header */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleToggle();
            }
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'w-full text-left px-3 py-2 rounded-xl text-sm transition-all duration-200',
            'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
            'flex items-center gap-2 group cursor-pointer',
            'border border-transparent hover:border-border/50'
          )}
        >
          <motion.div
            animate={{ rotate: folder.isExpanded ? 90 : 0 }}
            transition={{ duration: 0.15 }}
            className="shrink-0"
          >
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.div>

          {/* Clickable Icon */}
          <Popover open={showIconPicker} onOpenChange={setShowIconPicker}>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={handleIconClick}
                className={cn(
                  'relative flex items-center justify-center w-6 h-6 rounded-lg shrink-0',
                  'transition-all duration-200 hover:scale-110 hover:ring-2 hover:ring-primary/30'
                )}
                style={{
                  backgroundColor: folder.color ? `${folder.color}20` : 'hsl(var(--muted) / 0.5)',
                }}
                title={folder.usageProjectId ? `Budget: ${budgetProject?.name || 'Selected budget'}` : 'Click to change icon & color'}
              >
                <IconComponent
                  className="h-3.5 w-3.5"
                  style={{ color: folder.color || 'hsl(var(--muted-foreground))' }}
                />
                {folder.usageProjectId && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background"
                    style={{ backgroundColor: budgetColor }}
                  />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4" align="start" onClick={(e) => e.stopPropagation()}>
              <div className="space-y-4">
                <div className="font-medium text-sm">Edit Icon & Color</div>
                <ProjectIconPicker
                  selectedIcon={editIcon}
                  selectedColor={editColor}
                  onIconChange={setEditIcon}
                  onColorChange={setEditColor}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowIconPicker(false)}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveIconColor}>
                    Save
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <TooltipProvider delayDuration={350}>
              <Tooltip>
                <TooltipTrigger asChild>
                <span className="flex-1 truncate font-medium">
                  {folder.name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" align="center" className="max-w-[260px] text-xs">
                <span className="break-words">{folder.name}</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {folder.usageProjectId && (
            <Popover open={showBudgetPopover} onOpenChange={setShowBudgetPopover}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (folder.usageProjectId) {
                      onOpenBudgetProject?.(folder.usageProjectId);
                    }
                  }}
                  onMouseEnter={() => setShowBudgetPopover(true)}
                  className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-teal-400/40 bg-teal-400/10 text-teal-600 hover:bg-teal-400/20"
                  title={`Budget: ${budgetProject?.name || 'Selected budget'}`}
                >
                  <WalletCards className="h-3 w-3" />
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background"
                    style={{ backgroundColor: budgetColor }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-56 p-3"
                side="right"
                align="center"
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setShowBudgetPopover(true)}
                onMouseLeave={() => setShowBudgetPopover(false)}
              >
                <div className="space-y-2">
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">Budget project</div>
                  <div className="truncate text-sm font-semibold text-foreground">{budgetProject?.name || 'Selected budget'}</div>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => {
                      setShowBudgetPopover(false);
                      if (folder.usageProjectId) {
                        onOpenBudgetProject?.(folder.usageProjectId);
                      }
                    }}
                  >
                    Open in Project Management
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <span className="text-xs text-muted-foreground/70 mr-1">
            {tasks.length}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                className={cn(
                  'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
                  'p-1 rounded-md hover:bg-accent',
                  'text-muted-foreground hover:text-foreground'
                )}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowBudgetDialog(true)}>
                <WalletCards className="h-3.5 w-3.5 mr-2" />
                Assign budget
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Folder Contents */}
        <AnimatePresence>
          {folder.isExpanded && tasks.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pl-6 space-y-0.5">
                {tasks.map((task) => (
                  <ConversationListItem key={task.id} task={task} draggable />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Rename Dialog */}
      <Dialog open={isRenaming} onOpenChange={setIsRenaming}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-input" className="sr-only">Project name</Label>
            <Input
              id="rename-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenaming(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBudgetDialog} onOpenChange={setShowBudgetDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Assign Budget Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground">
              Tasks in "{folder.name}" will inherit this budget project. Existing tasks in this project are re-tagged for usage reports.
            </p>
            <Label htmlFor={`budget-project-${folder.id}`}>Budget project</Label>
            <select
              id={`budget-project-${folder.id}`}
              value={budgetProjectId}
              onChange={(event) => setBudgetProjectId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No budget project</option>
              {usageProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBudgetDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveBudgetProject()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete "{folder.name}"?
              {tasks.length > 0 && (
                <span className="block mt-2">
                  The {tasks.length} task{tasks.length > 1 ? 's' : ''} in this project will be moved
                  to the main list.
                </span>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
