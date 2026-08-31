require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const sitesRoutes = require('./routes/sites');
const vendorsRoutes = require('./routes/vendors');
const requestsRoutes = require('./routes/requests');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '2mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'pinespace-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000, // 12시간
  },
}));

// 로컬 디스크에 저장된 업로드 사진 서빙 (개발용 - Supabase Storage 사용시 불필요)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', function (req, res) {
  res.json({ ok: true, time: Date.now() });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function () {
  console.log('파인스페이스 지출결의 서버 실행중: http://localhost:' + PORT);
});
