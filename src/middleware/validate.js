import { AppError } from '../errors/AppError.js';

export const zodDetails = (error) => error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** source: 'body' | 'query' | 'params'. Body é substituído pelo dado limpo; todos vão também para req.valid. */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError('VALIDATION_ERROR', 400, 'Confira os dados informados.', zodDetails(result.error)));
    }
    req.valid = { ...req.valid, [source]: result.data };
    if (source === 'body') req.body = result.data;
    return next();
  };
}
