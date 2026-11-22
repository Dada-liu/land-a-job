-- 每年发薪月数（`23-45K·13薪` 里的 13）。
-- 只记月薪会低估总包：13 薪的 30K 其实是 39 万年包。
-- NULL 表示招聘页没写（按 12 理解），不默认填 12——"没写"和"写了 12"是两件事。
ALTER TABLE job ADD COLUMN salary_months INTEGER;
