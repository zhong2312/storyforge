import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { ACCEPT_ATTR, extractTextFromFile } from '../../src/lib/doc-parser'

async function zipFile(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) zip.file(path, content)
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new File([new Uint8Array(bytes).buffer], '小说资料.zip', { type: 'application/zip' })
}

describe('ZIP 多级目录文档解析', () => {
  it('递归遍历多级目录，按自然路径顺序合并所有支持文档', async () => {
    const file = await zipFile({
      '第一卷/第10章.md': '# 第十章\n后发生',
      '第一卷/第2章.txt': '先发生',
      '设定/角色/主角.csv': '姓名,林川',
      '__MACOSX/._第2章.txt': '系统垃圾',
      '图片/封面.png': 'not-an-image',
      '.DS_Store': 'junk',
    })

    const result = await extractTextFromFile(file)

    expect(ACCEPT_ATTR).toContain('.zip')
    expect(result.fileCount).toBe(3)
    expect(result.text).toContain('===== 文件：第一卷/第2章.txt =====')
    expect(result.text).toContain('===== 文件：第一卷/第10章.md =====')
    expect(result.text.indexOf('第2章.txt')).toBeLessThan(result.text.indexOf('第10章.md'))
    expect(result.text).toContain('===== 文件：设定/角色/主角.csv =====')
    expect(result.text).not.toContain('系统垃圾')
    expect(result.skippedFiles).toEqual(['图片/封面.png（不支持 .png）'])
  })

  it('压缩包没有支持文档时给出明确错误', async () => {
    const file = await zipFile({ '图片/封面.png': 'x', '资料/readme.exe': 'x' })
    await expect(extractTextFromFile(file)).rejects.toThrow('ZIP 中没有可解析的文档')
  })
})
