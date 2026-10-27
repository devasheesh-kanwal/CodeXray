import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import type { FileNode, GraphData } from '../api/types';
import { Folder, FileCode } from 'lucide-react';

export default function ExplorerPage() {
  const { selectedRepoId } = useRepo();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<'imports' | 'calls'>('imports');

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

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  const allNodes = graphQ.data?.nodes || [];
  const nodes = expanded ? allNodes : allNodes.slice(0, 20);
  const rfNodes = nodes.map((n, i) => ({
    id: n.id,
    data: { label: n.label },
    position: { x: (i % 3) * 160 + 30, y: Math.floor(i / 3) * 80 + 30 },
    style: {
      background: '#0A0A0A',
      color: '#CFF1E6',
      border: '1px solid rgba(207, 241, 230, 0.35)',
      borderRadius: '999px',
      padding: '6px 14px',
      fontSize: '12px',
      fontFamily: "'JetBrains Mono', monospace",
      boxShadow: '0 2px 10px rgba(0,0,0,0.7)',
    },
  }));

  const rfEdges = (graphQ.data?.edges || [])
    .filter((e) => (graphMode === 'imports' ? e.kind === 'import' : e.kind === 'call'))
    .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
    .map((e) => ({
      id: e.source + e.target,
      source: e.source,
      target: e.target,
      style: {
        stroke: 'rgba(255, 255, 255, 0.20)', // --border-strong
        strokeWidth: 1.5,
        strokeDasharray: e.kind === 'call' ? '5 5' : undefined,
      },
    }));

  function renderTree(node: FileNode, depth = 0): React.ReactNode {
    if (query && node.type === 'file' && !node.name.toLowerCase().includes(query.toLowerCase())) return null;
    return (
      <div key={node.path} style={{ paddingLeft: depth * 12 }}>
        {node.type === 'dir' ? (
          <div className="text-xs font-mono font-medium text-text py-1 flex items-center gap-1.5">
            <Folder size={13} className="text-text-muted" />
            <span>{node.name}/</span>
          </div>
        ) : (
          <button
            onClick={() => setSelectedFile(node.path)}
            className={`text-xs font-mono py-1 px-1.5 rounded transition-colors flex items-center gap-1.5 w-full text-left truncate cursor-pointer ${
              selectedFile === node.path
                ? 'bg-accent-soft text-text font-medium border-l-2 border-accent'
                : 'text-text-muted hover:text-text hover:bg-bg-raised'
            }`}
          >
            <FileCode size={13} className="shrink-0 text-text-faint" />
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {node.children?.map((c) => renderTree(c, depth + 1))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6 font-sans">
      {/* File Tree */}
      <div className="col-span-3 bg-bg-surface border border-border rounded-[14px] p-4 flex flex-col h-[580px]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          className="w-full h-9 px-3 rounded-[10px] border border-border bg-bg-raised text-text placeholder:text-text-faint text-xs font-mono mb-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-soft"
        />
        <div className="flex-1 overflow-auto">
          {treeQ.isLoading && <Loading />}
          {treeQ.isError && (treeQ.error as any)?.status === 409 ? (
            <div className="bg-warning/10 border border-warning rounded-[10px] p-3 text-xs text-text-muted font-sans">
              Repo not indexed.{' '}
              <a href="/repos" className="text-accent underline font-medium">
                Go to Repos
              </a>
            </div>
          ) : treeQ.isError ? (
            <ErrorBanner message={(treeQ.error as Error).message} onRetry={() => treeQ.refetch()} />
          ) : null}
          {treeQ.data && renderTree(treeQ.data)}
        </div>
      </div>

      {/* Graph Canvas */}
      <div className="col-span-5 bg-bg-surface border border-border rounded-[14px] p-4 h-[580px] flex flex-col">
        <div className="flex items-center justify-between mb-3 px-1">
          {/* Segmented Control */}
          <div className="bg-bg-raised p-1 rounded-full inline-flex border border-border">
            <button
              type="button"
              onClick={() => setGraphMode('imports')}
              className={`px-3 py-1 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
                graphMode === 'imports' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              imports
            </button>
            <button
              type="button"
              onClick={() => setGraphMode('calls')}
              className={`px-3 py-1 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
                graphMode === 'calls' ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              calls
            </button>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="px-3 py-1 rounded-full text-xs font-sans font-medium border border-border bg-bg-raised text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {graphQ.isLoading && <Loading />}
        {graphQ.isError && (graphQ.error as any)?.status === 409 ? (
          <div className="bg-warning/10 border border-warning rounded-[10px] p-3 text-xs text-text-muted font-sans">
            Repo not indexed.{' '}
            <a href="/repos" className="text-accent underline font-medium">
              Go to Repos
            </a>
          </div>
        ) : graphQ.isError ? (
          <ErrorBanner message={(graphQ.error as Error).message} onRetry={() => graphQ.refetch()} />
        ) : null}

        {/* Graph view container with --bg-deep background */}
        <div className="flex-1 bg-bg-deep rounded-[10px] border border-border overflow-hidden relative">
          <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
            <Background color="rgba(255,255,255,0.08)" gap={16} />
            <Controls />
            <MiniMap
              style={{
                background: '#0A0A0A',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
              }}
              nodeColor="#CFF1E6"
              maskColor="rgba(0,0,0,0.7)"
            />
          </ReactFlow>
        </div>

        {/* Legend */}
        <div className="flex gap-5 text-xs font-mono text-text-muted px-1 mt-2.5 pt-2 border-t border-border">
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-0.5 bg-border-strong" />
            <span>import (solid)</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-0.5 border-t border-dashed border-border-strong" />
            <span>call (dashed)</span>
          </span>
        </div>
      </div>

      {/* Code Viewer */}
      <div className="col-span-4 h-[580px] overflow-auto">
        {selectedFile ? (
          fileQ.isLoading ? (
            <Loading />
          ) : fileQ.data ? (
            <div className="space-y-2">
              <div className="text-xs font-mono text-text-muted px-1 truncate">
                {selectedFile}
              </div>
              <CodeViewer code={fileQ.data.content} />
            </div>
          ) : null
        ) : (
          <div className="bg-bg-surface border border-border rounded-[14px] p-8 h-full flex items-center justify-center">
            <EmptyState title="Select a file" description="Click a file in the tree to inspect code." />
          </div>
        )}
      </div>
    </div>
  );
}
