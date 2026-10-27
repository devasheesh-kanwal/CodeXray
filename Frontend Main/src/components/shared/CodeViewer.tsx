import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
    <div
      className="glass-dense"
      style={{
        borderRadius: 12,
        overflow: 'auto',
        fontSize: 13,
      }}
    >
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        showLineNumbers
        startingLineNumber={startLine}
        wrapLines
        lineProps={(ln) =>
          hlSet.has(ln)
            ? { style: { backgroundColor: 'rgba(220,31,31,.22)', display: 'block' } }
            : {}
        }
        customStyle={{
          margin: 0,
          background: 'transparent',
          fontSize: '13px',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          lineHeight: 1.6,
        }}
        lineNumberStyle={{
          color: 'rgba(143,168,160,.40)',
          fontSize: '12px',
          userSelect: 'none',
          minWidth: '3em',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
