'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';
import type { HelpDocPageResponse, HelpDocSummary, HelpDocsSearchResult } from '@accomplish/shared';
import { getAccomplish } from '@/lib/accomplish';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BookText,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Globe,
} from 'lucide-react';

const sanitizeSchema: any = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema as any).attributes,
    a: [...(((defaultSchema as any).attributes?.a) ?? []), 'target', 'rel'],
    code: [...(((defaultSchema as any).attributes?.code) ?? []), 'className'],
    img: [...(((defaultSchema as any).attributes?.img) ?? []), 'src', 'alt', 'title', 'width', 'height'],
    span: [...(((defaultSchema as any).attributes?.span) ?? []), 'className'],
    div: [...(((defaultSchema as any).attributes?.div) ?? []), 'className'],
  },
};

function resolveRelativePath(fromFile: string, targetPath: string): string {
  const baseParts = fromFile.split('/');
  baseParts.pop();
  const targetParts = targetPath.split('/');
  const out = [...baseParts];
  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function splitPathAndAnchor(href: string): { path: string; anchor: string } {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return { path: href, anchor: '' };
  return {
    path: href.slice(0, hashIndex),
    anchor: href.slice(hashIndex + 1),
  };
}

function isExternalUrl(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

function isDataUrl(href: string): boolean {
  return /^data:/i.test(href);
}

function HelpMarkdownImage(props: {
  src?: string;
  alt?: string;
  title?: string;
  docId: string;
  cacheRef: React.MutableRefObject<Map<string, string>>;
}) {
  const { src, alt, title, docId, cacheRef } = props;
  const [resolvedSrc, setResolvedSrc] = useState<string>(src || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!src) {
        setResolvedSrc('');
        return;
      }
      if (isExternalUrl(src) || isDataUrl(src)) {
        setResolvedSrc(src);
        return;
      }
      const key = `${docId}::${src}`;
      const cached = cacheRef.current.get(key);
      if (cached) {
        setResolvedSrc(cached);
        return;
      }
      setLoading(true);
      try {
        const res = await getAccomplish().getHelpAssetDataUrl(docId, src);
        if (cancelled) return;
        cacheRef.current.set(key, res.dataUrl);
        setResolvedSrc(res.dataUrl);
      } catch (error) {
        if (!cancelled) {
          console.warn('[Help] Failed to resolve image:', src, error);
          setResolvedSrc('');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [docId, src, cacheRef]);

  if (loading) {
    return (
      <span className="my-2 inline-flex min-h-[2.25rem] items-center justify-center rounded-lg border border-border bg-muted/20 px-3 py-2 align-middle">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </span>
    );
  }

  if (!resolvedSrc) {
    return (
      <span className="my-2 inline-block rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground align-middle">
        Unable to load image: <code>{src}</code>
      </span>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      title={title}
      className="my-4 h-auto max-w-full rounded-lg border border-border"
      loading="lazy"
    />
  );
}

export default function HelpPage() {
  const navigate = useNavigate();
  const params = useParams<{ docId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [docs, setDocs] = useState<HelpDocSummary[]>([]);
  const [embeddedSiteUrl, setEmbeddedSiteUrl] = useState<string | undefined>(undefined);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [docPage, setDocPage] = useState<HelpDocPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [searchResults, setSearchResults] = useState<HelpDocsSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showEmbeddedSite, setShowEmbeddedSite] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(document.documentElement.classList.contains('dark'));
  const imageDataUrlCache = useRef<Map<string, string>>(new Map());
  const searchTimer = useRef<number | null>(null);

  const currentDocId = typeof params.docId === 'string' ? decodeURIComponent(params.docId) : '';
  const docsByFile = useMemo(() => {
    const map = new Map<string, HelpDocSummary>();
    for (const doc of docs) {
      map.set(doc.file.toLowerCase(), doc);
    }
    return map;
  }, [docs]);

  const loadDocs = useCallback(async () => {
    setLoadingList(true);
    try {
      const result = await getAccomplish().listHelpDocs();
      setDocs(result.docs);
      setEmbeddedSiteUrl(result.embeddedSiteUrl);
    } catch (loadError) {
      console.error('[Help] Failed to list docs:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load help pages');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDoc = useCallback(async (docId: string) => {
    if (!docId) return;
    setLoadingDoc(true);
    setError(null);
    try {
      const result = await getAccomplish().readHelpDoc(docId);
      setDocPage(result);
    } catch (loadError) {
      console.error('[Help] Failed to read doc:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load this page');
      setDocPage(null);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
    const unsubscribe = getAccomplish().onHelpDocsUpdated?.(() => {
      void loadDocs();
      if (currentDocId) {
        void loadDoc(currentDocId);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [currentDocId, loadDoc, loadDocs]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const targetDoc = docs.find((doc) => doc.id === currentDocId) ?? docs[0];
    if (!targetDoc) {
      setDocPage(null);
      return;
    }
    if (!currentDocId || targetDoc.id !== currentDocId) {
      navigate(`/help/${encodeURIComponent(targetDoc.id)}`, { replace: true });
      return;
    }
    void loadDoc(targetDoc.id);
  }, [currentDocId, docs, loadDoc, navigate]);

  useEffect(() => {
    const q = searchParams.get('q') ?? '';
    setSearchQuery(q);
  }, [searchParams]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(() => {
      void getAccomplish().searchHelpDocs(query)
        .then((result) => setSearchResults(result.results))
        .catch((searchError) => {
          console.error('[Help] Search failed:', searchError);
          setSearchResults([]);
        })
        .finally(() => setSearching(false));
    }, 180);

    return () => {
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
    };
  }, [searchQuery]);

  useEffect(() => {
    const anchor = searchParams.get('anchor');
    if (!anchor) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(anchor);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [docPage?.doc.id, searchParams]);

  const navigateToDoc = useCallback((docId: string, anchor?: string) => {
    const nextPath = `/help/${encodeURIComponent(docId)}`;
    if (anchor) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('anchor', anchor);
        return next;
      }, { replace: true });
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('anchor');
        return next;
      }, { replace: true });
    }
    navigate(nextPath);
    setShowEmbeddedSite(false);
  }, [navigate, setSearchParams]);

  const markdownComponents = useMemo<Components>(() => ({
    a: ({ href, children, ...props }) => {
      const rawHref = typeof href === 'string' ? href.trim() : '';
      if (!rawHref) {
        return <a {...props}>{children}</a>;
      }
      if (isExternalUrl(rawHref)) {
        return (
          <a
            {...props}
            href={rawHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void getAccomplish().openExternal(rawHref);
            }}
          >
            {children}
          </a>
        );
      }
      if (rawHref.startsWith('#')) {
        const anchorId = rawHref.slice(1);
        return (
          <a
            {...props}
            href={rawHref}
            onClick={(event) => {
              event.preventDefault();
              if (!anchorId) return;
              const element = document.getElementById(anchorId);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          >
            {children}
          </a>
        );
      }

      const activeDoc = docPage?.doc;
      if (!activeDoc) {
        return <a {...props}>{children}</a>;
      }

      const { path: hrefPath, anchor } = splitPathAndAnchor(rawHref);
      const candidatePath = resolveRelativePath(activeDoc.file, hrefPath).toLowerCase();
      const candidateDoc = docsByFile.get(candidatePath);

      if (candidateDoc || hrefPath.toLowerCase().endsWith('.md')) {
        const targetDoc = candidateDoc ?? docs.find((doc) => doc.id === hrefPath.toLowerCase().replace(/\.md$/i, ''));
        if (targetDoc) {
          return (
            <a
              {...props}
              href={`/help/${encodeURIComponent(targetDoc.id)}`}
              onClick={(event) => {
                event.preventDefault();
                navigateToDoc(targetDoc.id, anchor || undefined);
              }}
            >
              {children}
            </a>
          );
        }
      }

      return (
        <a
          {...props}
          href={rawHref}
          onClick={(event) => {
            event.preventDefault();
            void getAccomplish().openHelpAsset(activeDoc.id, hrefPath);
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, title }) => (
      <HelpMarkdownImage
        src={src}
        alt={alt}
        title={title}
        docId={docPage?.doc.id || ''}
        cacheRef={imageDataUrlCache}
      />
    ),
    code: (rawProps: any) => {
      const { inline, className, children, ...props } = rawProps;
      const languageMatch = /language-(\w+)/.exec(className || '');
      if (!inline && languageMatch) {
        return (
          <SyntaxHighlighter
            language={languageMatch[1]}
            style={isDarkMode ? oneDark : oneLight}
            customStyle={{ borderRadius: '0.6rem', margin: '1rem 0', fontSize: '0.85rem' }}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        );
      }
      return (
        <code
          {...props}
          className="rounded bg-muted px-1.5 py-0.5 text-[0.86em] text-foreground"
        >
          {children}
        </code>
      );
    },
  }), [docPage?.doc, docs, docsByFile, isDarkMode, navigateToDoc]);

  const selectedDocId = docPage?.doc.id ?? currentDocId;
  const visibleDocs = searchQuery.trim()
    ? docs.filter((doc) => doc.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) || doc.file.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : docs;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[320px] shrink-0 border-r border-border bg-card/50">
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <BookText className="h-4 w-4 text-primary" />
            Help
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => {
                const value = event.target.value;
                setSearchQuery(value);
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  if (value.trim()) next.set('q', value.trim());
                  else next.delete('q');
                  return next;
                }, { replace: true });
              }}
              className="pl-9"
              placeholder="Search help pages..."
            />
          </div>
        </div>

        <ScrollArea className="h-[calc(100%-88px)]">
          <div className="space-y-3 p-3">
            {searchQuery.trim() && (
              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Search Results
                </div>
                {searching ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="space-y-1">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.docId}-${result.file}`}
                        type="button"
                        onClick={() => navigateToDoc(result.docId)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-accent"
                      >
                        <div className="truncate text-sm font-medium">{result.title}</div>
                        <div className="line-clamp-2 text-xs text-muted-foreground">{result.excerpt}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    No results for “{searchQuery.trim()}”.
                  </div>
                )}
              </section>
            )}

            <section className="space-y-1">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pages
              </div>
              {loadingList ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading pages...
                </div>
              ) : visibleDocs.length > 0 ? (
                visibleDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => navigateToDoc(doc.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      selectedDocId === doc.id
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-border bg-background hover:bg-accent'
                    }`}
                  >
                    <div className="truncate text-sm font-medium">{doc.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{doc.file}</div>
                  </button>
                ))
              ) : (
                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  No help markdown files found.
                </div>
              )}
            </section>
          </div>
        </ScrollArea>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {showEmbeddedSite
                ? 'Embedded Docs Site'
                : (docPage?.doc.title || 'Help')}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {showEmbeddedSite
                ? (embeddedSiteUrl || 'No embedded site configured')
                : (docPage?.doc.file || 'Select a help page from the left')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {embeddedSiteUrl && (
              <Button
                variant={showEmbeddedSite ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowEmbeddedSite((prev) => !prev)}
                title="Toggle embedded static docs site"
              >
                <Globe className="mr-1.5 h-3.5 w-3.5" />
                Docs Site
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDocs()}
              title="Reload help pages"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void getAccomplish().openHelpDocsFolder()}
              title="Open writable help docs folder"
            >
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Folder
            </Button>
            {docPage?.doc.id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void getAccomplish().openHelpDocInEditor(docPage.doc.id)}
                title="Edit this page in your default editor"
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit This Page
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/')}
              title="Close Help and return to New Task"
            >
              Close
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {showEmbeddedSite && embeddedSiteUrl ? (
            <div className="h-full min-h-[400px] rounded-lg border border-border bg-background">
              <iframe
                title="Embedded static docs site"
                src={embeddedSiteUrl}
                className="h-full min-h-[400px] w-full rounded-lg"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            </div>
          ) : loadingDoc ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading help page...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : docPage ? (
            <article className="help-markdown prose prose-slate max-w-none dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSlug, [rehypeSanitize, sanitizeSchema]]}
                components={markdownComponents}
              >
                {docPage.content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                No page selected
              </div>
              Choose a help page from the sidebar, or open the help folder and add markdown files.
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void getAccomplish().openHelpDocsFolder()}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open Help Folder
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
