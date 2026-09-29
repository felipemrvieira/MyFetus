# Usa Debian Slim que possui glibc nativo, exigido pelo ONNX Runtime
FROM node:20-slim

WORKDIR /app

# Instalar dependências do sistema usando apt-get (Debian) em vez de apk (Alpine)
RUN apt-get update && apt-get install -y python3 make g++ bash git && rm -rf /var/lib/apt/lists/*

# Copiar apenas os arquivos de dependência
COPY package.json package-lock.json ./

# Instalar dependências
RUN npm ci

# Copiar o resto do código da aplicação
COPY . .

# Permitir execução
RUN chmod -R 777 /app

EXPOSE 3000

# Comando padrão de inicialização
CMD ["npm", "run", "dev"]
