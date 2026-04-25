const AuthService = require("../services/AuthService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class AuthController {
  static async signup(req, res) {
    const result = await AuthService.signup(req.body);
    return sendServiceResult(res, result, 201);
  }

  static async checkUsername(req, res) {
    const result = await AuthService.checkUsername({ username: req.query.u || req.query.username });
    return res.status(200).json(result);
  }

  static async signin(req, res) {
    const result = await AuthService.signin(req.body);
    return sendServiceResult(res, result, 200);
  }

  static async activate(req, res) {
    const result = await AuthService.activate(req.query);
    return sendServiceResult(res, result, 200);
  }

  static async forgotPassword(req, res) {
    const result = await AuthService.forgotPassword(req.body);
    return sendServiceResult(res, result, 200);
  }

  static async resendActivation(req, res) {
    const result = await AuthService.resendActivation(req.user);
    return sendServiceResult(res, result, 200);
  }

  static async changeEmail(req, res) {
    const result = await AuthService.changeEmail(req.user, req.body);
    return sendServiceResult(res, result, 200);
  }

  static async resetPassword(req, res) {
    const result = await AuthService.resetPassword(req.body);
    return sendServiceResult(res, result, 200);
  }
}

module.exports = AuthController;
