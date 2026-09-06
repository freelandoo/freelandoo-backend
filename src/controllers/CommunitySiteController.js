const CommunitySiteService = require("../services/CommunitySiteService");
const { sendServiceResult } = require("../utils/sendServiceResult");
const uploadCommunitySiteAssetToR2 = require("../integrations/r2/uploadCommunitySiteAsset");

class CommunitySiteController {
  static async get(req, res) {
    const result = await CommunitySiteService.get(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async save(req, res) {
    const result = await CommunitySiteService.save(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async setPublished(req, res) {
    const result = await CommunitySiteService.setPublished(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async renameSlug(req, res) {
    const result = await CommunitySiteService.renameSlug(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  /** Porta pública do site: `/c/<slug>`. Sem sessão, por definição. */
  static async getPublicBySlug(req, res) {
    const result = await CommunitySiteService.getPublicBySlug(req.params);
    return sendServiceResult(res, result);
  }

  /**
   * Upload de imagem do construtor.
   *
   * A ORDEM aqui importa: a permissão é checada ANTES de mandar os bytes para o
   * R2. Subir primeiro e perguntar depois deixaria qualquer usuário logado
   * gravar arquivo no bucket usando o id de uma comunidade alheia — o 403 viria
   * tarde demais, com o objeto já pago e armazenado.
   */
  static async uploadMedia(req, res) {
    const guard = await CommunitySiteService.assertCanUpload(req.user, req.params);
    if (guard?.error) return sendServiceResult(res, guard);

    if (!req.file) {
      return res.status(400).json({ error: "Envie uma imagem." });
    }

    const url = await uploadCommunitySiteAssetToR2({
      id_profile: req.params.id_profile,
      file: req.file,
    });

    // Devolve só a URL: quem decide em qual seção ela entra é o construtor, e
    // o autosave grava a árvore inteira logo em seguida.
    return res.status(201).json({ url });
  }
  /**
   * Próximo horário livre da equipe (agenda viva do cartão de chamada).
   *
   * Auth OPCIONAL, como a leitura do site: o visitante anônimo de comunidade
   * aberta vê, o líder vê dentro do construtor, e o forasteiro de comunidade
   * fechada recebe `slot: null` — quem recorta é o service.
   */
  static async getNextSlot(req, res) {
    const result = await CommunitySiteService.getNextSlot(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listProfessionals(req, res) {
    const result = await CommunitySiteService.listProfessionals(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async addProfessional(req, res) {
    const result = await CommunitySiteService.addProfessional(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async removeProfessional(req, res) {
    const result = await CommunitySiteService.removeProfessional(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = CommunitySiteController;
