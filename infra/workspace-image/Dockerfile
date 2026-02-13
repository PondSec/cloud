FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    python3-debugpy \
    build-essential gcc g++ clang clangd \
    git curl ca-certificates bash \
    shellcheck ripgrep \
    golang-go gopls \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3 /usr/local/bin/python

RUN npm install -g \
    typescript \
    typescript-language-server \
    pyright \
    vscode-langservers-extracted \
    yaml-language-server \
    bash-language-server \
    dockerfile-language-server-nodejs \
    intelephense \
    sql-language-server \
    @tailwindcss/language-server

RUN if ! id -u coder >/dev/null 2>&1; then useradd -m -u 1000 coder || useradd -m coder; fi
USER coder
WORKDIR /workspaces

CMD ["sleep", "infinity"]
