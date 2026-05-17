const pool = require("../databases");
const BookmarkStorage = require("../storages/BookmarkStorage");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIds(raw) {
  const value = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID_RE.test(id));
}

module.exports = {
  async listFolders(req, res) {
    const folders = await BookmarkStorage.listFolders(pool, req.user.id_user);
    return res.json(folders);
  },

  async createFolder(req, res) {
    const folder = await BookmarkStorage.createFolder(pool, {
      id_user: req.user.id_user,
      name: req.body?.name,
    });
    return res.status(201).json(folder);
  },

  async toggle(req, res) {
    const id_portfolio_item = String(req.body?.post_id || req.body?.id_portfolio_item || "").trim();
    const id_folder = req.body?.id_folder || null;
    if (!UUID_RE.test(id_portfolio_item)) {
      return res.status(400).json({ error: "post_id invalido" });
    }
    if (id_folder && !UUID_RE.test(String(id_folder))) {
      return res.status(400).json({ error: "id_folder invalido" });
    }

    const result = await BookmarkStorage.toggle(pool, {
      id_user: req.user.id_user,
      id_portfolio_item,
      id_folder,
    });
    return res.json(result);
  },

  async status(req, res) {
    const ids = parseIds(req.query.ids);
    const bookmarked = await BookmarkStorage.status(pool, {
      id_user: req.user.id_user,
      ids,
    });
    return res.json({ bookmarked });
  },
};
