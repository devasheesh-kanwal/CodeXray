import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useRepo } from '../context/RepoContext';
import { Loading, EmptyState, ApiErrorView } from '../components/shared/States';
import { CodeViewer } from '../components/shared/CodeViewer';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import type { TreeNode, TreeResponse, GraphData, FileSlice } from '../api/types';
import { Folder, FileCode } from 'lucide-react';

const G = {
  card: {
    background: 'rgba(255,255,255,.055)',
    backdropFilter: 'blur(22px) saturate(160%)',
    WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,.12)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), 0 12px 44px rgba(0,0,0,.40)',
    borderRadius: 14,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  dense: {
    background: 'rgba(14,14,18,.74)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,.10)',
    borderRadius: 10,
    overflow: 'hidden' as const,
  },
  input: {
    width: '100%',
    height: 36,
    padding: '0 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.12)',
    background: 'rgba(255,255,255,.07)',
    color: '#DFF5EB',
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    outline: 'none',
    marginBottom: 12,
  },
  tabActive: {
    padding: '5px 12px', borderRadius: 999, background: '#DC1F1F',
    color: '#fff', fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: 600, border: 'none', cursor: 'pointer',
  },
  tabIdle: {
    padding: '5px 12px', borderRadius: 999, background: 'transparent',
    color: '#8FA8A0', fontSize: 12, fontFamily: 'Inter, sans-serif', border: 'none', cursor: 'pointer',
  },
};

