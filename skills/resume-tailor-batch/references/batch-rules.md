# 批量定制与入队规则

## 口径：什么叫「还没进入待投」

「待投」是**投递记录的状态** `queued`，不是岗位状态。岗位表里只有 `open` / `paused` / `closed`。
所以判断依据是 `list_applications` 里有没有这条 jobId 的记录，而不是看岗位列表。

| 情况 | 处理 |
| --- | --- |
| 岗位无任何投递记录 | 目标岗位，定制 + 建 `queued` |
| 已有 `queued` 记录（绑定简历或没绑） | 跳过，不重复定制；要换简历请用户先在看板改 |
| 已有 `applied` 及以后、或已到终态 | 跳过 |
| 岗位 `paused` / `closed` | 跳过并列出，不给已关闭岗位做简历 |
| 岗位没有 JD 正文 | 跳过并列出，交 `jd-collect` 补正文后重跑 |

## 幂等：重跑一遍不会翻倍

1. 每轮开始都重新 `list_jobs` / `list_applications` / `list_resumes`。
2. 同一 jobId 已有 variant → 复用其 id，不再 `tailor_resume`。
3. `create_application` 命中同岗位活跃投递会返回 409 CONFLICT（带已有 id）：按跳过处理，不建第二条。
4. `update_resume` 只针对本轮新建或复用的 variant，不动其它简历。

## 状态机与漏斗口径

状态机（`packages/core/src/application.ts`）里 `queued` 只能到 `applied` / `withdrawn`。
本 Skill 建的就是 `queued`，**绝不能带 `appliedAt`**：漏斗把「有 `appliedAt` 但状态是 lead/queued」的历史数据
也算作「投过」，一旦误写，北极星与本周已投数会凭空多出一批。MCP 的 `create_application` 已按状态决定是否注入时间，
复核时用 `get_application` 看 `appliedAt` 是否为空。

改状态一律走 `update_application_status`（内部是 `POST /applications/:id/status`），
不要用任何 PATCH 直接改 `status`，否则事件与时间线会漏写。

## 失败分类（都要进最终汇报）

| 类别 | 典型原因 | 处理 |
| --- | --- | --- |
| 缺正文 | `get_job` 里 JD 为空 | 跳过；列进「待补 JD」，建议 `jd-collect` |
| 定制被拒 | `update_resume` 报新增条目 / 改了公司或时间 | 按拒因重改，禁止绕过校验 |
| 抓取/打分异常 | `get_job` 读到的关键词为空 | 不影响定制，记一句提醒 |
| 冲突 | `create_application` 409 | 视为已有投递，跳过 |
| 其它工具错误 | 服务重启、超时 | 重取一次状态后继续下一条，不中断整批 |

## provenance 口径

`update_resume` 必须带 `{ skill: "resume-tailor-batch", skillVersion: "1.0.0" }`。
这个 skill 名登记在 `SKILL_REGISTRY`，Web 的「来源」筛选才能把本批 variant 和 `resume-tailor` 单份定制区分开；
不写会被服务端拒绝，写了别的 skill 名同样被拒。`tailor_resume` 与 `create_application` 本身不需要 provenance。

## 为什么不顺手投递

「待投」是让人再核对一次简历与 JD 的缓冲区。批量生成几十份简历再一键全投，出错时没有回头路。
真正提交由用户在 Web 的「直接投递」或 `browser-apply` 完成，且最后一步必须留给人。
