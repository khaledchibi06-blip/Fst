FROM node:22-alpine
WORKDIR /app
COPY package.json config.js server.js xlsx.js notion.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
