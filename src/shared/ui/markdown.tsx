import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { cn } from '@/shared/lib/utils';

/**
 * T-117-FU3 · Render de markdown reutilizable. Extraido de
 * `informes/[id]/MarkdownPreview` (T-020) para que informes y el asistente EPP
 * compartan UN solo mapa de `components` + plugins, sin duplicar.
 *
 * Sin `'use client'` → isomorphic: lo usa el Server Component del preview de
 * informes y el Client Component del chat del asistente.
 *
 * Seguridad: rehype-sanitize aplica el schema por defecto (GitHub-style) que
 * strippea script/iframe/style, on* handlers y javascript: hrefs. El contenido
 * viene del modelo o del editor del user — siempre pasa por sanitize antes del DOM.
 *
 * Styling: clases Tailwind manuales por elemento para no depender de
 * @tailwindcss/typography (no instalado). Tipografia consistente con el shell.
 */

const components: Components = {
  h1: (props) => <h1 className="text-foreground mt-2 mb-4 text-2xl font-semibold" {...props} />,
  h2: (props) => (
    <h2 className="text-foreground mt-6 mb-3 text-xl font-semibold tracking-tight" {...props} />
  ),
  h3: (props) => (
    <h3 className="text-foreground mt-5 mb-2 text-base font-semibold tracking-tight" {...props} />
  ),
  p: (props) => <p className="text-foreground my-3 text-sm leading-6" {...props} />,
  ul: (props) => <ul className="my-3 ml-6 list-disc space-y-1 text-sm" {...props} />,
  ol: (props) => <ol className="my-3 ml-6 list-decimal space-y-1 text-sm" {...props} />,
  li: (props) => <li className="text-foreground leading-6" {...props} />,
  strong: (props) => <strong className="text-foreground font-semibold" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  blockquote: (props) => (
    <blockquote className="text-muted-foreground my-3 border-l-2 pl-4 text-sm italic" {...props} />
  ),
  code: ({ children, ...props }) => (
    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs" {...props}>
      {children}
    </code>
  ),
  pre: (props) => (
    <pre className="bg-muted my-3 overflow-x-auto rounded-md p-4 font-mono text-xs" {...props} />
  ),
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted/50" {...props} />,
  th: (props) => (
    <th
      className="border-border text-foreground border px-3 py-2 text-left text-sm font-semibold"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border-border text-foreground border px-3 py-2 text-sm" {...props} />
  ),
  hr: () => <hr className="border-border my-6" />,
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      className="text-primary underline-offset-4 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
