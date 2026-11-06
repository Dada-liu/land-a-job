import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * JD 快照落到 files/jd/<jobId>.html。
 *
 * 岗位随时可能下线或改版，正文文本又会被人工编辑覆盖，所以保留原始 HTML；
 * 重抓之前把上一份留成 <jobId>.prev.html —— 至少能回答「上周这份 JD 写的是不是这些要求」。
 */
export async function saveJdSnapshot(filesDir: string, jobId: string, html: string): Promise<string> {
  const dir = path.join(filesDir, 'jd')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${jobId}.html`)
  try {
    await copyFile(file, path.join(dir, `${jobId}.prev.html`))
  } catch {
    // 首次抓取没有旧快照，正常
  }
  await writeFile(file, html, 'utf8')
  return file
}
