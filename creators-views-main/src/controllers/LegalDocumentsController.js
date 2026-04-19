const LegalDocumentsService = require("../services/LegalDocumentsService");

class LegalDocumentsController {
  static async list(req, res) {
    const data = await LegalDocumentsService.list({
      document_type: req.query.type,
      active: req.query.active,
    });
    return res.json({ data });
  }

  static async getById(req, res) {
    const data = await LegalDocumentsService.getById(req.params.id);
    return res.json({ data });
  }

  static async getActiveByType(req, res) {
    const data = await LegalDocumentsService.getActiveByType(
      req.params.document_type
    );
    return res.json({ data });
  }

  static async create(req, res) {
    const data = await LegalDocumentsService.create({
      version: req.body?.version,
      document_type: req.body?.document_type,
      title: req.body?.title,
      content: req.body?.content,
      document_hash: req.body?.document_hash,
      created_by: req.user?.id_user || null,
    });
    return res.status(201).json({ data });
  }

  static async update(req, res) {
    const data = await LegalDocumentsService.update({
      id_legal_document: req.params.id,
      version: req.body?.version,
      document_type: req.body?.document_type,
      title: req.body?.title,
      content: req.body?.content,
      document_hash: req.body?.document_hash,
      updated_by: req.user?.id_user || null,
    });
    return res.json({ data });
  }

  static async activate(req, res) {
    const data = await LegalDocumentsService.activate({
      id_legal_document: req.params.id,
      published_by: req.user?.id_user || null,
    });
    return res.json({ data });
  }

  static async deactivate(req, res) {
    const data = await LegalDocumentsService.deactivate({
      id_legal_document: req.params.id,
      updated_by: req.user?.id_user || null,
    });
    return res.json({ data });
  }
}

module.exports = LegalDocumentsController;
