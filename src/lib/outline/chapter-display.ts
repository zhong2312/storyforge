import type { Chapter, OutlineNode } from '../types'

export interface ChapterDisplayMeta {
  title: string
  ordinal: number | null
}

export function resolveChapterDisplayMeta(
  chapter: Chapter,
  outlineNodes: OutlineNode[],
  _chapters: Chapter[],
): ChapterDisplayMeta {
  const outlineNode = outlineNodes.find(node => node.id === chapter.outlineNodeId) ?? null

  return {
    title: outlineNode?.title?.trim() || chapter.title,
    ordinal: outlineNode ? resolveOutlineChapterOrdinal(outlineNode, outlineNodes) : null,
  }
}

function byOrderThenId(a: OutlineNode, b: OutlineNode): number {
  return a.order - b.order || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER)
}

function resolveOutlineChapterOrdinal(target: OutlineNode, outlineNodes: OutlineNode[]): number | null {
  if (target.id == null || target.type !== 'chapter') return null

  const nodes = [...outlineNodes].sort(byOrderThenId)
  const nodeById = new Map(nodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const children = new Map<number | null, OutlineNode[]>()

  for (const node of nodes) {
    const parentId = node.parentId ?? null
    const effectiveParent = parentId != null && nodeById.has(parentId) ? parentId : null
    const list = children.get(effectiveParent) ?? []
    list.push(node)
    children.set(effectiveParent, list)
  }
  for (const siblings of children.values()) siblings.sort(byOrderThenId)

  let ordinal = 0
  const visited = new Set<number>()
  const visiting = new Set<number>()

  const visit = (node: OutlineNode): number | null => {
    if (node.id == null) return null
    if (visited.has(node.id) || visiting.has(node.id)) return null
    visiting.add(node.id)

    if (node.type === 'chapter') {
      ordinal += 1
      if (node.id === target.id) return ordinal
    }
    for (const child of children.get(node.id) ?? []) {
      const found = visit(child)
      if (found != null) return found
    }

    visiting.delete(node.id)
    visited.add(node.id)
    return null
  }

  for (const root of children.get(null) ?? []) {
    const found = visit(root)
    if (found != null) return found
  }
  for (const node of nodes) {
    const found = visit(node)
    if (found != null) return found
  }

  return null
}
