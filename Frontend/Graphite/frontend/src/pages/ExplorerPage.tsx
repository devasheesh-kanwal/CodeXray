import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ErrorBanner } from '../components/shared/States';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import type { FileNode, GraphData } from '../api/types';

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
  const rfNodes = nodes.map((n) => ({ id: n.id, data: { label: n.label }, position: { x: Math.random() * 400, y: Math.random() * 300 } }));
  const rfEdges = (graphQ.data?.edges || [])
    .filter((e) => (graphMode === 'imports' ? e.kind === 'import' : e.kind === 'call'))
    .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
    .map((e) => ({ id: e.source + e.target, source: e.source, target: e.target, style: { stroke: e.kind === 'import' ? '#3164f4' : '#6b6b6b', strokeDasharray: e.kind === 'call' ? '5 5' : undefined } }));

  function renderTree(node: FileNode, depth = 0): React.ReactNode {
    if (query && node.type === 'file' && !node.name.toLowerCase().includes(query.toLowerCase())) return null;
    return (
      <div key={node.path} style={{ paddingLeft: depth * 12 }}>
        {node.type === 'dir' ? (
          <div className="text-body-sm font-medium text-text-primary py-0.5">{node.name}/</div>
        ) : (
          <button onClick={() => setSelectedFile(node.path)} className="text-body-sm text-text-secondary hover:text-accent py-0.5">
            {node.name}
          </button>
        )}
        {node.children?.map((c) => renderTree(c, depth + 1))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-3 bg-surface border border-border rounded-xl p-4">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…" className="w-full h-9 px-3 rounded-md border border-border bg-surface text-body-sm mb-3" />
        {treeQ.isLoading && <Loading />}
        {treeQ.isError && (treeQ.error as any)?.status === 409 ? (
          <div className="bg-warning-soft border border-warning rounded-lg p-4 text-body-sm">
            Repo not indexed. <a href="/repos" className="text-accent underline">Go to Repos</a>
          </div>
        ) : treeQ.isError ? <ErrorBanner message={(treeQ.error as Error).message} onRetry={() => treeQ.refetch()} /> : null}
        {treeQ.data && renderTree(treeQ.data)}
      </div>
      <div className="col-span-5 bg-surface border border-border rounded-xl p-2 h-[520px]">
        <div className="flex items-center justify-between mb-2 px-2">
          <div className="flex gap-2">
            <button onClick={() => setGraphMode('imports')} className={`px-2 py-1 rounded text-caption ${graphMode === 'imports' ? 'bg-accent text-white' : 'bg-surface-muted'}`}>imports</button>
            <button onClick={() => setGraphMode('calls')} className={`px-2 py-1 rounded text-caption ${graphMode === 'calls' ? 'bg-accent text-white' : 'bg-surface-muted'}`}>calls</button>
          </div>
          <button onClick={() => setExpanded((v) => !v)} className="px-2 py-1 rounded text-caption bg-surface-muted">
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {graphQ.isLoading && <Loading />}
        {graphQ.isError && (graphQ.error as any)?.status === 409 ? (
          <div className="bg-warning-soft border border-warning rounded-lg p-4 text-body-sm">
            Repo not indexed. <a href="/repos" className="text-accent underline">Go to Repos</a>
          </div>
        ) : graphQ.isError ? <ErrorBanner message={(graphQ.error as Error).message} onRetry={() => graphQ.refetch()} /> : null}
        <div style={{ height: 460 }}>
          <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <div className="flex gap-4 text-caption px-2 mt-1">
          <span><span className="inline-block w-4 border-t-2 border-accent mr-1" /> import</span>
          <span><span className="inline-block w-4 border-t-2 border-dashed border-text-secondary mr-1" /> call</span>
        </div>
      </div>
      <div className="col-span-4">
        {selectedFile ? (
          fileQ.isLoading ? <Loading /> : fileQ.data ? (
            <CodeViewer code={fileQ.data.content} />
          ) : null
        ) : (
          <EmptyState title="Select a file" description="Click a file in the tree." />
        )}
      </div>
    </div>
  );
}
