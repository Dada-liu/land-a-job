-- 001_init：Land a Job 初始 schema
-- 约定：主键 TEXT（uuid），时间 ISO8601 字符串，软删除 deleted_at IS NULL 表示未删。
-- 注意：PRAGMA journal_mode / foreign_keys 在 db/index.ts 中设置，此处不要重复（事务内无法切换 WAL）。

CREATE TABLE company (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  website       TEXT,
  industry      TEXT,
  size          TEXT,
  city          TEXT,
  priority      INTEGER NOT NULL DEFAULT 3,
  apply_entry   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_company_name ON company(name) WHERE deleted_at IS NULL;

CREATE TABLE job (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES company(id),
  title             TEXT NOT NULL,
  jd_text           TEXT,
  jd_url            TEXT,
  jd_snapshot       TEXT,
  channel           TEXT NOT NULL DEFAULT 'official',
  city              TEXT,
  salary_min        INTEGER,
  salary_max        INTEGER,
  level             TEXT,
  keywords_json     TEXT,
  fit_score         INTEGER,
  fit_reasons_json  TEXT,
  fit_source        TEXT NOT NULL DEFAULT 'rule',
  status            TEXT NOT NULL DEFAULT 'open',
  priority          INTEGER NOT NULL DEFAULT 3,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX ix_job_company ON job(company_id);
CREATE INDEX ix_job_fit ON job(fit_score DESC);

CREATE TABLE resume (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'master',
  template_id     TEXT NOT NULL DEFAULT 'classic',
  data_json       TEXT NOT NULL,
  base_resume_id  TEXT REFERENCES resume(id),
  job_id          TEXT REFERENCES job(id),
  is_default      INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX ix_resume_job ON resume(job_id);

CREATE TABLE application (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES job(id),
  resume_id       TEXT REFERENCES resume(id),
  status          TEXT NOT NULL DEFAULT 'queued',
  channel         TEXT NOT NULL DEFAULT 'official',
  applied_at      TEXT,
  status_at       TEXT NOT NULL,
  contact         TEXT,
  next_action_at  TEXT,
  evidence_json   TEXT,
  confidence      TEXT NOT NULL DEFAULT 'reported',
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE UNIQUE INDEX ux_app_active ON application(job_id)
  WHERE deleted_at IS NULL AND status NOT IN ('rejected', 'ghosted', 'withdrawn', 'accepted');
CREATE INDEX ix_app_status ON application(status, status_at);

CREATE TABLE application_event (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES application(id),
  type            TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT,
  payload_json    TEXT,
  actor           TEXT NOT NULL DEFAULT 'user',
  source          TEXT NOT NULL DEFAULT 'web',
  at              TEXT NOT NULL
);
CREATE INDEX ix_event_app ON application_event(application_id, at);

CREATE TABLE interview (
  id              TEXT PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES application(id),
  round           INTEGER NOT NULL DEFAULT 1,
  kind            TEXT NOT NULL DEFAULT 'tech',
  scheduled_at    TEXT,
  duration_min    INTEGER,
  format          TEXT,
  interviewer     TEXT,
  location        TEXT,
  prep_status     TEXT NOT NULL DEFAULT 'none',
  feedback        TEXT,
  self_rating     INTEGER,
  result          TEXT NOT NULL DEFAULT 'pending',
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX ix_interview_time ON interview(scheduled_at);

CREATE TABLE question (
  id              TEXT PRIMARY KEY,
  interview_id    TEXT REFERENCES interview(id),
  job_id          TEXT REFERENCES job(id),
  category        TEXT NOT NULL,
  question        TEXT NOT NULL,
  intent          TEXT,
  linked_item     TEXT,
  my_answer       TEXT,
  score_json      TEXT,
  improvement     TEXT,
  origin          TEXT NOT NULL DEFAULT 'generated',
  provenance_json TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_question_job ON question(job_id);

CREATE TABLE offer (
  id               TEXT PRIMARY KEY,
  application_id   TEXT NOT NULL UNIQUE REFERENCES application(id),
  company_name     TEXT NOT NULL,
  level            TEXT,
  city             TEXT,
  base_monthly     INTEGER NOT NULL,
  months_per_year  INTEGER NOT NULL DEFAULT 12,
  perf_months      REAL NOT NULL DEFAULT 0,
  signon           INTEGER NOT NULL DEFAULT 0,
  equity_shares    INTEGER NOT NULL DEFAULT 0,
  equity_strike    REAL NOT NULL DEFAULT 0,
  equity_fmv       REAL NOT NULL DEFAULT 0,
  vest_years       INTEGER NOT NULL DEFAULT 4,
  cliff_months     INTEGER NOT NULL DEFAULT 12,
  housing_fund     REAL NOT NULL DEFAULT 0.07,
  subsidy_monthly  INTEGER NOT NULL DEFAULT 0,
  deadline         TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  assumptions_json TEXT,
  decision_note    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE task (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  due_at          TEXT NOT NULL,
  application_id  TEXT REFERENCES application(id),
  done_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX ix_task_due ON task(done_at, due_at);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
