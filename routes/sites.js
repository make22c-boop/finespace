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
      'INSERT INTO sites (id, name, manager, created_at) VALUES ($1, $2, $3, $4)',
      [id, name, manager, created_at]
    );
    res.status(201).json({ id, name, manager, created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
