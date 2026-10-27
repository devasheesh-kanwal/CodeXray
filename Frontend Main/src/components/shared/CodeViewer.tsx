import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function CodeViewer({
  code,
  language = 'typescript',
  highlightLines = [],
  startLine = 1,
}: {
  code: string;
  language?: string;
  highlightLines?: number[];
  startLine?: number;
}) {
  const hlSet = new Set(highlightLines);
  return (
    <div className="bg-surface border border-border rounded-xl overflow-auto text-mono">
      <SyntaxHighlighter
        language={language}
        style={oneLight}
        showLineNumbers
        startingLineNumber={startLine}
        wrapLines
        lineProps={(ln) => (hlSet.has(ln) ? { style: { backgroundColor: '#e8eeff', display: 'block' } } : {})}
        customStyle={{ margin: 0, background: 'transparent', fontSize: '14px' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
