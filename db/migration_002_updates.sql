-- 2번째 업데이트: 현장 종료(비활성화), 요청 수정, 사진 여러장 첨부 기능을 위한 컬럼 추가
-- 기존 Supabase 프로젝트의 SQL Editor에서 이 내용을 실행하세요. (기존 데이터는 보존됩니다)

ALTER TABLE sites ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 기존에 photo_url(단일 사진)만 있던 요청 건들을 photo_urls 배열로도 채워줌 (하위 호환)
UPDATE requests
SET photo_urls = jsonb_build_array(photo_url)
WHERE photo_url IS NOT NULL AND jsonb_array_length(photo_urls) = 0;
