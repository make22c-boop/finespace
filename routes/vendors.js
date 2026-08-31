const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');

const router = express.Router();

router.get('/', async function (req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM vendors ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/', async function (req, res) {
  try {
    const b = req.body || {};
    const name = (b.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name_required', message: '거래처 이름을 입력해주세요.' });
    }
    const id = crypto.randomUUID();
    const created_at = Date.now();
    const row = {
      id,
      name,
      bank: b.bank || '',
      account: b.account || '',
      contact: b.contact || '',
      biz_no: b.biz_no || '',
      biz_cert_photo_url: b.biz_cert_photo_url || null,
      memo: b.memo || '',
      created_at,
    };
    await pool.query(
      `INSERT INTO vendors (id, name, bank, account, contact, biz_no, biz_cert_photo_url, memo, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, row.name, row.bank, row.account, row.contact, row.biz_no, row.biz_cert_photo_url, row.memo, row.created_at]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
