/**
 * Parses body / params / query / headers with Zod schemas. Parsed (and defaulted) values are exposed on
 * `req.valid`; handlers must read from there and never from the raw request. ZodErrors flow to the global handler.
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    req.valid = {
      ...(schemas.body && { body: schemas.body.parse(req.body) }),
      ...(schemas.params && { params: schemas.params.parse(req.params) }),
      ...(schemas.query && { query: schemas.query.parse(req.query) }),
      ...(schemas.headers && { headers: schemas.headers.parse(req.headers) }),
    };
    next();
  } catch (err) {
    next(err);
  }
};
