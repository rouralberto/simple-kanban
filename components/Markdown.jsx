import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Raw HTML is not rendered (react-markdown default), so user content can't inject scripts.
export default function Markdown({ children }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
