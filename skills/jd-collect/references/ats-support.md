# 已适配的招聘服务商

服务端按链接形态选择适配器，全部是**匿名公开接口**：不带 cookie、不带 token、不绕验证码。
接口失败会自动降级到通用网页抓取，再失败才轮到浏览器兜底。端点形状来自 job-pro 在 2026-05~07 的实测记录。

## 官方 ATS（四家）

| 服务商 | 识别特征 | 正文来源 |
| --- | --- | --- |
| Greenhouse | `boards.greenhouse.io/<slug>/jobs/<id>` | 公开 JSON 接口，返回岗位描述 HTML |
| Lever | `jobs.lever.co/<slug>/<id>` | 公开 JSON 接口，拼 description + lists + additional |
| 飞书招聘 | `*.jobs.feishu.cn/<channel>/position/<id>/detail` | 按 id 详情接口，或公开搜索列表里按 id 找 |
| 北森云 | `*.zhiye.com/{campus,social,intern}/detail?jobAdId=<id>` 或 `/{SU…}/pb/<channel>.html#/postDetail?postId=<id>` | iTalent 翻公开列表；Wecruit 有真正的详情接口 |

### 飞书招聘

域名家族：标准子域 `*.jobs.feishu.cn`、小米 fork `*.jobs.f.mioffice.cn`、自建域 `careers.iqiyi.com` 与 `hr.sensetime.com`。
链接里的 `<channel>` 是门户标识，可能是 campus、index、公司编号（如 379481），也可能整个缺省（根门户）。

```
GET  https://<host>/api/v1/job/posts/<id>?portal_type=3
POST https://<host>/api/v1/search/job/posts
请求头 portal-channel / website-path = 链接里的 channel；portal-platform = pc
搜索体 keyword="" limit=100 offset=0 portal_type=3 portal_entrance=1 language="zh"
响应 code=0，data 里是岗位数组与总数
```

坑：不是每个租户都有按 id 的详情接口；没有时只能翻公开搜索列表。部分自建域（爱奇艺、小米、莉莉丝）**不能带** portal-channel，否则拿不到全租户数据。适配器会按「标准头 → 空门户 → 省略头」依次试，最多几页，找不到就降级。
岗位正文由「职位描述」与「任职要求」两段拼成。

### 北森云（两套产品）

**iTalent**（`*.zhiye.com`、`hr-campus.vivo.com`）：没有按 id 的 JSON 详情接口，翻公开列表。

```
POST https://<host>/api/Jobad/GetJobAdPageList
Content-Type: application/json；x-requested-with: xmlhttprequest；langtype: zh_CN
{ PageIndex: 0, PageSize: 50, KeyWords: "", SpecialType: 0, PortalId: "",
  DisplayFields: ["Category","Kind","LocId","Org","HeadCount","PostDate","Salary","Duty","Require"] }
响应 Code=200，Data 是岗位数组，Count 是总数
```
正文取 Duty（职责）+ Require（要求）。自建门户可能需要显式 PortalId，适配器会依次试。

**Wecruit / 招聘云**（`wecruit.hotjob.cn` 等）：SPA 的 hash 路由，岗位编号在 `postId` 参数里。

```
POST https://<host>/wecruit/positionInfo/listPositionDetail/{SU…}
     ?iSaJAx=isAjax&request_locale=zh_CN&t=<毫秒>
Content-Type: application/x-www-form-urlencoded；X-Requested-With: XMLHttpRequest
postId=<id>&recruitType=<1 校园 | 2 社招>
响应 state=200 时 data 里有 workContent（主要职责）与 serviceCondition（任职要求）
```
注意：`/{SU…}/pb/*.html` 是页面路径，不是接口，POST 它会返回 405；接口在 `/wecruit/positionInfo/` 下。state 1017 表示岗位已关闭。

## 公司自建 ATS（只给列表页时先试接口）

用户递来的是「招聘列表页」而不是详情页时，先看这家有没有公开列表接口 —— 一次就能拿到全量岗位 + 完整正文：

| 公司 | 列表接口（都要带 Referer） | 备注 |
| --- | --- | --- |
| 滴滴 | `GET https://talent.didiglobal.com/recruit-portal-service/api/job/front/list?page=1&size=100`，Referer `https://talent.didiglobal.com/social` | `items[]` 自带 `jobDuty`+`jobQualification`；详情页 `talent.didiglobal.com/social/p/<jdId>` 是纯 SPA，`add_job` 抓不到 |
| 小米 | `GET https://hr.xiaomi.com/website/api/agent/searchJobPage?keyword=<kw>&pageSize=50&pageNum=1`，Referer `https://hr.xiaomi.com/website/opportunities.html` | `list[]` 自带 `description`+`requirement`；详情页在飞书 `xiaomi.jobs.f.mioffice.cn/index/position/<feishuId>/detail`，接口 id ≠ 飞书 id，要回列表页 DOM 抠 `<a href>` 对上标题 |

列表页本身**不能当 `jdUrl` 入库**：按岗位取出详情页链接再 `add_job`，正文用接口返回的那段 `import_jd`。

## 没适配时怎么办

- 公司官网或普通网页：通用 HTTP + 正文提取；403 会先读 robots.txt 再决定是否换请求头。
- 招聘平台（BOSS 直聘、拉勾、猎聘、智联、前程无忧）：只做一次短尝试，失败即按 `browser-fallback.md` 走浏览器或人工粘贴。
- 未验证域名：结果里会带核对提醒，别把它写成「来源已确认」。
