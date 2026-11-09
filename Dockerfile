# Imagem enxuta — evita a etapa apt-get do builder padrão (railpack),
# que estava falhando intermitentemente na infra do Railway com
# "No space left on device" durante apt-get install libatomic1.
# Versão EXATA (segurança 0A): etiqueta solta pegava o patch que o Railway tinha
# em cache. 22.23.4 = release de segurança de 2026-10-20. Subir à mão.
FROM node:22.23.4-slim

WORKDIR /app

# Instala deps primeiro pra aproveitar cache de layer.
# .npmrc junto: ignore-scripts=true (segurança 0B). Só bcrypt e ffmpeg-static
# rodam script (prebuild nativo e download do binário do ffmpeg); a conferência
# no fim derruba o build se algum dos dois não carregar.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm rebuild --ignore-scripts=false bcrypt ffmpeg-static && node -e "require('bcrypt').hashSync('x',4);require('fs').accessSync(require('ffmpeg-static'));require('sharp')"

# Copia o resto do projeto (respeitando .dockerignore).
COPY . .

ENV NODE_ENV=production

CMD ["npm", "start"]
