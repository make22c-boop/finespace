// 사진 업로드 저장소 추상화
// - SUPABASE_URL / SUPABASE_SERVICE_KEY 가 설정되어 있으면 Supabase Storage 사용 (영구 저장, 운영 권장)
// - 없으면 로컬 디스크(uploads/)에 저장 (개발용 - Render 무료플랜 재배포시 사라짐)

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'photos';

let supabase = null;
if (useSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function safeExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (/^\.(jpg|jpeg|png|gif|webp|heic|heif|pdf)$/.test(ext)) return ext;
  return '.jpg';
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} mimetype
 * @returns {Promise<string>} public URL
 */
async function saveFile(buffer, originalName, mimetype) {
  const filename = crypto.randomUUID() + safeExt(originalName);

  if (useSupabase) {
    const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
      contentType: mimetype || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    return data.publicUrl;
  }

  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return '/uploads/' + filename;
}

module.exports = { saveFile, useSupabase };
