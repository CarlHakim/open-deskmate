import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BuildFileTreeNode } from "@accomplish/shared";
import { ChevronDown, ChevronRight, File, FileCode, FilePlus, FileText, Folder, FolderOpen, FolderPlus } from "lucide-react";
import type { ComponentProps, ReactElement, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { normalizeFsPath } from '../../lib/workspace-paths';

export const CODE_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt',
  'html', 'css', 'scss', 'sass', 'less', 'sql', 'sh', 'ps1', 'c', 'cpp', 'h', 'hpp',
]);

export const TEXT_FILE_EXTENSIONS = new Set(['md', 'txt', 'rtf', 'log']);

export const CONFIG_FILE_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'lock']);

export const ASSET_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp', 'mp4', 'mp3', 'wav']);

export type WorkspaceTreeClipboardEntry = {
  mode: 'cut' | 'copy';
  relativePath: string;
  workspaceRelativePath: string;
  type: BuildFileTreeNode['type'];
};

export type BuildTooltipProps = {
  content: ReactNode;
  children: ReactElement;
  side?: ComponentProps<typeof TooltipContent>['side'];
  align?: ComponentProps<typeof TooltipContent>['align'];
  sideOffset?: ComponentProps<typeof TooltipContent>['sideOffset'];
  className?: string;
};

export function BuildTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 10,
  className,
}: BuildTooltipProps): ReactElement {
  const tooltipKey = typeof content === 'string' ? content : undefined;
  return (
    <Tooltip key={tooltipKey}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn('max-w-xs whitespace-pre-line text-[11px] leading-relaxed', className)}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export function canonicalizeWorkspaceRelativePath(value: string | null | undefined): string {
  const normalized = normalizeFsPath(value || '.');
  if (!normalized || normalized === '.') return '.';
  const withoutLeadingDot = normalized.replace(/^\.\/+/, '');
  return withoutLeadingDot || '.';
}

export interface TreeNodeProps {
  node: BuildFileTreeNode;
  selectedPath: string | null;
  onSelect: (node: BuildFileTreeNode) => void;
  depth?: number;
  collapseToken?: number;
  pendingCreateType?: 'file' | 'folder' | null;
  pendingCreateName?: string;
  pendingCreateParentPath?: string | null;
  onPendingCreateNameChange?: (value: string) => void;
  onCommitPendingCreate?: () => void;
  onCancelPendingCreate?: () => void;
  onDirectoryInteract?: (node: BuildFileTreeNode) => void;
  pendingCreateInputRef?: React.RefObject<HTMLInputElement | null>;
  pendingRenamePath?: string | null;
  pendingRenameName?: string;
  onPendingRenameNameChange?: (value: string) => void;
  onCommitPendingRename?: () => void;
  onCancelPendingRename?: () => void;
  pendingRenameInputRef?: React.RefObject<HTMLInputElement | null>;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>, node: BuildFileTreeNode) => void;
  clipboardEntry?: WorkspaceTreeClipboardEntry | null;
  currentWorkspaceRelativePath?: string;
}

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

export function getFileIcon(name: string, isSelected: boolean) {
  const ext = getFileExtension(name);
  const selectedClass = isSelected ? 'text-primary' : '';

  if (CODE_FILE_EXTENSIONS.has(ext)) {
    return <FileCode className={cn('h-3.5 w-3.5 shrink-0 text-[#519aba] dark:text-[#519aba]', selectedClass)} />;
  }
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    return <FileText className={cn('h-3.5 w-3.5 shrink-0 text-[#89d185] dark:text-[#89d185]', selectedClass)} />;
  }
  if (CONFIG_FILE_EXTENSIONS.has(ext)) {
    return <File className={cn('h-3.5 w-3.5 shrink-0 text-[#d19a66] dark:text-[#d19a66]', selectedClass)} />;
  }
  if (ASSET_FILE_EXTENSIONS.has(ext)) {
    return <File className={cn('h-3.5 w-3.5 shrink-0 text-[#c586c0] dark:text-[#c586c0]', selectedClass)} />;
  }
  return <File className={cn('h-3.5 w-3.5 shrink-0 text-[#9aa0a6] dark:text-[#9aa0a6]', selectedClass)} />;
}

