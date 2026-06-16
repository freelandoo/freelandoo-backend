const CommunityService = require("../services/CommunityService");
const CommunitySlotService = require("../services/CommunitySlotService");
const CommunityLeadershipService = require("../services/CommunityLeadershipService");
const { sendServiceResult } = require("../utils/sendServiceResult");
const uploadCommunityBannerToR2 = require("../integrations/r2/uploadCommunityBanner");
const uploadProfileAvatarToR2 = require("../integrations/r2/uploadProfileAvatar");

class CommunityController {
  static async createSlotCheckout(req, res) {
    const result = await CommunitySlotService.createCheckout(req.user);
    return sendServiceResult(res, result, 201);
  }

  static async listPendingVotes(req, res) {
    const result = await CommunityLeadershipService.listPending(req.user);
    return sendServiceResult(res, result);
  }

  static async castBallot(req, res) {
    const result = await CommunityLeadershipService.castBallot(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result, 201);
  }

  static async create(req, res) {
    const result = await CommunityService.create(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async getById(req, res) {
    const result = await CommunityService.getById(req.params);
    return sendServiceResult(res, result);
  }

  static async listPublic(req, res) {
    const result = await CommunityService.listPublic(req.query);
    return sendServiceResult(res, result);
  }

  static async listMine(req, res) {
    const result = await CommunityService.listMine(req.user);
    return sendServiceResult(res, result);
  }

  static async getMembers(req, res) {
    const result = await CommunityService.getMembers(req.params);
    return sendServiceResult(res, result);
  }

  static async getFeed(req, res) {
    const result = await CommunityService.getFeed(req.params, req.query);
    return sendServiceResult(res, result);
  }

  static async getCreationEligibility(req, res) {
    const result = await CommunityService.getCreationEligibility(req.user);
    return sendServiceResult(res, result);
  }

  static async updateTheme(req, res) {
    const result = await CommunityService.updateTheme(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async updateProfile(req, res) {
    const result = await CommunityService.updateProfile(
      req.user,
      req.params,
      req.body || {}
    );
    return sendServiceResult(res, result);
  }

  static async uploadBanner(req, res) {
    if (!req.file) {
      return res.status(400).json({ error: "Envie uma imagem de banner." });
    }
    const url = await uploadCommunityBannerToR2({
      id_profile: req.params.id_profile,
      file: req.file,
    });
    const result = await CommunityService.setBanner(req.user, req.params, url);
    return sendServiceResult(res, result);
  }

  static async uploadAvatar(req, res) {
    if (!req.file) {
      return res.status(400).json({ error: "Envie uma imagem de avatar." });
    }
    const url = await uploadProfileAvatarToR2({
      id_profile: req.params.id_profile,
      file: req.file,
    });
    const result = await CommunityService.setAvatar(req.user, req.params, url);
    return sendServiceResult(res, result);
  }

  static async getFeedPosts(req, res) {
    const result = await CommunityService.getFeedPosts(req.params, req.query, req.user);
    return sendServiceResult(res, result);
  }

  static async linkFeedItem(req, res) {
    const result = await CommunityService.linkFeedItem(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async unlinkFeedItem(req, res) {
    const result = await CommunityService.unlinkFeedItem(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async getBenchmark(req, res) {
    const result = await CommunityService.getBenchmark(req.params);
    return sendServiceResult(res, result);
  }

  static async getGoal(req, res) {
    const result = await CommunityService.getGoal(req.params);
    return sendServiceResult(res, result);
  }

  static async setGoal(req, res) {
    const result = await CommunityService.setGoal(req.user, req.params, req.body || {});
    return sendServiceResult(res, result);
  }

  static async clearGoal(req, res) {
    const result = await CommunityService.clearGoal(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async listAnnouncements(req, res) {
    const result = await CommunityService.listAnnouncements(req.params);
    return sendServiceResult(res, result);
  }

  static async createAnnouncement(req, res) {
    const result = await CommunityService.createAnnouncement(req.user, req.params, req.body || {});
    return sendServiceResult(res, result, 201);
  }

  static async deleteAnnouncement(req, res) {
    const result = await CommunityService.deleteAnnouncement(req.user, req.params);
    return sendServiceResult(res, result);
  }

  static async join(req, res) {
    const result = await CommunityService.join(req.user, req.params);
    return sendServiceResult(res, result, 201);
  }

  static async leave(req, res) {
    const result = await CommunityService.leave(req.user, req.params);
    return sendServiceResult(res, result);
  }
}

module.exports = CommunityController;
