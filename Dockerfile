FROM node:26-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src/ ./src/
RUN npx --ignore-scripts tsc \
    && npx --ignore-scripts sass src/styles/style.scss:static/style.css --style=expanded --no-source-map

FROM ghcr.io/toomas633/meshforge-base:occt7.9.3-py3.14

ADD https://bootstrap.pypa.io/get-pip.py /opt/get-pip.py
WORKDIR /app
COPY requirements.lock ./
RUN /usr/bin/python3.14 -m venv --without-pip /opt/venv \
    && /opt/venv/bin/python /opt/get-pip.py --quiet \
    && echo '/opt/pythonocc' \
    > /opt/venv/lib/python3.14/site-packages/occ.pth \
    && /opt/venv/bin/pip install --no-cache-dir --only-binary :all: -r requirements.lock

COPY src/app.py src/mesh_pipeline.py ./src/
COPY src/index.html ./src/index.html
COPY src/assets/ ./src/assets/
COPY --from=frontend /build/static ./static
RUN mkdir -p jobs
EXPOSE 5000
ENV FLASK_APP=src/app.py \
    PATH="/opt/venv/bin:$PATH"
CMD ["python3", "-m", "flask", "run", "--host=0.0.0.0", "--port=5000"]
