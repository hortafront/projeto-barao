// Express 4 não captura rejeição de handler async; sem isto a requisição fica pendurada.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
