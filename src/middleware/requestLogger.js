// Nunca logar body, headers (Authorization), query, nome, telefone, endereço ou mensagem do WhatsApp.
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    console.log(JSON.stringify({
      level: 'info', method: req.method, path: req.originalUrl.split('?')[0],
      status: res.statusCode, ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
    }));
  });
  next();
}
