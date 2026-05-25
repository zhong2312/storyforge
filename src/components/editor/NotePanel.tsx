/**
 * 便签面板 — Phase H3
 *
 * 编辑器侧边可展开的便签列表
 */
import { useState, useEffect } from 'react'
import { Plus, Pin, Trash2, X } from 'lucide-react'
import { useNoteStore } from '../../stores/note'
import { NOTE_COLORS, type NoteColor } from '../../lib/types/note'

interface Props {
  projectId: number
  chapterId?: number
  onClose: () => void
}

export default function NotePanel({ projectId, chapterId, onClose }: Props) {
  const { notes, loadAll, addNote, updateNote, deleteNote, togglePin, getChapterNotes, getGlobalNotes } = useNoteStore()
  const [filter, setFilter] = useState<'all' | 'chapter' | 'global'>('all')

  useEffect(() => {
    loadAll(projectId)
  }, [projectId, loadAll])

  const filteredNotes = filter === 'chapter' && chapterId
    ? getChapterNotes(chapterId)
    : filter === 'global'
      ? getGlobalNotes()
      : notes

  const handleAdd = async () => {
    await addNote(projectId, '', filter === 'chapter' ? chapterId : undefined)
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">📝 便签</h3>
        <div className="flex items-center gap-2">
          <button onClick={handleAdd}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors">
            <Plus className="w-3 h-3" /> 新便签
          </button>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 过滤标签 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
        {(['all', 'chapter', 'global'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${
              filter === f ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {f === 'all' ? '全部' : f === 'chapter' ? '本章' : '通用'}
          </button>
        ))}
        <span className="text-[10px] text-text-muted ml-auto">{filteredNotes.length} 条</span>
      </div>

      {/* 便签列表 */}
      <div className="p-3 space-y-2 max-h-[50vh] overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs">
            暂无便签，点击「新便签」创建
          </div>
        ) : (
          filteredNotes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={(data) => updateNote(note.id!, data)}
              onDelete={() => deleteNote(note.id!)}
              onTogglePin={() => togglePin(note.id!)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function NoteCard({ note, onUpdate, onDelete, onTogglePin }: {
  note: { id?: number; content: string; color: NoteColor; pinned: boolean; chapterId?: number }
  onUpdate: (data: Record<string, unknown>) => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  const colorStyle = NOTE_COLORS[note.color] || NOTE_COLORS.yellow

  return (
    <div className={`rounded-lg p-3 ${colorStyle.bg} ${colorStyle.text} transition-all`}>
      <div className="flex items-start gap-2">
        <textarea
          value={note.content}
          onChange={e => onUpdate({ content: e.target.value })}
          placeholder="写点什么..."
          rows={2}
          className={`flex-1 bg-transparent resize-none outline-none text-xs ${colorStyle.text} placeholder:opacity-50`}
        />
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={onTogglePin}
            className={`p-1 rounded transition-colors ${note.pinned ? 'text-accent' : 'opacity-40 hover:opacity-100'}`}
            title={note.pinned ? '取消置顶' : '置顶'}>
            <Pin className="w-3 h-3" />
          </button>
          <button onClick={onDelete}
            className="p-1 opacity-40 hover:opacity-100 rounded transition-colors"
            title="删除">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {/* 颜色选择 */}
      <div className="flex items-center gap-1 mt-2">
        {(Object.keys(NOTE_COLORS) as NoteColor[]).map(color => (
          <button
            key={color}
            onClick={() => onUpdate({ color })}
            className={`w-4 h-4 rounded-full border-2 transition-all ${
              note.color === color ? 'border-current scale-110' : 'border-transparent opacity-50 hover:opacity-100'
            }`}
            style={{ backgroundColor: color === 'yellow' ? '#fef08a' : color === 'blue' ? '#bfdbfe' : color === 'green' ? '#bbf7d0' : color === 'pink' ? '#fbcfe8' : color === 'purple' ? '#e9d5ff' : '#fed7aa' }}
          />
        ))}
        {note.chapterId && (
          <span className="text-[10px] opacity-60 ml-auto">📌 章节便签</span>
        )}
      </div>
    </div>
  )
}
