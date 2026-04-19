const ItemService = require("../services/ItemService");

class ItemController {
  static async getItens(req, res) {
    const result = await ItemService.list(req.query);
    return res.status(200).json(result);
  }

  static async getItemById(req, res) {
    const result = await ItemService.getById(req.params.id_item);
    return res.status(200).json(result);
  }

  static async createItem(req, res) {
    const result = await ItemService.create(req.user, req.body);
    return res.status(201).json(result);
  }

  static async updateItem(req, res) {
    const result = await ItemService.update(
      req.params.id_item,
      req.user,
      req.body
    );
    return res.status(200).json(result);
  }

  static async toggleItemActive(req, res) {
    const result = await ItemService.toggleActive(
      req.params.id_item,
      req.user,
      req.body.is_active
    );
    return res.status(200).json(result);
  }

  static async deleteItem(req, res) {
    const result = await ItemService.delete(req.params.id_item, req.user);
    return res.status(200).json(result);
  }
}

module.exports = ItemController;
