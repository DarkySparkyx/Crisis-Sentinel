FROM python:3.12-slim

WORKDIR /simulator

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY simulate_reports.py .

ENTRYPOINT ["python", "simulate_reports.py"]
