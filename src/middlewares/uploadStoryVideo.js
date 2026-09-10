// Upload de vídeo de story/bee pela porta multipart.
//
// Mesma forma da porta de portfólio (disco, campos `video`/`overlay`/`pip`,
// limpeza dos temporários quando a resposta fecha) — a mecânica mora em
// `composeUpload.js`, compartilhada, para que a limpeza não exista em uma porta
// e falte na outra.

const { createComposeUpload, MAX_UPLOAD_BYTES } = require("./composeUpload");

const allowedTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const { upload, withComposeParts, isAllowedUploadType } = createComposeUpload({
  name: "uploadStoryVideo",
  mainField: "video",
  allowedTypes,
});

module.exports = upload;
module.exports.withComposeParts = withComposeParts;
module.exports.isAllowedUploadType = (mimetype) => isAllowedUploadType("video", mimetype);
module.exports.MAX_UPLOAD_BYTES = MAX_UPLOAD_BYTES;
