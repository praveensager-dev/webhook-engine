/** Operational error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, code = 'BAD_REQUEST', details) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = 'Missing or invalid API key') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static notFound(message = 'Resource not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }
}
