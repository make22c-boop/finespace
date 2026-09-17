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
  revision_requested: '보완요청',
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
      { header: '구분', key: 'type', width: 10 },
      { header: '상태', key: 'status', width: 10 },
      { header: '요청일', key: 'date', width: 12 },
      { header: '현장', key: 'site', width: 16 },
      { header: '담당자', key: 'manager', width: 12 },
      { header: '거래처/작업자', key: 'vendor', width: 16 },
      { header: '금액', key: 'amount', width: 14 },
      { header: '내용', key: 'description', width: 24 },
      { header: '메모', key: 'memo', width: 20 },
      { header: '초긴급', key: 'urgent', width: 8 },
      { header: '초긴급사유', key: 'urgentReason', width: 20 },
      { header: '승인자', key: 'ceoBy', width: 10 },
      { header: '승인의견', key: 'ceoComment', width: 20 },
      { header: '보완요청사유', key: 'revisionComment', width: 20 },
      { header: '지출예정일', key: 'scheduledPayDate', width: 12 },
      { header: '지급자', key: 'paidBy', width: 10 },
      { header: '지급일', key: 'paidDate', width: 12 },
      { header: '지급메모', key: 'paidMemo', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };

    rows.forEach(function (r) {
      ws.addRow({
        type: r.request_type === 'labor' ? '노무비' : '지출요청',
        status: STATUS_LABEL[r.status] || r.status,
        date: r.date,
        site: r.site_name,
        manager: r.manager_name,
        vendor: r.request_type === 'labor' ? r.worker_name : r.vendor_name,
        amount: Number(r.amount),
        description: r.description,
        memo: r.memo,
        urgent: r.is_urgent ? 'Y' : '',
        urgentReason: r.urgent_reason,
        ceoBy: r.ceo_by,
        ceoComment: r.ceo_comment,
        revisionComment: r.revision_comment,
        scheduledPayDate: r.scheduled_pay_date,
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
    const request_type = b.request_type === 'labor' ? 'labor' : 'expense';

    if (!site_id || !site_name || !manager_name || !date) {
      return res.status(400).json({ error: 'invalid_input', message: '필수 항목을 입력해주세요.' });
    }

    let amount, description, vendor_id, vendor_name, worker_name, worker_id_no, worker_bank, worker_account, work_dates;

    if (request_type === 'labor') {
      worker_name = (b.worker_name || '').trim();
      worker_id_no = (b.worker_id_no || '').trim();
      worker_bank = (b.worker_bank || '').trim();
      worker_account = (b.worker_account || '').trim();
      work_dates = Array.isArray(b.work_dates) ? b.work_dates.filter(Boolean) : [];
      amount = Number(b.amount);
      description = (b.description || '').trim() || ('노무비 - ' + worker_name);
      vendor_id = null;
      vendor_name = '';
      if (!worker_name || !amount || amount <= 0 || !work_dates.length) {
        return res.status(400).json({ error: 'invalid_input', message: '작업자 이름, 근로일, 급여를 입력해주세요.' });
      }
    } else {
      amount = Number(b.amount);
      description = (b.description || '').trim();
      vendor_id = b.vendor_id || null;
      vendor_name = (b.vendor_name || '').trim();
      worker_name = ''; worker_id_no = ''; worker_bank = ''; worker_account = ''; work_dates = [];
      if (!vendor_name || !amount || amount <= 0 || !description) {
        return res.status(400).json({ error: 'invalid_input', message: '필수 항목을 입력해주세요.' });
      }
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

    // 여러 장의 사진(photo_urls)을 지원. 이전 버전 호환을 위해 photo_url에는 첫 번째 사진을 저장.
    const photo_urls = Array.isArray(b.photo_urls) ? b.photo_urls.filter(Boolean) : (b.photo_url ? [b.photo_url] : []);
    const photo_url = photo_urls.length ? photo_urls[0] : (b.photo_url || null);

    const row = {
      id,
      site_id,
      site_name,
      manager_name,
      date,
      request_type,
      vendor_id,
      vendor_name,
      amount,
      description,
      memo: b.memo || '',
      photo_url,
      photo_urls,
      is_urgent,
      urgent_reason,
      status,
      created_at,
      updated_at: 0,
      ceo_by,
      ceo_at,
      ceo_comment,
      worker_name,
      worker_id_no,
      worker_bank,
      worker_account,
      work_dates,
    };

    await pool.query(
      `INSERT INTO requests (id, site_id, site_name, manager_name, date, request_type, vendor_id, vendor_name, amount, description, memo, photo_url, photo_urls, is_urgent, urgent_reason, status, created_at, updated_at, ceo_by, ceo_at, ceo_comment, worker_name, worker_id_no, worker_bank, worker_account, work_dates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [row.id, row.site_id, row.site_name, row.manager_name, row.date, row.request_type, row.vendor_id, row.vendor_name, row.amount, row.description, row.memo, row.photo_url, JSON.stringify(row.photo_urls), row.is_urgent, row.urgent_reason, row.status, row.created_at, row.updated_at, row.ceo_by, row.ceo_at, row.ceo_comment, row.worker_name, row.worker_id_no, row.worker_bank, row.worker_account, JSON.stringify(row.work_dates)]
    );

    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// 현장담당자가 제출한 요청이 대기중(pending) 이거나 경리로부터 보완요청(revision_requested)을
// 받은 상태일 때만 수정 가능. 보완요청 건을 수정해서 다시 제출하면 대표 승인 절차 없이
// 바로 경리 지급대기(approved) 상태로 돌아간다.
// (초긴급 건은 제출과 동시에 자동승인되어 이 두 상태에 해당하지 않으므로 이 경로로 들어오지 않음)
router.put('/:id', async function (req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const current = rows[0];
    if (current.status !== 'pending' && current.status !== 'revision_requested') {
      return res.status(409).json({ error: 'not_editable', message: '대기중이거나 보완요청된 요청만 수정할 수 있습니다. (이미 처리된 요청은 수정할 수 없어요)' });
    }

    const b = req.body || {};
    const date = b.date;
    if (!date) {
      return res.status(400).json({ error: 'invalid_input', message: '날짜를 입력해주세요.' });
    }

    const request_type = current.request_type || 'expense';
    let amount, description, vendor_id, vendor_name, worker_name, worker_id_no, worker_bank, worker_account, work_dates;

    if (request_type === 'labor') {
      worker_name = (b.worker_name || '').trim();
      worker_id_no = (b.worker_id_no || '').trim();
      worker_bank = (b.worker_bank || '').trim();
      worker_account = (b.worker_account || '').trim();
      work_dates = Array.isArray(b.work_dates) ? b.work_dates.filter(Boolean) : [];
      amount = Number(b.amount);
      description = (b.description || '').trim() || ('노무비 - ' + worker_name);
      vendor_id = null;
      vendor_name = '';
      if (!worker_name || !amount || amount <= 0 || !work_dates.length) {
        return res.status(400).json({ error: 'invalid_input', message: '작업자 이름, 근로일, 급여를 입력해주세요.' });
      }
    } else {
      amount = Number(b.amount);
      description = (b.description || '').trim();
      vendor_id = b.vendor_id || null;
      vendor_name = (b.vendor_name || '').trim();
      worker_name = current.worker_name || '';
      worker_id_no = current.worker_id_no || '';
      worker_bank = current.worker_bank || '';
      worker_account = current.worker_account || '';
      work_dates = Array.isArray(current.work_dates) ? current.work_dates : [];
      if (!vendor_name || !amount || amount <= 0 || !description) {
        return res.status(400).json({ error: 'invalid_input', message: '필수 항목을 입력해주세요.' });
      }
    }

    const memo = b.memo || '';
    const photo_urls = Array.isArray(b.photo_urls) ? b.photo_urls.filter(Boolean) : (b.photo_url ? [b.photo_url] : []);
    const photo_url = photo_urls.length ? photo_urls[0] : null;
    const updated_at = Date.now();
    const newStatus = current.status === 'revision_requested' ? 'approved' : 'pending';

    await pool.query(
      `UPDATE requests SET date=$1, vendor_id=$2, vendor_name=$3, amount=$4, description=$5, memo=$6, photo_url=$7, photo_urls=$8, updated_at=$9, status=$10,
              worker_name=$11, worker_id_no=$12, worker_bank=$13, worker_account=$14, work_dates=$15
       WHERE id=$16`,
      [date, vendor_id, vendor_name, amount, description, memo, photo_url, JSON.stringify(photo_urls), updated_at, newStatus,
        worker_name, worker_id_no, worker_bank, worker_account, JSON.stringify(work_dates), req.params.id]
    );
    const { rows: updated } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    res.json(updated[0]);
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

// 경리가 승인된(지급대기) 요청에 보완이 필요하다고 판단될 때 현장담당자에게 반려.
// 대표 승인 단계를 다시 거치지 않고, 현장담당자가 수정 후 재제출하면 곧바로 경리에게 돌아온다.
router.post('/:id/request-revision', requireRole('accountant'), async function (req, res) {
  try {
    const comment = ((req.body && req.body.comment) || '').trim();
    if (!comment) {
      return res.status(400).json({ error: 'comment_required', message: '보완요청 사유를 입력해주세요.' });
    }
    const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    if (rows[0].status !== 'approved') {
      return res.status(409).json({ error: 'not_requestable', message: '지급대기(승인됨) 상태의 요청만 보완요청할 수 있습니다.' });
    }
    const revision_at = Date.now();
    await pool.query(
      'UPDATE requests SET status=$1, revision_comment=$2, revision_by=$3, revision_at=$4 WHERE id=$5',
      ['revision_requested', comment, req.session.name, revision_at, req.params.id]
    );
    const { rows: updated } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// 경리가 승인된(지급대기) 요청에 지출(지급) 예정일을 지정. 현장담당자 화면에도 표시된다.
router.post('/:id/schedule-pay', requireRole('accountant'), async function (req, res) {
  try {
    const scheduled_pay_date = ((req.body && req.body.scheduled_pay_date) || '').trim();
    const { rows } = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    if (rows[0].status !== 'approved') {
      return res.status(409).json({ error: 'not_approved', message: '승인된(지급대기) 요청만 지출 예정일을 지정할 수 있습니다.' });
    }
    await pool.query('UPDATE requests SET scheduled_pay_date=$1 WHERE id=$2', [scheduled_pay_date, req.params.id]);
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
