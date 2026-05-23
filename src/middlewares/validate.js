// Middleware de validação via Zod.
//
// Uso:
//   const { z } = require("zod");
//   const validate = require("./validate");
//   router.post("/path", validate({ body: schema, query: schema, params: schema }), handler)
//
// Em erro, devolve 400 com o payload padronizado:
//   { error, code: "validation_error", details: [...issues...] }
// (Atende ao mesmo shape do error_handler global.)

const { ZodError } = require("zod");

module.exports = function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: "Dados inválidos.",
          code: "validation_error",
          details: err.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: issue.code,
          })),
        });
      }
      return next(err);
    }
  };
};
