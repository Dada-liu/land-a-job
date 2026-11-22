-- 薪资来源：listing（招聘平台岗位卡片解析）/ jd（从 JD 正文抽）/ manual（人工填）。
-- 不做 NOT NULL / 默认值：历史数据来源未知，NULL 就代表"不知道当初是哪来的"，
-- 这种值在自动化覆盖时按最保守的方式处理（当作人工录入，不覆盖）。
ALTER TABLE job ADD COLUMN salary_source TEXT;
