import { AppError } from '../utils/AppError.js';

export const notFound = (req, _res, next) =>
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
