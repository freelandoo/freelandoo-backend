const CoursesService = require("../services/CoursesService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CoursesController {
  // GET /me/courses
  static async listMine(req, res) {
    return sendServiceResult(res, await CoursesService.listMine(req.user));
  }

  // GET /courses/public/by-slug/:slug — público (sem auth)
  static async getPublicBySlug(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.getPublicBySlug(req.params.slug),
    );
  }

  // GET /courses/public/by-profile/:profileId — público (sem auth)
  static async listPublicByProfile(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.listPublicByProfile(req.params.profileId),
    );
  }

  // POST /me/courses/:id/checkout — cria sessão Stripe
  static async createCheckout(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.createStripeCheckout(req.user, req.params.id),
    );
  }

  // GET /me/courses/:id
  static async getMineById(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.getMineById(req.user, req.params.id),
    );
  }

  // POST /me/courses
  static async create(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.create(req.user, req.body || {}),
      201,
    );
  }

  // PUT /me/courses/:id
  static async update(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.update(req.user, req.params.id, req.body || {}),
    );
  }

  // DELETE /me/courses/:id
  static async remove(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.remove(req.user, req.params.id),
    );
  }

  // POST /me/courses/:id/cover   (multipart, field "cover")
  static async uploadCover(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.uploadCover(req.user, req.params.id, req.file),
    );
  }

  // DELETE /me/courses/:id/cover
  static async removeCover(req, res) {
    return sendServiceResult(
      res,
      await CoursesService.removeCover(req.user, req.params.id),
    );
  }
}

module.exports = CoursesController;
