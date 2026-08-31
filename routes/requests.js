const express = require('express');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const STATUS_LABEL = {
  pending: '대기중',
  approved: '승인됨',
  rejected: '반려됨',
  paid: '지급완료',
};

router.get('/', async function (req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM requests ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/export', async function (req, res) {
  try {
    // ?month=2026-08 형식으로 필터 가능 (없으면 전체)
    const month = req.query.month;
    let rows;
    if (month) {
      const start = new Date(month + '-01T00:00:00+09:00').getTime();
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      const r = await pool.query(
        'SELECT * FROM requests WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at ASC',
        [start, end.getTime()]
      );
      rows = r.rows;
    } else {
      const r = await pool.query('SELECT * FROM requests ORDER BY created_at ASC');
      rows = r.rows;
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('지출내역');
    ws.columns = [
      { header: '상태', key: 'status', width: 10 },
      { header: '요청일', key: 'date', width: 12 },
      { header: '현장', key: 'site', width: 16 },
      { header: '담당자', key: 'manager', width: 12 },
      { header: '거래처', key: 'vendor', width: 16 },
      { header: '금액', key: 'amount', width: 14 },
      { header: '내용', key: 'description', width: 24 },
      { header: '메모', key: 'memo', width: 20 },
      { header: '초긴급', key: 'urgent', width: 8 },
      { header: '초긴급사유', key: 'urgentReason', width: 20 },
      { header: '승인자', key: 'ceoBy', width: 10 },
      { header: '승인의견', key: 'ceoComment', width: 20 },
      { header: '지급자', key: 'paidBy', width: 10 },
      { header: '지급일', key: 'paidDate', width: 12 },
      { header: '지급메모', key: 'paidMemo', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };

    rows.forEach(function (r) {
      ws.addRow({
        status: STATUS_LABEL[r.status] || r.status,
        date: r.date,
        site: r.site_name,
        manager: r.manager_name,
        vendor: r.vendor_name,
        amount: Number(r.amount),
        description: r.description,
        memo: r.memo,
        urgent: r.is_urgent ? 'Y' : '',
        urgentReason: r.urgent_reason,
        ceoBy: r.ceo_by,
        ceoComment: r.ceo_comment,
        paidBy: r.paid_by,
        paidDate: r.paid_date,
        paidMemo: r.paid_memo,
      });
    });
    ws.getColumn('amount').numFmt = '#,##0';

    const filename = '파인스페이스_지출내역' + (month ? '_' + month : '') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/:id', async function (req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/', async function (req, res) {
  try {
    const b = req.body || {};
    const site_id = b.site_id;
    const site_name = (b.site_name || '').trim();
    const manager_name = (b.manager_name || '').trim();
    const date = b.date;
    const amount = Number(b.amount);
    const description = (b.description || '').trim();

    if (!site_id || !site_name || !manager_name || !date || !amount || amount <= 0 || !description) {
      return res.status(400).json({ error: 'invalid_input', message: '필수 항목을 입력해주세요.' });
    }

    const is_urgent = !!b.is_urgent;
    const urgent_reason = is_urgent ? (b.urgent_reason || '').trim() : '';
    if (is_urgent && !urgent_reason) {
      return res.status(400).json({ error: 'urgent_reason_required', message: '초긴급 사유를 입력해주세요.' });
    }

    const id = crypto.randomUUID();
    const created_at = Date.now();

    // 초긴급 건은 대표 승인을 거치지 않고 즉시 승인 처리(사후 감사 추적용으로 자동승인 표시를 남김)
    const status = is_urgent ? 'approved' : 'pending';
    const ceo_by = is_urgent ? '초긴급자동승인' : '';
    const ceo_at = is_urgent ? created_at : 0;
    const ceo_comment = is_urgent ? ('[초긴급 자동승인] ' + urgent_reason) : '';

    const row = {
      id,
      site_id,
      site_name,
      manager_name,
      date,
      vendor_id: b.vendor_id || null,
      vendor_name: (b.vendor_name || '').trim(),
      amount,
      description,
      memo: b.memo || '',
      photo_url: b.photo_url || null,
      is_urgent,
      urgent_reason,
      status,
      created_at,
      ceo_by,
      ceo_at,
      ceo_comment,
    };

    await pool.query(
      `INSERT INTO requests (id, site_id, site_name, manager_name, date, vendor_id, vendor_name, amount, description, memo, photo_url, is_urgent, urgent_reason, status, created_at, ceo_by, ceo_at, ceo_comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [row.id, row.site_id, row.site_name, row.manager_name, row.date, row.vendor_id, row.vendor_name, row.amount, row.description, row.memo, row.photo_url, row.is_urgent, row.urgent_reason, row.status, row.created_at, row.ceo_by, row.ceo_at, row.ceo_comment]
    );

    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/:id/decide', requireRole('ceo'), async function (req, res) {
  try {
    const { decision, comment } = req.body || {};
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: 'invalid_decision' });
    }
    const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    if (rows[0].status !== 'pending') {
      return res.status(409).json({ error: 'already_decided', message: '이미 처리된 요청입니다.' });
    }
    const ceo_at = Date.now();
    await pool.query(
      'UPDATE requests SET status=$1, ceo_by=$2, ceo_at=$3, ceo_comment=$4 WHERE id=$5',
      [decision, req.session.name, ceo_at, comment || '', req.params.id]
    );
    const { rows: updated } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/:id/pay', requireRole('accountant'), async function (req, res) {
  try {
    const { paid_date, paid_memo } = req.body || {};
    const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    if (rows[0].status !== 'approved') {
      return res.status(409).json({ error: 'not_approved', message: '승인된 요청만 지급 처리할 수 있습니다.' });
    }
    const paid_at = Date.now();
    await pool.query(
      'UPDATE requests SET status=$1, paid_by=$2, paid_at=$3, paid_date=$4, paid_memo=$5 WHERE id=$6',
      ['paid', req.session.name, paid_at, paid_date || '', paid_memo || '', req.params.id]
    );
    const { rows: updated } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
