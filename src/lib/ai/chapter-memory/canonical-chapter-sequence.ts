import type { Chapter, OutlineNode } from '../../types'

export interface ChapterSequenceAnomaly {
  kind:
    | 'orphan-outline-node'
    | 'outline-cycle'
    | 'duplicate-sibling-order'
    | 'duplicate-chapter-mapping'
    | 'chapter-without-outline'
  detail: string
}

export interface CanonicalChapterEntry {
  chapter: Chapter
  outlineNode: OutlineNode | null
  worldGroupId: number | null
}

export interface CanonicalChapterSequence {
  sequence: CanonicalChapterEntry[]
  anomalies: ChapterSequenceAnomaly[]
}

function byOrderThenId(a: OutlineNode, b: OutlineNode): number {
  return a.order - b.order || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER)
}

export function resolveCanonicalChapterSequence(
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
): CanonicalChapterSequence {
  const anomalies: ChapterSequenceAnomaly[] = []
  const nodes = [...outlineNodes].sort(byOrderThenId)
  const nodeById = new Map(nodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const children = new Map<number | null, OutlineNode[]>()

  for (const node of nodes) {
    const parentId = node.parentId ?? null
    if (parentId != null && !nodeById.has(parentId)) {
      anomalies.push({ kind: 'orphan-outline-node', detail: `outline ${node.id ?? '?'} parent ${parentId} missing` })
    }
    const effectiveParent = parentId != null && nodeById.has(parentId) ? parentId : null
    const list = children.get(effectiveParent) ?? []
    list.push(node)
    children.set(effectiveParent, list)
  }

  for (const [parentId, siblings] of children) {
    siblings.sort(byOrderThenId)
    const seenOrders = new Set<number>()
    for (const sibling of siblings) {
      if (seenOrders.has(sibling.order)) {
        anomalies.push({
          kind: 'duplicate-sibling-order',
          detail: `parent ${parentId ?? 'root'} has duplicate order ${sibling.order}`,
        })
      }
      seenOrders.add(sibling.order)
    }
  }

  const chaptersByOutline = new Map<number, Chapter[]>()
  const chaptersWithoutOutline: Chapter[] = []
  for (const chapter of chapters) {
    if (!nodeById.has(chapter.outlineNodeId)) {
      chaptersWithoutOutline.push(chapter)
      anomalies.push({
        kind: 'chapter-without-outline',
        detail: `chapter ${chapter.id ?? '?'} outline ${chapter.outlineNodeId} missing`,
      })
      continue
    }
    const list = chaptersByOutline.get(chapter.outlineNodeId) ?? []
    list.push(chapter)
    chaptersByOutline.set(chapter.outlineNodeId, list)
  }
  for (const [outlineNodeId, mapped] of chaptersByOutline) {
    mapped.sort((a, b) => (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER))
    if (mapped.length > 1) {
      anomalies.push({
        kind: 'duplicate-chapter-mapping',
        detail: `outline ${outlineNodeId} maps ${mapped.length} chapters; lowest id wins`,
      })
    }
  }

  const sequence: CanonicalChapterEntry[] = []
  const visited = new Set<number>()
  const visiting = new Set<number>()
  const visit = (node: OutlineNode, inheritedWorldGroupId: number | null) => {
    if (node.id == null) return
    if (visiting.has(node.id)) {
      anomalies.push({ kind: 'outline-cycle', detail: `cycle reaches outline ${node.id}` })
      return
    }
    if (visited.has(node.id)) return
    visiting.add(node.id)
    const worldGroupId = node.worldGroupId ?? inheritedWorldGroupId
    if (node.type === 'chapter') {
      const chapter = chaptersByOutline.get(node.id)?.[0]
      if (chapter) sequence.push({ chapter, outlineNode: node, worldGroupId })
    }
    for (const child of children.get(node.id) ?? []) visit(child, worldGroupId)
    visiting.delete(node.id)
    visited.add(node.id)
  }

  for (const root of children.get(null) ?? []) visit(root, root.worldGroupId ?? null)
  for (const node of nodes) if (node.id != null && !visited.has(node.id)) visit(node, node.worldGroupId ?? null)

  chaptersWithoutOutline
    .sort((a, b) => a.order - b.order || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER))
    .forEach(chapter => sequence.push({ chapter, outlineNode: null, worldGroupId: null }))

  return { sequence, anomalies }
}
