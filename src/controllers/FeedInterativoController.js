// Feed Interativo (migs 456+): HTTP fino — regra no FeedInterativoService.
const FeedInterativoService = require("../services/FeedInterativoService");
const { sendServiceResult } = require("../utils/sendServiceResult");

const wrap = (fn) => async (req, res) => sendServiceResult(res, await fn(req));

module.exports = {
  links: wrap((req) => FeedInterativoService.listLinks(req.user)),
  invite: wrap((req) => FeedInterativoService.invite(req.user, req.body || {})),
  act: wrap((req) => FeedInterativoService.act(req.user, req.params.id_link, req.params.action)),
  getPrefs: wrap((req) => FeedInterativoService.getPrefs(req.user)),
  setPrefs: wrap((req) => FeedInterativoService.setPrefs(req.user, req.body || {})),
  targets: wrap((req) => FeedInterativoService.targets(req.user)),
  throwPost: wrap((req) => FeedInterativoService.throwPost(req.user, req.body || {})),
  inbox: wrap((req) => FeedInterativoService.inbox(req.user)),
  seen: wrap((req) => FeedInterativoService.markSeen(req.user, req.body || {})),
};
