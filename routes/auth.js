const express = require('express');
const router = express.Router();

const CEO_PASSWORD = process.env.CEO_PASSWORD || '0001';
const ACCOUNTANT_PASSWORD = process.env.ACCOUNTANT_PASSWORD || '1000';
const CEO_NAME = process.env.CEO_NAME || '전동원';
const ACCOUNTANT_NAME = process.env.ACCOUNTANT_NAME || '김소영';

router.post('/login', function (req, res) {
  const { role, password } = req.body || {};
  if (role === 'ceo') {
    if (password !== CEO_PASSWORD) {
      return res.status(401).json({ error: 'invalid_password', message: '비밀번호가 올바르지 않습니다.' });
    }
    req.session.role = 'ceo';
    req.session.name = CEO_NAME;
    return res.json({ role: 'ceo', name: CEO_NAME });
  }
  if (role === 'accountant') {
    if (password !== ACCOUNTANT_PASSWORD) {
      return res.status(401).json({ error: 'invalid_password', message: '비밀번호가 올바르지 않습니다.' });
    }
    req.session.role = 'accountant';
    req.session.name = ACCOUNTANT_NAME;
    return res.json({ role: 'accountant', name: ACCOUNTANT_NAME });
  }
  return res.status(400).json({ error: 'invalid_role' });
});

router.post('/logout', function (req, res) {
  req.session.destroy(function () {
    res.json({ ok: true });
  });
});

router.get('/me', function (req, res) {
  if (req.session && req.session.role) {
    return res.json({ role: req.session.role, name: req.session.name });
  }
  res.json({ role: null, name: null });
});

module.exports = router;
