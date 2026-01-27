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

# 2. Install Python Tools (HAPUS break-system-packages KARENA BULLSEYE GAK PERLU)
RUN pip3 install yt-dlp gallery-dl speedtest-cli

# 3. Setup Folder Kerja
WORKDIR /usr/src/app

# 4. COPY SEMUA FILE DULU
COPY . .

# 5. 🔥 BERSIH-BERSIH TOTAL (Jurus Anti Gagal) 🔥
# Hapus node_modules & package-lock bawaan laptop biar gak ngerusak server
RUN rm -rf node_modules package-lock.json

# 6. INSTALL DARI NOL (Fresh Install)
RUN npm install

# 7. 🔥 JURUS PAKSA: Pastikan Jimp versi 0.16.13 (Biar Welcome/IQC Gak Error)
RUN npm uninstall jimp && npm install jimp@0.16.13

# 8. Buka Port & Jalankan
EXPOSE 8080
CMD ["node", "index.js"]