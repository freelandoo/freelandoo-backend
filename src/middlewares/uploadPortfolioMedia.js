// Upload de mídia de portfólio (post / Curto).
//
// A forma da porta — disco, três campos (`file`, `overlay`, `pip`) e limpeza
// dos temporários quando a resposta fecha — mora em `composeUpload.js`, que é
// compartilhado com a porta de story. Aqui ficam só os tipos aceitos.

const { createComposeUpload, MAX_UPLOAD_BYTES } = require("./composeUpload");

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const { upload, withComposeParts, isAllowedUploadType } = createComposeUpload({
  name: "uploadPortfolioMedia",
  mainField: "file",
  allowedTypes,
});

module.exports = upload;
module.exports.withComposeParts = withComposeParts;
module.exports.isAllowedUploadType = (mimetype) => isAllowedUploadType("file", mimetype);
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
