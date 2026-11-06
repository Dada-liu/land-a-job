---
name: resume-tailor
version: 1.0.0
description: 按 JD 定制简历：重排重述突出已有证据，绝不编造。当用户说「帮我按这个 JD 改简历」「这版简历投这个岗位合适吗」「简历怎么改命中率更高」时使用。
---

# 简历定制

你的任务只有一个：**用同一份事实，换一种更贴合 JD 的讲法**。

不是把简历写得更漂亮，而是让招聘方在 10 秒扫读时看到他要的关键词与证据。

## 0. 前置检查

1. `get_app_status` 确认服务可用、Skill 版本兼容。
2. 确认目标岗位：用户没说就用 `get_job` 从上下文里找；找到后读 JD 全文，不要只看标题。

## 1. 取数

1. `get_job` → JD 全文、关键词、fit 因子与分数
2. `list_resumes` + `kind: "master"` → 找到母版（改简历永远从母版出发，不能改别人的定制版）
3. `get_resume` → 完整正文与条目 id

## 2. 步骤

1. `tailor_resume`（`baseId` = 母版 id，`jobId`）→ 返回：
   - `plan.summaryHints`：摘要里该出现的词（**全部来自简历已有证据**）
   - `plan.reorderProjects` / `plan.reorderSkills`：按 JD 相关度给的展示顺序
   - `plan.gap`：JD 要求但简历没有的项（`severity` = `blocking` / `important` / `nice`）
   - `variantId`：已复制出来的定制版骨架
2. 按 `plan` 改写。允许做的只有四件：
   - **重排**：项目、技能按 `plan` 顺序
   - **重述**：把已有职责改写成贴 JD 的说法（同一件事换词，不换事实）
   - **突出**：把与 JD 相关的部分提到句首、写具体
   - **删除冗余**：与这个 JD 无关的内容可以压缩
3. `update_resume`（`id` = `variantId`，带 `provenance`）落库
4. 需要 PDF 时 `export_resume_pdf`
5. `create_application` 时把 `resumeId` 指到这个 variant——否则「哪版简历带来面试」统计不到

## 3. 产出契约

- 必须产生一条新简历：`kind = "variant"`，`baseResumeId` 指向母版。
- 落库必须带 `provenance`：`{ skill: "resume-tailor", skillVersion: "1.0.0" }`。
- 汇报时给出三样：命中率（`plan.match.ratio`）、最该补的缺口（`gap` 里 `blocking` 的前 2 条）、改了哪几处。
- 每条 `gap` 都要给用户一个**可执行**的选择：要么补证据（具体到哪段经历加一句什么），要么如实留白。

## 4. 确认点

- 改写幅度大（超过一半条目被重写）时，先把改动清单给用户看再落库。
- 用户要求「把没做过的也写上」时：拒绝，并给出替代方案（放大相邻经验、把缺口记下来准备面试说法）。

## 5. 禁止

- **禁止新增经历、项目、学历条目。** 条目数量变了就是编造，服务端会拒绝写入。
- **禁止修改公司名、在职时间、职级、学校、学位。** 这些是最容易被背景调查抓到的地方。
- **禁止虚构数字。** 「提升 30%」只能来自用户给过的事实；没有就写「显著提升」而不是编一个百分比。
- 禁止把 `gap` 里的技术直接写进技能列表。没做过就是没做过。

参考：`references/tailoring-rules.md`（可改/不可改清单）、`references/gap-classification.md`（缺口怎么分级、怎么补）
