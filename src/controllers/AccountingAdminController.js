const AccountingService = require("../services/AccountingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

// Painel de Contabilidade dos admins (mig 277). Controller fino: tudo que
// importa mora no AccountingService.
class AccountingAdminController {
  static async listCompanies(req, res) {
    return sendServiceResult(res, await AccountingService.listCompanies(), 200);
  }
  static async createCompany(req, res) {
    return sendServiceResult(res, await AccountingService.createCompany(req.user, req.body || {}), 201);
  }
  static async updateCompany(req, res) {
    return sendServiceResult(res, await AccountingService.updateCompany(req.params.id_company, req.body || {}), 200);
  }
  static async deleteCompany(req, res) {
    return sendServiceResult(res, await AccountingService.deleteCompany(req.params.id_company), 200);
  }
  static async dashboard(req, res) {
    return sendServiceResult(res, await AccountingService.dashboard(req.params.id_company), 200);
  }
  static async estimateDas(req, res) {
    return sendServiceResult(res, await AccountingService.estimateDas(req.params.id_company, req.query || {}), 200);
  }

  static async listEntries(req, res) {
    return sendServiceResult(res, await AccountingService.listEntries(req.params.id_company, req.query || {}), 200);
  }
  static async createEntry(req, res) {
    return sendServiceResult(res, await AccountingService.createEntry(req.user, req.params.id_company, req.body || {}), 201);
  }
  static async updateEntry(req, res) {
    return sendServiceResult(res, await AccountingService.updateEntry(req.params.id_company, req.params.id_entry, req.body || {}), 200);
  }
  static async deleteEntry(req, res) {
    return sendServiceResult(res, await AccountingService.deleteEntry(req.params.id_company, req.params.id_entry), 200);
  }

  static async listObligations(req, res) {
    return sendServiceResult(res, await AccountingService.listObligations(req.params.id_company, req.query || {}), 200);
  }
  static async createObligation(req, res) {
    return sendServiceResult(res, await AccountingService.createObligation(req.user, req.params.id_company, req.body || {}), 201);
  }
  static async updateObligation(req, res) {
    return sendServiceResult(res, await AccountingService.updateObligation(req.params.id_company, req.params.id_obligation, req.body || {}), 200);
  }
  static async setStatus(req, res) {
    return sendServiceResult(res, await AccountingService.setStatus(req.user, req.params.id_company, req.params.id_obligation, req.body || {}), 200);
  }
  static async deleteObligation(req, res) {
    return sendServiceResult(res, await AccountingService.deleteObligation(req.params.id_company, req.params.id_obligation), 200);
  }
  static async uploadReceipt(req, res) {
    return sendServiceResult(res, await AccountingService.uploadReceipt(req.params.id_company, req.params.id_obligation, req.file), 200);
  }
  static async receiptUrl(req, res) {
    return sendServiceResult(res, await AccountingService.receiptUrl(req.params.id_company, req.params.id_obligation), 200);
  }
  static async generateCalendar(req, res) {
    return sendServiceResult(res, await AccountingService.generateCalendar(req.user, req.params.id_company, req.body || {}), 200);
  }

  static async listSelic(req, res) {
    return sendServiceResult(res, await AccountingService.listSelic(), 200);
  }
  static async upsertSelic(req, res) {
    return sendServiceResult(res, await AccountingService.upsertSelic(req.body || {}), 200);
  }
  static async deleteSelic(req, res) {
    return sendServiceResult(res, await AccountingService.deleteSelic(req.params.month), 200);
  }
}

module.exports = AccountingAdminController;
