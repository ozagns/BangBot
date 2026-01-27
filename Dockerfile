FROM node:20-bullseye

# 1. Install Aplikasi Pendukung
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    libreoffice \
    poppler-utils \
    python3 \
    python3-pip \
    zbar-tools \
    iputils-ping && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 2. Install Python Tools
RUN pip3 install yt-dlp gallery-dl speedtest-cli

# 3. Setup Folder Kerja
WORKDIR /usr/src/app

# 4. Copy Semua File
COPY . .

# 5. Bersih-bersih file sampah dari laptop
RUN rm -rf node_modules package-lock.json

# 6. 🔥 INSTALL DENGAN MODE 'BODO AMAT' (Fix ERESOLVE) 🔥
# --legacy-peer-deps = Abaikan warning konflik versi dari Baileys
RUN npm install --legacy-peer-deps

# 7. Pastikan Jimp versi 0.16.13 terinstall kuat
RUN npm uninstall jimp && npm install jimp@0.16.13 --legacy-peer-deps

# 8. Jalankan
EXPOSE 8080
CMD ["node", "index.js"]