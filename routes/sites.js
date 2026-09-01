const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');

const router = express.Router();

router.get('/', async function (req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM sites ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/', async function (req, res) {
  try {
    const name = (req.body && req.body.name || '').trim();
    const manager = (req.body && req.body.manager || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name_required', message: '현장 이름을 입력해주세요.' });
    }
    const id = crypto.randomUUID();
    const created_at = Date.now();
    await pool.query(
      'INSERT INTO sites (id, name, manager, active, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, name, manager, true, created_at]
    );
    res.status(201).json({ id, name, manager, active: true, created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// 현장 종료(비활성화)/재개 처리. 과거 요청 내역이 site_id를 참조하므로 실제로 삭제하지 않고
// active 플래그만 바꿔서 신규 지출요청 작성 시 선택 목록에서 빠지도록 한다.
router.patch('/:id', async function (req, res) {
  try {
    const b = req.body || {};
    if (typeof b.active !== 'boolean') {
      return res.status(400).json({ error: 'invalid_input', message: 'active 값이 필요합니다.' });
    }
    const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    await pool.query('UPDATE sites SET active = $1 WHERE id = $2', [b.active, req.params.id]);
    const { rows: updated } = await pool.query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
