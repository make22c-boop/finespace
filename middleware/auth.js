function requireRole(role) {
  return function (req, res, next) {
    if (req.session && req.session.role === role) {
      return next();
    }
    return res.status(401).json({ error: 'unauthorized', message: '로그인이 필요합니다.' });
  };
}

module.exports = { requireRole };
