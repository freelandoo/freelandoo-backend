# Imagem enxuta — evita a etapa apt-get do builder padrão (railpack),
# que estava falhando intermitentemente na infra do Railway com
# "No space left on device" durante apt-get install libatomic1.
# Versão EXATA (segurança 0A): etiqueta solta pegava o patch que o Railway tinha
# em cache. 22.23.4 = release de segurança de 2026-10-20. Subir à mão.
FROM node:22.23.4-slim

WORKDIR /app

# Instala deps primeiro pra aproveitar cache de layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copia o resto do projeto (respeitando .dockerignore).
COPY . .

ENV NODE_ENV=production

CMD ["npm", "start"]
