import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import RichEditor from '../../src/components/editor/RichEditor'

describe('章节编辑器字数实时同步', () => {
  const containers: HTMLDivElement[] = []

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    containers.splice(0).forEach(container => container.remove())
  })

  it('外部恢复正文后立即按受控 value 更新工具栏字数', async () => {
    const container = document.createElement('div')
    containers.push(container)
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<RichEditor value="<p>第二版测试正文。山门外风雨已至，钟声穿过云海。</p>" onChange={() => {}} />)
    })
    expect(container.querySelector('[title="本章正文字数（不含空白）"]')?.textContent?.trim()).toBe('23 字')

    await act(async () => {
      root.render(<RichEditor value="<p>第一版测试正文。山门外风雨将至。</p>" onChange={() => {}} />)
    })
    expect(container.querySelector('[title="本章正文字数（不含空白）"]')?.textContent?.trim()).toBe('16 字')

    await act(async () => root.unmount())
  })
})
