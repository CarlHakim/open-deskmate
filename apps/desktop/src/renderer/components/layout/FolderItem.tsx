'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Task, Folder } from '@accomplish/shared';
import { cn } from '@/lib/utils';
import { useFolderStore } from '@/stores/folderStore';
import { useTaskStore } from '@/stores/taskStore';
import {
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FolderItemProps {
  folder: Folder;
  tasks: Task[];
  onDragStart?: (e: React.DragEvent, folderId: string) => void;
  onDragOver?: (e: React.DragEvent, folderId: string) => void;
  onDragEnd?: () => void;
  isDragTarget?: boolean;
}

export default function FolderItem({
  folder,
  tasks,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragTarget = false,
}: FolderItemProps) {
  const { toggleFolderExpanded, updateFolder, deleteFolder } = useFolderStore();
  const { setTaskFolder } = useTaskStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(folder.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editIcon, setEditIcon] = useState(folder.icon || 'Folder');
  const [editColor, setEditColor] = useState(folder.color);

  const handleToggle = () => {
    toggleFolderExpanded(folder.id);
  };

  const handleRename = () => {
    if (newName.trim() && newName !== folder.name) {
      updateFolder(folder.id, { name: newName.trim() });
    }
    setIsRenaming(false);
  };

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

  const handleFolderDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', folder.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(e, folder.id);
  };

  const handleFolderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.types.includes('text/plain');
    if (draggedId) {
      onDragOver?.(e, folder.id);
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
          draggable
          onDragStart={handleFolderDragStart}
          onDragOver={(e) => {
            handleDragOver(e);
            handleFolderDragOver(e);
          }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={onDragEnd}
          className={cn(
            'w-full text-left px-3 py-2 rounded-xl text-sm transition-all duration-200',
            'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
            'flex items-center gap-2 group cursor-pointer',
            'border border-transparent hover:border-border/50',
            isDragTarget && 'border-primary/50 bg-primary/5'
          )}
        >
          {/* Drag Handle */}
          <div
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-grab active:cursor-grabbing shrink-0"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

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
                  'flex items-center justify-center w-6 h-6 rounded-lg shrink-0',
                  'transition-all duration-200 hover:scale-110 hover:ring-2 hover:ring-primary/30'
                )}
                style={{
                  backgroundColor: folder.color ? `${folder.color}20` : 'hsl(var(--muted) / 0.5)',
                }}
                title="Click to change icon & color"
              >
                <IconComponent
                  className="h-3.5 w-3.5"
                  style={{ color: folder.color || 'hsl(var(--muted-foreground))' }}
                />
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

          <span className="flex-1 truncate font-medium">
            {folder.name}
          </span>
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
