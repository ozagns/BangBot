FROM node:20-bullseye

# 1. Install System Dependencies & Python
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Setup Symlinks (Biar command 'python' dan 'magick' jalan)
RUN ln -s /usr/bin/convert /usr/bin/magick && \
    ln -s /usr/bin/python3 /usr/bin/python

# 3. Install Python Tools (Bagian Paling Penting!)
# yt-dlp: Download YouTube/TikTok
# gallery-dl: Download IG/Pinterest
# rembg: Hapus Background
# speedtest-cli: Cek sinyal
RUN pip install yt-dlp gallery-dl rembg[cli] speedtest-cli

# 4. Jebol Security Policy ImageMagick (Biar fitur Brat jalan)
RUN sed -i 's/rights="none" pattern="@\*"/rights="read|write" pattern="@*"/' /etc/ImageMagick-6/policy.xml

# 5. Setup App
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

# 6. Jalankan
CMD ["node", "index.js"]