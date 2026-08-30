// src/controllers/SubjectCommunityController.js
// Camada fina das modalidades pet/carro/games (mig 210). Todos os guards —
// flag, validação do assunto, unicidade do modelo — moram no
// SubjectCommunityService.

const SubjectCommunityService = require("../services/SubjectCommunityService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class SubjectCommunityController {
  // ─── Pet ────────────────────────────────────────────────────────────────────
  static async listBreeds(req, res) {
    const result = await SubjectCommunityService.listBreeds(req.query || {});
    return sendServiceResult(res, result);
  }

  static async createPet(req, res) {
    const result = await SubjectCommunityService.createPet(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  // ─── Games ──────────────────────────────────────────────────────────────────
  static async createGame(req, res) {
    const result = await SubjectCommunityService.createGame(req.user, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  // ─── Carro ──────────────────────────────────────────────────────────────────
  static async listCarBrands(req, res) {
    const result = await SubjectCommunityService.listCarBrands();
    return sendServiceResult(res, result);
  }

  static async listCarModels(req, res) {
    const result = await SubjectCommunityService.listCarModels({
      brand_code: req.params.brand_code,
    });
    return sendServiceResult(res, result);
  }

  // 200 e não 201: metade das vezes esta rota não cria nada — ela ENTRA na
  // comunidade que já existia daquele modelo. O corpo diz qual foi o caso.
  static async createOrJoinCar(req, res) {
    const result = await SubjectCommunityService.createOrJoinCar(req.user, req.body || {});
    return sendServiceResult(res, result);
  }

  // ─── Menu da foto de perfil ─────────────────────────────────────────────────
  static async mySpaces(req, res) {
    const result = await SubjectCommunityService.mySpaces(req.user);
    return sendServiceResult(res, result);
  }
}

module.exports = SubjectCommunityController;
