# Test sandbox for CodeXray repair runs. Tests run with --network none, so
# everything they need must be in the image. Build: docker build -t codexray-sandbox sandbox/
FROM python:3.11-slim
RUN pip install --no-cache-dir pytest==9.1.1
RUN useradd --create-home sandbox
USER sandbox
