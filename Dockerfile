# Image unique, volontairement simple : une seule chose à comprendre le jour où
# il faudra la relire. tsx reste nécessaire à l'exécution, donc rien n'est élagué.
FROM node:22-alpine

WORKDIR /app

# Les dépendances d'abord : elles changent rarement, et leur couche est réutilisée
# à chaque déploiement qui ne touche qu'au code.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

# Les données vivent sur un disque monté ici, pas dans l'image : l'image est
# remplacée à chaque déploiement, le disque non.
ENV BUDGET_DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
