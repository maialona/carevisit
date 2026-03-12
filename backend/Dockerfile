FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN apt-get update && apt-get install -y fonts-wqy-microhei && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Initialize DB when the container starts
EXPOSE 8000
CMD ["sh", "-c", "python seed.py || true && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
