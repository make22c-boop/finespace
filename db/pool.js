const { Pool, types } = require('pg');

// pg는 기본적으로 BIGINT(OID 20)를 문자열로 반환한다 (정밀도 손실 방지 목적).
// 이 앱의 BIGINT 컬럼(금액, 타임스탬프)은 안전정수 범위를 넘지 않으므로 숫자로 파싱하도록 설정.
types.setTypeParser(20, function (val) { return val === null ? null : parseInt(val, 10); });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pinespace:devpass123@localhost:5432/pinespace',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;
