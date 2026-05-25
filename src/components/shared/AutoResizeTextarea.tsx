import { useRef, useEffect, useCallback, type TextareaHTMLAttributes } from 'react'

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  /** 最小行数 */
  minRows?: number
  /** 最大行数（超过后出现滚动条） */
  maxRows?: number
}

/**
 * 自适应高度的 textarea
 *
 * 随内容自动增长/收缩高度，到 maxRows 后显示滚动条。
 */
export default function AutoResizeTextarea({
  minRows = 2,
  maxRows = 20,
  value,
  onChange,
  className = '',
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 重置高度以获取 scrollHeight
    el.style.height = 'auto'
    // 计算行高
    const computed = getComputedStyle(el)
    const lineHeight = parseFloat(computed.lineHeight) || 20
    const paddingY = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom)
    const minH = lineHeight * minRows + paddingY
    const maxH = lineHeight * maxRows + paddingY
    const targetH = Math.min(maxH, Math.max(minH, el.scrollHeight))
    el.style.height = `${targetH}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [minRows, maxRows])

  // 值变化时重算
  useEffect(() => { resize() }, [value, resize])

  // 初始渲染
  useEffect(() => { resize() }, [resize])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={`resize-none ${className}`}
      {...rest}
    />
  )
}
