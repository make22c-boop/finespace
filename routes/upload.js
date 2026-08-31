const express = require('express');
const multer = require('multer');
const { saveFile } = require('../lib/storage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

router.post('/', upload.single('photo'), async function (req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'no_file', message: '파일이 없습니다.' });
    }
    const url = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url });
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: 'upload_failed', message: '업로드 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
