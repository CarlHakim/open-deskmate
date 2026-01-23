'use client';

import { useState } from 'react';
import type { FolderConfig } from '@accomplish/shared';
import { useFolderStore } from '@/stores/folderStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ProjectIconPicker from './ProjectIconPicker';

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback when folder is created - receives the folder config */
  onFolderCreated?: (config: FolderConfig) => void;
}

export default function CreateFolderDialog({ open, onOpenChange, onFolderCreated }: CreateFolderDialogProps) {
  const { createFolder } = useFolderStore();
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('Folder');
  const [selectedColor, setSelectedColor] = useState<string | undefined>(undefined);

  const handleCreate = () => {
    if (!name.trim()) return;

    const config: FolderConfig = {
      name: name.trim(),
      icon: selectedIcon,
      color: selectedColor,
    };

    // If callback provided, let the caller handle folder creation
    if (onFolderCreated) {
      onFolderCreated(config);
    } else {
      // Default behavior: create folder directly
      createFolder(config);
      onOpenChange(false);
    }

    // Reset state
    setName('');
    setSelectedIcon('Folder');
    setSelectedColor(undefined);
  };

  const handleClose = () => {
    setName('');
    setSelectedIcon('Folder');
    setSelectedColor(undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  handleCreate();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Icon & Color</Label>
            <ProjectIconPicker
              selectedIcon={selectedIcon}
              selectedColor={selectedColor}
              onIconChange={setSelectedIcon}
              onColorChange={setSelectedColor}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
