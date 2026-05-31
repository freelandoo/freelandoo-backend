const AudioTrackService = require("../services/AudioTrackService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class AudioTrackController {
  // Público — picker de música do composer
  static async listPublic(req, res) {
    return sendServiceResult(res, await AudioTrackService.listPublic({ q: req.query?.q }));
  }

  // Admin
  static async adminList(req, res) {
    return sendServiceResult(res, await AudioTrackService.adminList({ q: req.query?.q }));
  }

  static async adminGet(req, res) {
    return sendServiceResult(res, await AudioTrackService.adminGet(req.params.id));
  }

  static async adminCreate(req, res) {
    return sendServiceResult(res, await AudioTrackService.adminCreate(req.body || {}, req.files), 201);
  }

  static async adminUpdate(req, res) {
    return sendServiceResult(res, await AudioTrackService.adminUpdate(req.params.id, req.body || {}, req.files));
  }

  static async adminRemove(req, res) {
    return sendServiceResult(res, await AudioTrackService.adminRemove(req.params.id));
  }
}

module.exports = AudioTrackController;
