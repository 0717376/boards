FROM node:20-alpine
WORKDIR /app
COPY server-package.json package.json
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY dist ./dist
ENV PORT=3199 DATA_DIR=/data
EXPOSE 3199
VOLUME /data
CMD ["node", "server.js"]
