/**
 * 旧数据迁移：把 resume-generator-2 的 `.resume-mcp/store.json` 导入本地库。
 *
 *   npm run import:legacy -w @land/server -- /path/to/store.json
 *
 * 设计取舍：
 * - 保留原始简历 id：旧投递记录、MCP 快照里引用的都是这个 id，改 id 等于断链。
 * - 已存在的 id 跳过而不是覆盖：这个脚本会被重复执行（换机器、补数据），
 *   静默覆盖会让人分不清「我改的」和「脚本写的」。
 * - 正文用 resume-kit 的 normalizeResumeData 规整：旧文件可能缺字段、
 *   用 summary 而不是 selfIntroduction，直接入库会在编辑器里显示空白。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeResumeData } from '@land/resume-kit/model'
import { DB_FILE } from '../src/config.js'
import { openDb } from '../src/db/index.js'
import { createResume, getResume } from '../src/db/repositories/resume.js'

interface LegacyDocument {
  id: string
  title: string
  templateId?: string
  data?: unknown
}

interface LegacyStore {
  resumes?: LegacyDocument[]
  activeResumeId?: string
}

const file = process.argv[2]
if (!file) {
  process.stderr.write('用法：npm run import:legacy -w @land/server -- /path/to/store.json\n')
  process.exit(1)
}

const storePath = path.resolve(process.cwd(), file)
const raw = await readFile(storePath, 'utf8')

let store: LegacyStore
try {
  store = JSON.parse(raw) as LegacyStore
} catch {
  process.stderr.write(`无法解析 ${storePath}：不是合法 JSON\n`)
  process.exit(1)
}

const documents = Array.isArray(store.resumes) ? store.resumes : []
if (documents.length === 0) {
  process.stderr.write('文件里没有 resumes 数组，可能是别的应用的导出文件\n')
  process.exit(1)
}

const db = openDb(DB_FILE)

let imported = 0
let skipped = 0
const failures: { id: string; reason: string }[] = []

for (const document of documents) {
  const id = String(document.id ?? '').trim()
  const title = String(document.title ?? '').trim() || '未命名简历'

  if (!id) {
    failures.push({ id: '(空)', reason: '缺少 id' })
    continue
  }

  try {
    getResume(db, id)
    skipped += 1
    continue
  } catch {
    // 不存在才继续，下面直接插入
  }

  try {
    createResume(db, {
      id,
      title,
      kind: 'master',
      templateId: document.templateId ?? 'classic',
      data: normalizeResumeData(document.data),
      isDefault: id === store.activeResumeId,
    })
    imported += 1
  } catch (error) {
    failures.push({ id, reason: error instanceof Error ? error.message : String(error) })
  }
}

process.stdout.write(
  `导入完成：新增 ${imported} 份，跳过 ${skipped} 份（已存在），失败 ${failures.length} 份\n`,
)
for (const failure of failures) {
  process.stdout.write(`  ✗ ${failure.id}：${failure.reason}\n`)
}
process.stdout.write(`数据文件：${DB_FILE}\n`)
