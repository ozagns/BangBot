FROM node:20-bullseye

# 1. Install Pisau Dapur (ImageMagick, FFmpeg, Python)
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    python3 \
    python3-pip && \
    rm -rf /var/lib/apt/lists/*

# 2. Trik Sulap:
# - Ubah 'convert' jadi 'magick'
# - Ubah 'python3' jadi 'python' (biar command 'python' jalan)
RUN ln -s /usr/bin/convert /usr/bin/magick && \
    ln -s /usr/bin/python3 /usr/bin/python

# 3. Jebol Security Policy ImageMagick (Buat fitur Brat)
RUN sed -i 's/rights="none" pattern="@\*"/rights="read|write" pattern="@*"/' /etc/ImageMagick-6/policy.xml

# 4. Install Speedtest CLI (Buat fitur Speedtest)
RUN pip install speedtest-cli

# 5. Siapkan Folder
WORKDIR /usr/src/app

# 6. Copy & Install
COPY package*.json ./
RUN npm install

# 7. Masukkan sisa file
COPY . .

# 8. Jalankan
CMD ["node", "index.js"]