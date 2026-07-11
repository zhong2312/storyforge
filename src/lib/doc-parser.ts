/**
 * 多格式文档文本抽取器
 *
 * 2026-05-11 增加 — 支持 txt / md / csv / pdf / docx 五种格式。
 * .doc（Word 97-2003 二进制格式）mammoth 不支持，会抛明确错误提示用户转成 .docx。
 *
 * 所有大小限制是「本地文件大小上限」，与 AI 一次处理能力无关——
 * AI 解析阶段仍会被 import-adapter 的 MAX_CHARS 再截断一次。
 */
// Vite URL import — pdfjs 的 worker 必须走 URL 引入（仅 URL 字符串，不进主包）
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

// pdfjs / mammoth 体积大（~870KB）且仅在用户导入文件时才需要，改为动态导入按需加载，
// 不进首屏主包。下面在解析函数内 await import。

/** 各文件类型的本地大小限制（单位字节） */
export const FILE_SIZE_LIMITS = {
  txt:  5 * 1024 * 1024,  // 5 MB —— 纯文本，理论可更大，但粘进 textarea 浏览器会卡
  md:   5 * 1024 * 1024,  // 5 MB
  csv:  2 * 1024 * 1024,  // 2 MB
  pdf: 20 * 1024 * 1024,  // 20 MB —— pdfjs 能吃更大，但 20M 以上浏览器内抽文本很慢
  docx: 10 * 1024 * 1024, // 10 MB
} as const

export type SupportedExt = keyof typeof FILE_SIZE_LIMITS

/** 列表里面明确告诉用户 `.doc` 不行 */
export const UNSUPPORTED_EXTS = ['doc'] as const

export const ZIP_MAX_COMPRESSED_BYTES = 100 * 1024 * 1024
export const ZIP_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024
export const ZIP_MAX_ENTRIES = 1000

/** 浏览器 <input accept> 字符串 */
export const ACCEPT_ATTR = '.txt,.md,.csv,.pdf,.docx,.zip'

/** 人类可读的大小说明（给 UI 用） */
export const FILE_LIMIT_HINTS: Array<{ ext: string; label: string; mb: number }> = [
  { ext: 'txt',  label: '纯文本',   mb: FILE_SIZE_LIMITS.txt  / 1024 / 1024 },
  { ext: 'md',   label: 'Markdown', mb: FILE_SIZE_LIMITS.md   / 1024 / 1024 },
  { ext: 'csv',  label: 'CSV',      mb: FILE_SIZE_LIMITS.csv  / 1024 / 1024 },
  { ext: 'pdf',  label: 'PDF',      mb: FILE_SIZE_LIMITS.pdf  / 1024 / 1024 },
  { ext: 'docx', label: 'Word',     mb: FILE_SIZE_LIMITS.docx / 1024 / 1024 },
  { ext: 'zip',  label: '多文档包', mb: ZIP_MAX_COMPRESSED_BYTES / 1024 / 1024 },
]

export interface ExtractResult {
  text: string
  /** 源文件字符数（未截断） */
  rawChars: number
  /** 对于 PDF 会返回页数；docx 返回 undefined */
  pageCount?: number
  /** ZIP 内成功解析的文档数量；普通文件不返回。 */
  fileCount?: number
  /** ZIP 内被忽略或解析失败的路径及原因。 */
  skippedFiles?: string[]
}

/** 统一入口：给一个 File，返回提取到的纯文本 */
export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  const extRaw = file.name.split('.').pop()?.toLowerCase() || ''

  if (extRaw === 'zip') return extractZip(file)

  // 明确不支持的
  if ((UNSUPPORTED_EXTS as readonly string[]).includes(extRaw)) {
    throw new Error(
      `.${extRaw} 是 Word 97-2003 二进制格式，纯前端无法解析。` +
      `请用 Word / WPS 另存为 .docx 后再上传。`,
    )
  }

  // 不认识的
  if (!(extRaw in FILE_SIZE_LIMITS)) {
    throw new Error(
      `不支持的文件格式：.${extRaw}。当前支持：${ACCEPT_ATTR}`,
    )
  }

  const ext = extRaw as SupportedExt
  const limit = FILE_SIZE_LIMITS[ext]
  if (file.size > limit) {
    const limitMB = (limit / 1024 / 1024).toFixed(1)
    const actualMB = (file.size / 1024 / 1024).toFixed(2)
    throw new Error(
      `.${ext} 文件最大 ${limitMB} MB，当前 ${actualMB} MB。` +
      `请先压缩或只截取需要的部分。`,
    )
  }

  switch (ext) {
    case 'txt':
    case 'md':
    case 'csv': {
      const text = await file.text()
      return { text, rawChars: text.length }
    }
    case 'pdf':  return extractPdf(file)
    case 'docx': return extractDocx(file)
  }
}

