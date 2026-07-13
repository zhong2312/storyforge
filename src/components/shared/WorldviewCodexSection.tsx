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
    <section className="flex h-full min-h-0 flex-col gap-3 pb-2">
      <div className="shrink-0">
        <h3 className="text-sm font-semibold text-text-primary">📚 {title}</h3>
        <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
