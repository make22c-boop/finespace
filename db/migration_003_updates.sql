-- 3번째 업데이트: 보완요청, 지출 예정일, 노무비 처리 등록 기능을 위한 컬럼 추가
-- 기존 Supabase 프로젝트의 SQL Editor에서 이 내용을 실행하세요. (기존 데이터는 보존됩니다)

ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'expense';

ALTER TABLE requests ADD COLUMN IF NOT EXISTS scheduled_pay_date TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS revision_comment TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS revision_by TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS revision_at BIGINT NOT NULL DEFAULT 0;

-- 노무비(request_type='labor') 전용 필드
ALTER TABLE requests ADD COLUMN IF NOT EXISTS worker_name TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS worker_id_no TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS worker_bank TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS worker_account TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS work_dates JSONB NOT NULL DEFAULT '[]'::jsonb;
