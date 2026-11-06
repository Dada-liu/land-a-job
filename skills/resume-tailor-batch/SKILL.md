---
name: resume-tailor-batch
version: 1.0.0
description: 批量定制简历并入待投：给库里还没有投递记录的岗位逐个按 JD 生成定制版简历、绑定岗位、进入待投（queued）。当用户说「把库里的岗位都定制一遍」「每个岗位配一份简历并放进待投」「批量进待投」时使用。
---

# 批量定制简历 + 进入待投

一次把「岗位 → 定制简历 → 待投投递」这条链补齐。
每个目标岗位最终应该恰好有：**一条 variant 简历 + 一条 `queued` 投递**，且两者指向同一个岗位。

批量不等于放松：`resume-tailor` 的不编造规则一条不减，落库必须带 `provenance`。

## 0. 前置检查（四个新 Skill 共有，必须最先做）

1. `get_app_status`：服务不可用时，在仓库根启动前后端再继续：
   - 前端产物不存在（`apps/web/dist/index.html` 缺失）先 `npm run build`；
   - 后台启动 `npm run dev`（server 4399 + vite 5173），或 `npm start`（4399 同时托管前端产物）；
   - 等 `curl --noproxy '*' http://127.0.0.1:4399/api/health` 正常返回再往下走。
2. `list_resumes`：库里必须有至少一份简历。一份都没有时：
   - 用 `workbuddy-browser-use` 打开本机浏览器，跳到创建简历界面
     `http://127.0.0.1:4399/resumes?create=1`（`npm run dev` 模式换成 `http://127.0.0.1:5173/resumes?create=1`）；
   - 告诉用户「先建第一份母版简历，建好回我一声」，**停下来等**，不要代填、不要编造经历；
   - 用户回来后重新 `list_resumes` 确认确实落库，再进入本 Skill 第 1 步。
3. `get_app_status` 里任一 Skill `compatible: false`：先让用户跑 `npm run skills:install` 并重启 Agent。
4. 简历相关追问以各 Skill 正文为准：要求「基于哪份母简历」的流程，用户没指定就必须先问，不要默认拿第一份。

## 1. 必问项与取数

**用户没指定母简历就先问**：`list_resumes` 带 `kind: "master"` 列候选，问「这次用哪份母简历？」，等回答。
所有定制都从这一份出发，不拿别的定制版当母版、不改母版本身。

一次取够，别逐个岗位摸索：

- `list_jobs` 带 `limit: 200` → 全部岗位摘要
- `list_applications` 带 `limit: 200` → 已有投递的 jobId 集合
- `list_resumes` 带 `limit: 200` → 已有 variant 与它们的 jobId，用于幂等

## 2. 圈定目标岗位

目标集合 = 同时满足三条的岗位：

1. `status` 为 `open`；
2. **没有任何投递记录**（不论状态）——已经进过待投 / 已投 / 已结束的都不再处理；
3. 有 JD 正文：用 `get_job` 读全文，`jdText` 为空或短到明显不是正文的跳过。

不满足的都要在最终汇报里**逐条列原因**，尤其是「没有 JD 正文」的：不能用岗位标题当 JD 定制简历，
交给 `jd-collect` 补正文后再跑一轮本 Skill。

先把目标清单（公司 · 岗位 · 有无 JD）给用户看一眼；**超过 20 条时先等一句确认**再批量执行，
20 条以内可以直接开工。执行过程中不再逐条问。

## 3. 逐岗位执行（顺序固定）

对每条目标岗位：

1. `get_job` → 读 JD 全文、`channel`、fit 因子。
2. 幂等检查：`list_resumes` 带该 jobId 若已有 variant，**复用它**，不要再造第二份。
3. `tailor_resume`（`baseId` = 母版 id，`jobId` = 本岗位）→ 拿到 `plan` 与 `variantId`（已绑定到该岗位）。
4. 按 `plan` 改正文，只允许四件事：**重排 / 重述 / 突出 / 删冗余**。
   `plan.gap` 里 `blocking` 的项如实留白，不把没做过的技术写进技能列表。
5. `update_resume` 落到 `variantId`，带
   `provenance: { skill: "resume-tailor-batch", skillVersion: "1.0.0" }`。
   服务端会校验是否新增条目或改动公司 / 在职时间 / 学历，被拒就按拒因重改，不要绕过校验。
6. `create_application`：`jobId`、`resumeId` = `variantId`、`status: "queued"`、`channel` 取岗位的渠道。
   **不要传 `appliedAt`**：待投还没投出去，写了会被漏斗算成「已投」。
7. `get_application` 复核：`status` 是 `queued`、`resumeId` 是刚生成的 variant、`appliedAt` 为空。

单条失败（抓取不到正文、`update_resume` 被拒、409 已有投递）**记录原因后继续下一条**，
不要中断整批、也不要回滚已成功的岗位。409 说明状态在两轮取数之间变了，按「已有投递」跳过即可。

## 4. 收尾复核

- `list_applications` 带 `status: "queued"`：确认新增条数与成功数一致。
- `list_resumes` 带 `kind: "variant"`：确认新 variant 数、每条都有 `jobId` 与 `baseResumeId`。
- 汇报四个数字：**处理成功 / 跳过（含原因）/ 失败（含原因）/ 复核后待投总数**。

## 5. 产出契约

- 每个成功岗位：一条 variant（带 `provenance`）+ 一条 `queued` 投递，两者都指向该岗位。
- 不在对话里贴一堆改写后的简历正文；交付物是数据库里的记录，用 id 和 Web 链接指给用户。
- 未完成的那部分必须明确说「没做」，不能把「跳过」说成「已完成」。

## 6. 确认点

- 母简历未指定：必须停下来问。
- 目标岗位 > 20 条：先确认清单。
- 改写幅度超过一半条目：把改动清单给用户看再落库（与 `resume-tailor` 同规则）。

## 7. 禁止

- 禁止新增经历 / 项目 / 学历条目，禁止改公司名、在职时间、职级、学校、学位，禁止虚构数字。
- 禁止改母版简历，禁止从别的 variant 复制当母版，禁止给同一岗位造两份 variant。
- 禁止给没有 JD 正文的岗位定制，禁止把 `plan.gap` 里的技术直接写进简历。
- 禁止把投递建成 `applied` 或写 `appliedAt`；本 Skill 只做到「待投」。
- 禁止顺手 `submit_application`、发投递、改别的状态；投递是用户或 `browser-apply` 的事。

参考：`references/batch-rules.md`（幂等、失败分类、状态机与口径）。
