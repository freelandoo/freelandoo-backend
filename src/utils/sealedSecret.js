// src/utils/sealedSecret.js — Segurança A6: segredo de assinatura guardado SELADO (secretBox), com
// leitura de valor antigo em texto puro (antes da A6). `open` aceita os dois; `isSealed` diz se a
// linha ainda precisa ser selada (quem lê pode selar na hora — sem script manual).
const secretBox = require("./secretBox");

function isSealed(value) {
  return typeof value === "string" && value.startsWith("v1:");
}

function seal(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  return isSealed(plain) ? plain : secretBox.seal(plain);
}

function open(value) {
  if (value === null || value === undefined || value === "") return null;
  return isSealed(value) ? secretBox.open(value) : String(value);
}

module.exports = { seal, open, isSealed };
