export class AppError extends Error {
  /** code: STORE_CLOSED | VALIDATION_ERROR | PRODUCT_UNAVAILABLE | PRODUCT_HAS_ORDERS | NOT_FOUND | UNAUTHORIZED | FORBIDDEN | RATE_LIMITED | INTERNAL */
  constructor(code, status, message, details, options) {
    super(message, options); // options.cause preserva o erro original (só para log)
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
