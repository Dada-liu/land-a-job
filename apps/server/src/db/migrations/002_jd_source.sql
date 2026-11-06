-- 采集来源：回答「这份 JD 是怎么进来的」（官方 ATS / 通用 HTTP / Agent 浏览器 / 人工粘贴）。
-- 不做 NOT NULL / 默认值：历史数据没有这个字段，NULL 表示「重构前录入，来源未知」。
ALTER TABLE job ADD COLUMN jd_source TEXT;
