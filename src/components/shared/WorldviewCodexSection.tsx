import type { ReactNode } from 'react'

export default function WorldviewCodexSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-5">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">📚 {title}</h3>
        <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}
