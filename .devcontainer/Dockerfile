FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    JAVA_HOME="/usr/lib/jvm/java-21-openjdk"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    libgl1 \
    libglib2.0-0 \
    libharfbuzz0b \
    libopengl0 \
    libosmesa6 \
    openjdk-21-jre-headless \
    && ln -s /usr/lib/jvm/java-21-openjdk-* /usr/lib/jvm/java-21-openjdk \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
RUN case "${TARGETARCH}" in \
    "amd64") ARCH="x86_64"  ;; \
    "arm64") ARCH="aarch64" ;; \
    *)       echo "Unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-${ARCH}.sh" \
    -o /tmp/miniforge.sh && \
    bash /tmp/miniforge.sh -b -p /opt/conda && \
    rm /tmp/miniforge.sh && \
    /opt/conda/bin/conda install -y pythonocc-core && \
    /opt/conda/bin/conda clean -afy

COPY requirements.lock /tmp/

RUN CONDA_PY=$(/opt/conda/bin/python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')") \
    && /opt/conda/bin/python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.lock \
    && /opt/venv/bin/pip install --no-cache-dir pytest \
    && echo "/opt/conda/lib/python${CONDA_PY}/site-packages" \
    > /opt/venv/lib/python${CONDA_PY}/site-packages/occ_conda.pth \
    && npm install --ignore-scripts -g typescript@5.9.3 sass@1.99.0

WORKDIR /workspace
