
FROM python:3.11-slim
WORKDIR /app
# System deps for onnxruntime & opencv
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY server_py/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server_py ./server_py
# Model volume mounted at /models
EXPOSE 7000
ENV PY_PORT=7000 MODEL_PATH=/models/yolov5n.onnx
CMD ["python","-u","server_py/infer_server.py"]
