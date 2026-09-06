import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, File } from 'lucide-react';
import type { PermissionRequest, PermissionResponse } from '@accomplish/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { springs } from '../../lib/animations';

function getOperationBadgeClasses(operation?: string): string {
  switch (operation) {
    case 'delete': return 'bg-red-500/10 text-red-600';
    case 'modify':
    case 'overwrite': return 'bg-amber-500/10 text-amber-600';
    case 'create': return 'bg-emerald-500/10 text-emerald-600';
    case 'rename':
    case 'move': return 'bg-blue-500/10 text-blue-600';
    default: return 'bg-muted text-muted-foreground';
  }
}

export default function PermissionRequestModal({
  request,
  onRespond,
  testId = 'permission-modal',
}: {
  request: PermissionRequest | null;
  onRespond: (decision: PermissionResponse['decision']) => void | Promise<void>;
  testId?: string;
}) {
  return (
    <AnimatePresence>
      {request && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          data-testid={testId}
          role="dialog"
          aria-modal="true"
          aria-label={request.type === 'file' ? 'File Permission Required' : 'Permission Required'}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={springs.bouncy}
          >
            <Card className="w-full max-w-lg p-6 mx-4">
              <div className="flex items-start gap-4">
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full shrink-0',
                  request.type === 'file' ? 'bg-amber-500/10' : 'bg-warning/10'
                )}>
                  {request.type === 'file' ? (
                    <File className="h-5 w-5 text-amber-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-warning" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {request.type === 'file' ? 'File Permission Required' : 'Permission Required'}
                  </h3>

                  {request.type === 'file' ? (
                    <>
                      <div className="mb-3">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                          getOperationBadgeClasses(request.fileOperation)
                        )}>
                          {request.fileOperation?.toUpperCase()}
                        </span>
                      </div>

                      <div className="mb-4 p-3 rounded-lg bg-muted">
                        <p className="text-sm font-mono text-foreground break-all">
                          {request.filePath}
                        </p>
                        {request.targetPath && (
                          <p className="text-sm font-mono text-muted-foreground mt-1 break-all">
                            → {request.targetPath}
                          </p>
                        )}
                      </div>

                      {request.contentPreview && (
                        <details className="mb-4">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            Preview content
                          </summary>
                          <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto max-h-32 overflow-y-auto">
                            {request.contentPreview}
                          </pre>
                        </details>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground mb-4">
                        {request.question || `Allow ${request.toolName}?`}
                      </p>
                      {request.toolName && (
                        <div className="mb-4 p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto">
                          <p className="text-muted-foreground mb-1">Tool: {request.toolName}</p>
                          <pre className="text-foreground">
                            {JSON.stringify(request.toolInput, null, 2)}
                          </pre>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => void onRespond('deny')}
                      className="flex-1"
                      data-testid="permission-deny-button"
                    >
                      Deny
                    </Button>
                    {request.type === 'file' && (
                      <Button
                        variant="outline"
                        onClick={() => void onRespond('allow_all')}
                        className="flex-1"
                        data-testid="permission-allow-all-button"
                      >
                        Allow all (this task)
                      </Button>
                    )}
                    <Button
                      onClick={() => void onRespond('allow')}
                      className="flex-1"
                      data-testid="permission-allow-button"
                    >
                      Allow
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
