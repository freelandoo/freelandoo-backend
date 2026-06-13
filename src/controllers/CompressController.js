const CompressService = require("../services/CompressService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class CompressController {
  // Passo 1 — presigned PUT pro R2 (temp-compress/).
  static async createUploadUrl(req, res) {
    const result = await CompressService.createUploadUrl(req.user, req.body || {});
    return sendServiceResult(res, result);
  }

  // Passo 2 — comprime no servidor e devolve link de download.
  static async processFromUpload(req, res) {
    const result = await CompressService.processFromUpload(req.user, req.body || {});
    return sendServiceResult(res, result);
  }
}

module.exports = CompressController;
