import { AppError } from '../errors/AppError.js';

/** adminEmails vazio ⇒ ninguém entra (fail closed). */
export function requireAdmin({ db, adminEmails }) {
  const allowed = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return async (req, res, next) => {
    try {
      const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      if (!match) throw new AppError('UNAUTHORIZED', 401, 'Sua sessão expirou. Entre novamente.');
      const user = await db.getUserByAccessToken(match[1]);
      if (!user) throw new AppError('UNAUTHORIZED', 401, 'Sua sessão expirou. Entre novamente.');
      if (!user.email || !allowed.has(user.email.toLowerCase())) {
        throw new AppError('FORBIDDEN', 403, 'Você não tem permissão para acessar esta área.');
      }
      req.admin = { id: user.id, email: user.email };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
