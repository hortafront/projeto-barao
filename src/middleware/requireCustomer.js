import { AppError } from '../errors/AppError.js';

const MESSAGE = 'Entre na sua conta para continuar.';

/** Qualquer usuário autenticado no Supabase Auth; não checa e-mail. */
export function requireCustomer({ db }) {
  return async (req, res, next) => {
    try {
      const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      if (!match) throw new AppError('UNAUTHORIZED', 401, MESSAGE);
      const user = await db.getUserByAccessToken(match[1]);
      if (!user) throw new AppError('UNAUTHORIZED', 401, MESSAGE);
      req.customer = { id: user.id, email: user.email };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
