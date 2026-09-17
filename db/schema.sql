-- 파인스페이스 지출결의 시스템 schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manager TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  biz_no TEXT NOT NULL DEFAULT '',
  biz_cert_photo_url TEXT,
  memo TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  site_name TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  date TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'expense', -- expense(지출요청) | labor(노무비 처리)
  vendor_id TEXT,
  vendor_name TEXT NOT NULL DEFAULT '',
  amount BIGINT NOT NULL,
  description TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paid | revision_requested
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0,
  ceo_by TEXT NOT NULL DEFAULT '',
  ceo_at BIGINT NOT NULL DEFAULT 0,
  ceo_comment TEXT NOT NULL DEFAULT '',
  paid_by TEXT NOT NULL DEFAULT '',
  paid_at BIGINT NOT NULL DEFAULT 0,
  paid_date TEXT NOT NULL DEFAULT '',
  paid_memo TEXT NOT NULL DEFAULT '',
  scheduled_pay_date TEXT NOT NULL DEFAULT '', -- 경리가 지정하는 지출(지급) 예정일
  revision_comment TEXT NOT NULL DEFAULT '', -- 경리의 보완요청 사유 (가장 최근 건)
  revision_by TEXT NOT NULL DEFAULT '',
  revision_at BIGINT NOT NULL DEFAULT 0,
  -- 노무비(request_type='labor') 전용 필드
  worker_name TEXT NOT NULL DEFAULT '',
  worker_id_no TEXT NOT NULL DEFAULT '', -- 주민등록번호 (전체 저장, 화면에는 마스킹 처리)
  worker_bank TEXT NOT NULL DEFAULT '',
  worker_account TEXT NOT NULL DEFAULT '',
  work_dates JSONB NOT NULL DEFAULT '[]'::jsonb -- 근로일(근무한 날짜) 목록
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_site ON requests(site_id);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