export default function ExplorerPage() {
  const { selectedRepoId } = useRepo();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  // The open file belongs to one repo; switching repos closes it.
  const [openFile, setOpenFile] = useState<{ repo: string; path: string } | null>(null);
  const selectedFile = openFile?.repo === selectedRepoId ? openFile.path : null;
  const setSelectedFile = (path: string) => setOpenFile({ repo: selectedRepoId!, path });
  const [graphMode, setGraphMode] = useState<'imports' | 'calls'>('imports');

  const treeQ = useQuery({
    queryKey: ['tree', selectedRepoId],
    queryFn: () => apiFetch<TreeResponse>(`/api/repos/${selectedRepoId}/tree`),
    enabled: !!selectedRepoId,
  });

  const graphQ = useQuery({
    queryKey: ['graph', selectedRepoId],
    queryFn: () => apiFetch<GraphData>(`/api/repos/${selectedRepoId}/graph`),
    enabled: !!selectedRepoId,
  });

  const fileQ = useQuery({
    queryKey: ['file', selectedRepoId, selectedFile],
    queryFn: () => apiFetch<FileSlice>(`/api/repos/${selectedRepoId}/file?path=${encodeURIComponent(selectedFile!)}`),
    enabled: !!selectedRepoId && !!selectedFile,
  });

  if (!selectedRepoId) return <EmptyState title="Select a repository" description="Choose a repo in the top bar." />;

  // imports link files; calls link functions and classes
  const allNodes = (graphQ.data?.nodes || []).filter((n) => (graphMode === 'imports' ? n.type === 'file' : n.type !== 'file'));
  const nodes = expanded ? allNodes : allNodes.slice(0, 20);
  const rfNodes = nodes.map((n, i) => ({
    id: n.id,
    data: { label: n.label },
    position: { x: (i % 3) * 160 + 30, y: Math.floor(i / 3) * 80 + 30 },
    style: {
      background: 'rgba(14,14,18,.85)',
      color: '#DFF5EB',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: 999,
      padding: '6px 14px',
      fontSize: '12px',
      fontFamily: "'JetBrains Mono', monospace",
    },
  }));

  const rfEdges = (graphQ.data?.edges || [])
    .filter((e) => e.type === graphMode)
    .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
    .map((e) => ({
      id: e.source + e.target,
      source: e.source,
      target: e.target,
      animated: e.type === 'calls',  // calls flow as moving dashes; imports stay solid (see the legend)
      style: { stroke: 'rgba(217,160,102,.35)', strokeWidth: 1.5, strokeDasharray: e.type === 'calls' ? '5 5' : undefined },
    }));

  function renderTree(node: TreeNode, depth = 0): React.ReactNode {
    const isDir = node.type === 'folder';
    if (query && !isDir && !node.name.toLowerCase().includes(query.toLowerCase())) return null;
    return (
      <div key={node.path || node.name} style={{ paddingLeft: depth * 12 }}>
        {isDir ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#DFF5EB' }}>
            <Folder size={12} style={{ color: '#8FA8A0' }} />
            <span>{node.name}/</span>
          </div>
        ) : (
          <button
            onClick={() => setSelectedFile(node.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 6px', borderRadius: 6, width: '100%', textAlign: 'left',
              fontSize: 12, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', border: 'none',
              background: selectedFile === node.path ? 'rgba(220,31,31,.15)' : 'transparent',
              color: selectedFile === node.path ? '#DFF5EB' : '#8FA8A0',
              borderLeft: selectedFile === node.path ? '2px solid #DC1F1F' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <FileCode size={12} style={{ color: 'rgba(143,168,160,.5)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          </button>
        )}
        {node.children.map((c) => renderTree(c, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h1 className="page-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px' }}>
          <span className="page-title-accent">EXPLORE</span>
          <span>your codebase</span>
        </h1>
        <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,.12)', margin: '14px 0' }} />
        <p style={{ color: '#8FA8A0', fontSize: 13 }}>Browse the syntax tree, file contents, and dependency graph</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 5fr 4fr', gap: 20 }}>
        {/* File Tree */}
        <div style={{ ...G.card, padding: 14, height: 580, display: 'flex', flexDirection: 'column' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…" style={G.input} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {treeQ.isLoading && <Loading />}
            {treeQ.isError && <ApiErrorView error={treeQ.error} onRetry={() => treeQ.refetch()} />}
            {treeQ.data && renderTree(treeQ.data.root)}
          </div>
        </div>

        {/* Graph Canvas */}
        <div style={{ ...G.card, padding: 14, height: 580, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 999, display: 'inline-flex', padding: 3 }}>
              <button type="button" onClick={() => setGraphMode('imports')} style={graphMode === 'imports' ? G.tabActive : G.tabIdle}>imports</button>
              <button type="button" onClick={() => setGraphMode('calls')} style={graphMode === 'calls' ? G.tabActive : G.tabIdle}>calls</button>
            </div>
            <button type="button" onClick={() => setExpanded((v) => !v)}
              style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', color: '#8FA8A0', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {graphQ.isLoading && <Loading />}
          {graphQ.isError && <ApiErrorView error={graphQ.error} onRetry={() => graphQ.refetch()} />}

          <div style={{ ...G.dense, flex: 1 }}>
            <ReactFlow nodes={rfNodes} edges={rfEdges} fitView>
              <Background color="rgba(255,255,255,.06)" gap={16} />
              <Controls />
              <MiniMap
                style={{ background: 'rgba(14,14,18,.85)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 8, width: 120, height: 80 }}
                nodeColor="#D9A066"
                maskColor="rgba(0,0,0,.7)"
              />
            </ReactFlow>
          </div>

          <div style={{ display: 'flex', gap: 20, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#8FA8A0', marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.08)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 16, height: 1.5, background: 'rgba(217,160,102,.5)' }} />solid = import
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 16, height: 1.5, borderTop: '1px dashed rgba(217,160,102,.5)' }} />dashed = call
            </span>
          </div>
        </div>

        {/* Code Viewer */}
        <div style={{ height: 580, overflowY: 'auto' }}>
          {selectedFile ? (
            fileQ.isLoading ? (
              <Loading />
            ) : fileQ.isError ? (
              <ApiErrorView error={fileQ.error} onRetry={() => fileQ.refetch()} />
            ) : fileQ.data ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#8FA8A0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedFile}
                </div>
                <CodeViewer code={fileQ.data.lines.join('\n')} language="python" startLine={fileQ.data.start} />
              </div>
            ) : null
          ) : (
            <div style={{ ...G.card, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <EmptyState title="Select a file" description="Click a file in the tree to inspect code." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
