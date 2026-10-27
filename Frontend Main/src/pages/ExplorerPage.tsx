import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import type { FileNode, GraphData, CodeSymbol } from '../api/types';
import { Folder, FileCode, FunctionSquare, Box, MessageSquareText, ChevronRight, ChevronDown, Network } from 'lucide-react';

export default function ExplorerPage() {
  const { selectedRepoId, selectedRepo } = useRepo();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [expandedGraph, setExpandedGraph] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>('src/api/client.ts');
  const [highlightRange, setHighlightRange] = useState<{ start: number; end: number } | null>({ start: 15, end: 30 });
  const [activeSymbolName, setActiveSymbolName] = useState<string | null>('apiFetch()');
  const [graphMode, setGraphMode] = useState<'imports' | 'calls'>('imports');
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ src: true, 'src/api': true, auth: true });
  const [viewTab, setViewTab] = useState<'code' | 'graph'>('code');

  const treeQ = useQuery({
    queryKey: ['tree', selectedRepoId],
    queryFn: () => apiFetch<FileNode>(`/api/repos/${selectedRepoId}/tree`),
    enabled: !!selectedRepoId,
  });

  const graphQ = useQuery({
    queryKey: ['graph', selectedRepoId],
    queryFn: () => apiFetch<GraphData>(`/api/repos/${selectedRepoId}/graph`),
    enabled: !!selectedRepoId,
  });

  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, selectedFile],
    queryFn: () => apiFetch<{ path: string; content: string }>(`/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(selectedFile!)}`),
    enabled: !!selectedRepoId && !!selectedFile,
  });

  if (!selectedRepoId) {
    return (
      <EmptyState
        title="No repository selected"
        description="Please select a repository from the top bar or Repos page to browse its files and call graph."
      />
    );
  }

  const allNodes = graphQ.data?.nodes || [];
  const nodes = expandedGraph ? allNodes : allNodes.slice(0, 20);
  const rfNodes = nodes.map((n, i) => ({
    id: n.id,
    data: { label: n.label },
    position: { x: (i % 3) * 170 + 30, y: Math.floor(i / 3) * 90 + 30 },
    style: {
      borderRadius: '8px',
      border: '1px solid #3164f4',
      background: '#ffffff',
      fontSize: '12px',
      fontWeight: 500,
      padding: '8px 12px',
    },
  }));

  const rfEdges = (graphQ.data?.edges || [])
    .filter((e) => (graphMode === 'imports' ? e.kind === 'import' : e.kind === 'call'))
    .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
    .map((e) => ({
      id: e.source + '-' + e.target,
      source: e.source,
      target: e.target,
      label: e.kind,
      style: {
        stroke: e.kind === 'import' ? '#3164f4' : '#f5a623',
        strokeDasharray: e.kind === 'call' ? '4 4' : undefined,
      },
    }));

  function toggleFolder(path: string) {
    setOpenFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function handleSelectFile(path: string) {
    setSelectedFile(path);
    setHighlightRange(null);
    setActiveSymbolName(null);
  }

  function handleSelectSymbol(filePath: string, sym: CodeSymbol) {
    setSelectedFile(filePath);
    setHighlightRange({ start: sym.startLine, end: sym.endLine });
    setActiveSymbolName(sym.name);
  }

  function askAboutCurrent() {
    const topic = activeSymbolName
      ? `How does ${activeSymbolName} in ${selectedFile} work?`
      : `Explain the architecture and responsibility of ${selectedFile}`;
    navigate(`/ask?q=${encodeURIComponent(topic)}`);
  }

  function renderTree(node: FileNode, depth = 0): React.ReactNode {
    if (query && node.type === 'file' && !node.name.toLowerCase().includes(query.toLowerCase())) {
      // Check if any child symbol matches
      const hasMatch = node.symbols?.some((s) => s.name.toLowerCase().includes(query.toLowerCase()));
      if (!hasMatch) return null;
    }

    if (node.type === 'dir') {
      const isRoot = !node.path;
      if (isRoot) {
        return node.children?.map((c) => renderTree(c, depth));
      }
      const isOpen = openFolders[node.path] !== false;
      return (
        <div key={node.path} className="select-none">
          <button
            onClick={() => toggleFolder(node.path)}
            style={{ paddingLeft: `${depth * 14}px` }}
            className="w-full flex items-center gap-2 py-1 px-2 rounded-lg text-body-sm text-text-primary hover:bg-surface-muted transition-colors font-medium text-left"
          >
            {isOpen ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
            <Folder size={15} className="text-accent fill-accent/20" />
            <span>{node.name}</span>
          </button>
          {isOpen && node.children?.map((c) => renderTree(c, depth + 1))}
        </div>
      );
    }

    // File
    const isSelected = selectedFile === node.path;
    return (
      <div key={node.path} className="select-none">
        <button
          onClick={() => handleSelectFile(node.path)}
          style={{ paddingLeft: `${depth * 14 + 16}px` }}
          className={`w-full flex items-center gap-2 py-1 px-2 rounded-lg text-body-sm transition-colors text-left ${
            isSelected && !activeSymbolName
              ? 'bg-accent text-white font-medium shadow-xs'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted'
          }`}
        >
          <FileCode size={14} className={isSelected && !activeSymbolName ? 'text-white' : 'text-text-muted'} />
          <span className="truncate">{node.name}</span>
        </button>

        {/* Function and Class symbols under this file */}
        {node.symbols && node.symbols.length > 0 && (
          <div className="space-y-0.5 my-0.5">
            {node.symbols.map((sym) => {
              const isSymbolActive = isSelected && activeSymbolName === sym.name;
              return (
                <button
                  key={sym.name}
                  onClick={() => handleSelectSymbol(node.path, sym)}
                  style={{ paddingLeft: `${depth * 14 + 34}px` }}
                  className={`w-full flex items-center gap-2 py-0.5 px-2 rounded-md text-caption transition-colors text-left ${
                    isSymbolActive
                      ? 'bg-accent-soft text-accent font-semibold border-l-2 border-accent'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-muted'
                  }`}
                >
                  {sym.kind === 'class' ? (
                    <Box size={12} className="text-indigo-500" />
                  ) : (
                    <FunctionSquare size={12} className="text-emerald-500" />
                  )}
                  <span className="truncate">{sym.name}</span>
                  <span className="ml-auto text-[10px] text-text-muted">L{sym.startLine}-{sym.endLine}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const highlightLines = highlightRange
    ? Array.from({ length: highlightRange.end - highlightRange.start + 1 }, (_, i) => highlightRange.start + i)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Code Explorer</h1>
          <p className="text-body-sm text-text-secondary">
            Inspecting <span className="font-semibold text-text-primary">{selectedRepo?.name}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded-xl bg-surface p-1">
            <button
              onClick={() => setViewTab('code')}
              className={`px-3 py-1 rounded-lg text-caption font-semibold transition-colors ${
                viewTab === 'code' ? 'bg-accent text-white shadow-xs' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Code View
            </button>
            <button
              onClick={() => setViewTab('graph')}
              className={`px-3 py-1 rounded-lg text-caption font-semibold transition-colors flex items-center gap-1.5 ${
                viewTab === 'graph' ? 'bg-accent text-white shadow-xs' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Network size={13} /> Dependency Graph
            </button>
          </div>

          {selectedFile && (
            <button
              onClick={askAboutCurrent}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-body-sm font-semibold hover:bg-accent-hover active:bg-accent-active shadow-xs transition-all"
            >
              <MessageSquareText size={15} />
              Ask about this
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Left Column: File & Symbol Tree */}
        <div className="col-span-4 bg-surface border border-border rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
            <span className="text-caption font-bold text-text-primary uppercase tracking-wider">File & Symbol Tree</span>
            <span className="text-[11px] text-text-muted">Folders → Files → Functions/Classes</span>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files & symbols…"
            className="w-full h-9 px-3 rounded-xl border border-border bg-surface text-body-sm mb-3 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />

          <div className="max-h-[620px] overflow-y-auto space-y-1 pr-1">
            {treeQ.isLoading && <Loading label="Loading file tree…" />}
            {treeQ.isError && <ErrorBanner message={(treeQ.error as Error).message} onRetry={() => treeQ.refetch()} />}
            {treeQ.data && renderTree(treeQ.data)}
          </div>
        </div>

        {/* Right Column: Code Viewer or Graph */}
        <div className="col-span-8 space-y-4">
          {viewTab === 'code' ? (
            <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-3 border-b border-border bg-surface-muted/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <FileCode size={16} className="text-accent" />
                  <span className="text-body-sm font-mono font-semibold text-text-primary">{selectedFile || 'Select a file'}</span>
                  {activeSymbolName && (
                    <span className="px-2 py-0.5 rounded-full text-caption font-semibold bg-accent-soft text-accent border border-accent/20">
                      Symbol: {activeSymbolName} (L{highlightRange?.start}-{highlightRange?.end})
                    </span>
                  )}
                </div>
                {highlightRange && (
                  <button
                    onClick={() => { setHighlightRange(null); setActiveSymbolName(null); }}
                    className="text-caption text-text-muted hover:text-text-primary underline"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {selectedFile ? (
                fileQ.isLoading ? (
                  <div className="p-8"><Loading label="Fetching source code…" /></div>
                ) : fileQ.data ? (
                  <div className="p-4 max-h-[620px] overflow-auto">
                    <CodeViewer
                      code={fileQ.data.content}
                      highlightLines={highlightLines}
                      language={selectedFile.endsWith('.py') ? 'python' : 'typescript'}
                    />
                  </div>
                ) : null
              ) : (
                <EmptyState title="No file selected" description="Click any file, function, or class in the tree to view its source code." />
              )}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => setGraphMode('imports')}
                    className={`px-3 py-1 rounded-lg text-caption font-semibold ${
                      graphMode === 'imports' ? 'bg-accent text-white' : 'bg-surface-muted text-text-secondary'
                    }`}
                  >
                    Imports graph
                  </button>
                  <button
                    onClick={() => setGraphMode('calls')}
                    className={`px-3 py-1 rounded-lg text-caption font-semibold ${
                      graphMode === 'calls' ? 'bg-accent text-white' : 'bg-surface-muted text-text-secondary'
                    }`}
                  >
                    Call hierarchy
                  </button>
                </div>
                <button
                  onClick={() => setExpandedGraph((v) => !v)}
                  className="px-3 py-1 rounded-lg text-caption font-medium bg-surface-muted hover:bg-slate-200"
                >
                  {expandedGraph ? 'Show primary' : 'Expand all nodes'}
                </button>
              </div>

              {graphQ.isLoading && <Loading label="Generating dependency graph…" />}
              {graphQ.isError && <ErrorBanner message={(graphQ.error as Error).message} />}

              <div style={{ height: 500 }} className="border border-border rounded-xl overflow-hidden bg-slate-50/50">
                <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
                  <Background color="#e2e8f0" gap={16} />
                  <Controls />
                  <MiniMap />
                </ReactFlow>
              </div>

              <div className="flex items-center gap-6 text-caption text-text-secondary px-2 mt-3 pt-2 border-t border-border">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-accent" /> Import relationship
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t border-dashed border-amber-500" /> Function invocation
                </span>
                <span className="ml-auto text-text-muted">{nodes.length} nodes · {rfEdges.length} edges</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

