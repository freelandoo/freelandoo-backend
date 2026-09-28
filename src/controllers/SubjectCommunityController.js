// src/controllers/SubjectCommunityController.js
// Camada fina das modalidades pet/carro/games (mig 210). Todos os guards —
// flag, validação do assunto, unicidade do modelo — moram no
// SubjectCommunityService.

const SubjectCommunityService = require("../services/SubjectCommunityService");
const { sendServiceResult } = require("../utils/sendServiceResult");

// Pet/carro adicional (mig 264): a recusa carrega o preço e a modalidade, que o
// `sendServiceResult` descartaria (ele devolve só `error`). É com eles que a
// tela oferece o pagamento em vez de só dizer não.
function sendSlotAware(res, result, successStatus) {
  if (result && result.needs_slot) {
    return res.status(402).json({
      error: result.error,
      needs_slot: true,
      kind: result.kind,
      price_cents: result.price_cents,
    });
  }
  return sendServiceResult(res, result, successStatus);
}

class SubjectCommunityController {
  // ─── Pet ────────────────────────────────────────────────────────────────────
  static async listBreeds(req, res) {
    const result = await SubjectCommunityService.listBreeds(req.query || {});
    return sendServiceResult(res, result);
  }

  static async createPet(req, res) {
    const result = await SubjectCommunityService.createPet(req.user, req.body || {});
    return sendSlotAware(res, result, 201);
  }

  // ─── Games ──────────────────────────────────────────────────────────────────
  // 200 e não 201: esta porta quase nunca cria — ela ABRE a plataforma, que
  // é uma só para o site inteiro (mig 232).
  static async openGamesPlatform(req, res) {
    const result = await SubjectCommunityService.openGamesPlatform(req.user);
    return sendServiceResult(res, result);
  }

  static async getCurrentGame(req, res) {
    const result = await SubjectCommunityService.getCurrentGame(req.user);
    return sendServiceResult(res, result);
  }

  static async setCurrentGame(req, res) {
    const result = await SubjectCommunityService.setCurrentGame(req.user, req.body || {});
    return sendServiceResult(res, result);
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

  // Cria SEMPRE a comunidade de um carro do dono (mig 259 — antes ela podia
  // entrar na comunidade do modelo, e por isso responde 200 e não 201).
  static async createCar(req, res) {
    const result = await SubjectCommunityService.createCar(req.user, req.body || {});
    return sendSlotAware(res, result);
  }

  // ─── Edição do assunto dentro da página (sem modal) ─────────────────────────
  static async updateSubject(req, res) {
    const result = await SubjectCommunityService.updateSubject(
      req.user,
      { id_profile: req.params.id_profile, kind: req.subjectKind },
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async deleteSubject(req, res) {
    const result = await SubjectCommunityService.deleteSubject(req.user, {
      id_profile: req.params.id_profile,
      kind: req.subjectKind,
    });
    return sendServiceResult(res, result);
  }

  // ─── Menu da foto de perfil ─────────────────────────────────────────────────
  static async publicSpaces(req, res) {
    const result = await SubjectCommunityService.publicSpaces(req.params.handle);
    return sendServiceResult(res, result);
  }

  static async mySpaces(req, res) {
    const result = await SubjectCommunityService.mySpaces(req.user);
    return sendServiceResult(res, result);
  }
}

module.exports = SubjectCommunityController;
