import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  markdown: string
  className?: string
}

export default function MarkdownContent({ markdown, className = '' }: Props) {
  return (
    <div className={`min-w-0 break-words text-text-primary ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-xs font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-2 leading-6 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5 leading-5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-accent/45 pl-3 text-text-secondary">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
          pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded bg-bg-elevated p-2 text-[11px] leading-5">{children}</pre>,
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-left">{children}</table></div>,
          th: ({ children }) => <th className="border border-border bg-bg-elevated px-2 py-1 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-border" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