async function extractZip(file: File): Promise<ExtractResult> {
  if (file.size > ZIP_MAX_COMPRESSED_BYTES) {
    throw new Error(`.zip 文件最大 ${ZIP_MAX_COMPRESSED_BYTES / 1024 / 1024} MB，当前 ${(file.size / 1024 / 1024).toFixed(2)} MB。`)
  }
  const JSZip = (await import('jszip')).default
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const entries = Object.values(archive.files)
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP 条目过多：${entries.length} 个，最多支持 ${ZIP_MAX_ENTRIES} 个。`)
  }

  const supported = entries
    .filter(entry => !entry.dir && !isArchiveJunkPath(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))
  const sections: string[] = []
  const skippedFiles: string[] = []
  let extractedBytes = 0
  let pageCount = 0

  let declaredExtractedBytes = 0
  for (const entry of supported) {
    const ext = entry.name.split('.').pop()?.toLowerCase() || ''
    if (!(ext in FILE_SIZE_LIMITS)) continue
    const declaredSize = zipEntryUncompressedSize(entry)
    if (declaredSize == null) throw new Error(`无法确认 ZIP 条目解压大小：${entry.name}`)
    declaredExtractedBytes += declaredSize
    if (declaredExtractedBytes > ZIP_MAX_EXTRACTED_BYTES) {
      throw new Error(`ZIP 解压后的支持文档超过 ${ZIP_MAX_EXTRACTED_BYTES / 1024 / 1024} MB，请拆分压缩包后重试。`)
    }
  }

  for (const entry of supported) {
    const ext = entry.name.split('.').pop()?.toLowerCase() || ''
    if (!(ext in FILE_SIZE_LIMITS)) {
      skippedFiles.push(`${entry.name}（不支持 .${ext || '无扩展名'}）`)
      continue
    }
    const declaredSize = zipEntryUncompressedSize(entry)!
    const fileLimit = FILE_SIZE_LIMITS[ext as SupportedExt]
    if (declaredSize > fileLimit) {
      skippedFiles.push(`${entry.name}（.${ext} 文件最大 ${fileLimit / 1024 / 1024} MB）`)
      continue
    }
    const bytes = await entry.async('uint8array')
    extractedBytes += bytes.byteLength
    if (extractedBytes > ZIP_MAX_EXTRACTED_BYTES) {
      throw new Error(`ZIP 解压后的支持文档超过 ${ZIP_MAX_EXTRACTED_BYTES / 1024 / 1024} MB，请拆分压缩包后重试。`)
    }
    try {
      const nestedFile = new File([new Uint8Array(bytes).buffer], entry.name, { type: archiveMimeType(ext) })
      const result = await extractTextFromFile(nestedFile)
      if (!result.text.trim()) {
        skippedFiles.push(`${entry.name}（未提取到文本）`)
        continue
      }
      sections.push(`===== 文件：${entry.name} =====\n\n${result.text.trim()}`)
      pageCount += result.pageCount ?? 0
    } catch (error) {
      skippedFiles.push(`${entry.name}（${error instanceof Error ? error.message : String(error)}）`)
    }
  }

  if (sections.length === 0) {
    const detail = skippedFiles.length ? `\n${skippedFiles.slice(0, 5).join('\n')}` : ''
    throw new Error(`ZIP 中没有可解析的文档。支持：${Object.keys(FILE_SIZE_LIMITS).map(ext => `.${ext}`).join('、')}${detail}`)
  }
  const text = sections.join('\n\n')
  return {
    text,
    rawChars: text.length,
    fileCount: sections.length,
    skippedFiles,
    pageCount: pageCount || undefined,
  }
}

function zipEntryUncompressedSize(entry: unknown): number | null {
  if (!entry || typeof entry !== 'object') return null
  const data = Reflect.get(entry, '_data')
  if (!data || typeof data !== 'object') return null
  const value = Reflect.get(data, 'uncompressedSize')
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function isArchiveJunkPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.startsWith('__MACOSX/')
    || normalized.split('/').some(segment => segment === '.DS_Store' || segment === 'Thumbs.db')
}

function archiveMimeType(ext: string): string {
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'md') return 'text/markdown'
  return 'text/plain'
}

async function extractPdf(file: File): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const line = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ')
    pages.push(line)
  }
  const text = pages.join('\n\n')
  return { text, rawChars: text.length, pageCount: pdf.numPages }
}

async function extractDocx(file: File): Promise<ExtractResult> {
  const mammoth = (await import('mammoth')).default
  const buf = await file.arrayBuffer()
  // mammoth.extractRawText 返回纯文本（不带样式）
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
  return { text: value, rawChars: value.length }
}