export function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
  collapseToken = 0,
  pendingCreateType = null,
  pendingCreateName = '',
  pendingCreateParentPath = null,
  onPendingCreateNameChange,
  onCommitPendingCreate,
  onCancelPendingCreate,
  onDirectoryInteract,
  pendingCreateInputRef,
  pendingRenamePath = null,
  pendingRenameName = '',
  onPendingRenameNameChange,
  onCommitPendingRename,
  onCancelPendingRename,
  pendingRenameInputRef,
  onContextMenu,
  clipboardEntry = null,
  currentWorkspaceRelativePath = '.',
}: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === 'directory';
  const isSelected = selectedPath === node.relativePath;
  const isPendingRename = pendingRenamePath === node.relativePath;
  const isCutEntry = clipboardEntry?.mode === 'cut'
    && clipboardEntry.relativePath === node.relativePath
    && canonicalizeWorkspaceRelativePath(clipboardEntry.workspaceRelativePath) === canonicalizeWorkspaceRelativePath(currentWorkspaceRelativePath);
  const sortedChildren = useMemo(() => {
    if (!Array.isArray(node.children)) return [];
    return [...node.children].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [node.children]);

  useEffect(() => {
    if (!isDir) return;
    setOpen(depth < 1);
  }, [collapseToken, depth, isDir]);

  useEffect(() => {
    if (!isDir) return;
    if (pendingCreateParentPath === node.relativePath) {
      setOpen(true);
    }
  }, [isDir, node.relativePath, pendingCreateParentPath]);

  const directoryChildren = sortedChildren.filter((child) => child.type === 'directory');
  const fileChildren = sortedChildren.filter((child) => child.type === 'file');
  const shouldRenderInlineCreate = isDir && open && pendingCreateType && pendingCreateParentPath === node.relativePath;
  const rowPaddingLeft = `${6 + depth * 12}px`;
  const childPaddingLeft = `${6 + (depth + 1) * 12}px`;
  const rowIcon = isDir ? (
    open ? (
      <FolderOpen className={cn('h-3.5 w-3.5 shrink-0 text-[#dcb67a] dark:text-[#dcb67a]', isSelected ? 'text-primary' : '')} />
    ) : (
      <Folder className={cn('h-3.5 w-3.5 shrink-0 text-[#dcb67a] dark:text-[#dcb67a]', isSelected ? 'text-primary' : '')} />
    )
  ) : (
    getFileIcon(node.name, isSelected)
  );

  return (
    <div>
      {isPendingRename ? (
        <div
          className={cn(
            'flex items-center gap-1 rounded-md py-0.5 pr-2 text-xs',
            isSelected ? 'bg-primary/15 text-primary' : 'text-foreground'
          )}
          style={{ paddingLeft: rowPaddingLeft }}
        >
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/80">
            {isDir ? (
              open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            ) : null}
          </span>
          {rowIcon}
          <Input
            ref={pendingRenameInputRef}
            value={pendingRenameName}
            onChange={(event) => onPendingRenameNameChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCommitPendingRename?.();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelPendingRename?.();
              }
            }}
            className="h-7 text-xs"
          />
        </div>
      ) : (
        <BuildTooltip content={isDir ? `Toggle folder: ${node.relativePath}` : `Open file: ${node.relativePath}`} side="right" align="start">
          <button
            type="button"
            onClick={() => {
              if (pendingCreateType) {
                onCancelPendingCreate?.();
              }
              if (isDir) {
                onDirectoryInteract?.(node);
                setOpen((value) => !value);
              } else {
                onSelect(node);
              }
            }}
            onContextMenu={(event) => {
              if (pendingCreateType) {
                onCancelPendingCreate?.();
              }
              onContextMenu?.(event, node);
            }}
            className={cn(
              'w-full rounded-md py-0.5 pr-2 text-left text-xs transition-colors',
              isSelected ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              isCutEntry ? 'opacity-60' : null
            )}
            style={{ paddingLeft: rowPaddingLeft }}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/80">
                {isDir ? (
                  open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                ) : null}
              </span>
              {rowIcon}
              <span className="truncate">{node.name}</span>
            </span>
          </button>
        </BuildTooltip>
      )}
      {isDir && open ? (
        <div className="ml-2 border-l border-border/50">
          {directoryChildren.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
              collapseToken={collapseToken}
              pendingCreateType={pendingCreateType}
              pendingCreateName={pendingCreateName}
              pendingCreateParentPath={pendingCreateParentPath}
              onPendingCreateNameChange={onPendingCreateNameChange}
              onCommitPendingCreate={onCommitPendingCreate}
              onCancelPendingCreate={onCancelPendingCreate}
              onDirectoryInteract={onDirectoryInteract}
              pendingCreateInputRef={pendingCreateInputRef}
              pendingRenamePath={pendingRenamePath}
              pendingRenameName={pendingRenameName}
              onPendingRenameNameChange={onPendingRenameNameChange}
              onCommitPendingRename={onCommitPendingRename}
              onCancelPendingRename={onCancelPendingRename}
              pendingRenameInputRef={pendingRenameInputRef}
              onContextMenu={onContextMenu}
              clipboardEntry={clipboardEntry}
              currentWorkspaceRelativePath={currentWorkspaceRelativePath}
            />
          ))}
          {shouldRenderInlineCreate ? (
            <div className="flex items-center gap-1 py-1 pr-2" style={{ paddingLeft: childPaddingLeft }}>
              {pendingCreateType === 'file' ? (
                <FilePlus className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
              <Input
                ref={pendingCreateInputRef}
                value={pendingCreateName}
                onChange={(event) => onPendingCreateNameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommitPendingCreate?.();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancelPendingCreate?.();
                  }
                }}
                placeholder={pendingCreateType === 'file' ? 'filename.tsx' : 'new-folder'}
                className="h-7 text-xs"
              />
            </div>
          ) : null}
          {fileChildren.map((child) => (
            <TreeNode
              key={child.relativePath}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
              collapseToken={collapseToken}
              pendingCreateType={pendingCreateType}
              pendingCreateName={pendingCreateName}
              pendingCreateParentPath={pendingCreateParentPath}
              onPendingCreateNameChange={onPendingCreateNameChange}
              onCommitPendingCreate={onCommitPendingCreate}
              onCancelPendingCreate={onCancelPendingCreate}
              onDirectoryInteract={onDirectoryInteract}
              pendingCreateInputRef={pendingCreateInputRef}
              pendingRenamePath={pendingRenamePath}
              pendingRenameName={pendingRenameName}
              onPendingRenameNameChange={onPendingRenameNameChange}
              onCommitPendingRename={onCommitPendingRename}
              onCancelPendingRename={onCancelPendingRename}
              pendingRenameInputRef={pendingRenameInputRef}
              onContextMenu={onContextMenu}
              clipboardEntry={clipboardEntry}
              currentWorkspaceRelativePath={currentWorkspaceRelativePath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
