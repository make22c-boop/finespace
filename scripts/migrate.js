require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
  console.log('스키마 적용 중...');
  await pool.query(sql);
  console.log('완료: 테이블이 준비되었습니다.');
  await pool.end();
}

main().catch(function (err) {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
