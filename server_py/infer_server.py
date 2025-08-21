
import asyncio, json, time, os, io, sys
import websockets
import numpy as np
import onnxruntime as ort

try:
    import cv2
except Exception as e:
    cv2 = None

PORT = int(os.environ.get('PY_PORT', 7000))
MODEL_PATH = os.environ.get('MODEL_PATH', '/models/yolov5s.onnx')

session = None

def load_model():
    global session
    if ort is None:
        print("onnxruntime not available. Install it to enable server mode.", file=sys.stderr)
        return
    sess_opts = ort.SessionOptions()
    sess_opts.intra_op_num_threads = 1
    providers = ['CPUExecutionProvider']
    session = ort.InferenceSession(MODEL_PATH, sess_options=sess_opts, providers=providers)
    print("Model loaded:", MODEL_PATH, file=sys.stderr)

def preprocess_bgr(img, size=320):
    h, w = img.shape[:2]
    scale = min(size/w, size/h)
    nw, nh = int(w*scale), int(h*scale)
    x0, y0 = (size-nw)//2, (size-nh)//2
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas[y0:y0+nh, x0:x0+nw] = resized
    # to NCHW float32 [0,1]
    x = canvas.astype(np.float32) / 255.0
    x = np.transpose(x, (2,0,1))[None, ...]
    return x, (x0, y0, scale, size, w, h)

def postprocess_yolo(outputs, meta):
    # naive decode like in the browser; model-specific
    out0 = outputs[0]
    data = out0 if isinstance(out0, np.ndarray) else out0.numpy()
    if data.ndim == 3:
        data = data[0]
    detections = []
    # COCO class names for YOLOv5
    class_names = [
        "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
        "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
        "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
        "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
        "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
        "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
        "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
        "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
        "hair drier", "toothbrush"
    ]
    for row in data:
        obj = row[4]
        if obj < 0.3: continue
        cls = np.argmax(row[5:])
        score = obj * row[5+cls]
        if score < 0.5: continue
        cx, cy, w, h = row[0], row[1], row[2], row[3]
        x0, y0, scale, size, W, H = meta
        # Convert box from padded/normalized to original image pixel coordinates
        xmin = (cx - w/2 - x0) / scale
        ymin = (cy - h/2 - y0) / scale
        xmax = (cx + w/2 - x0) / scale
        ymax = (cy + h/2 - y0) / scale
        # Normalize to [0,1] for API contract
        xmin = max(0, min(1, xmin / W))
        ymin = max(0, min(1, ymin / H))
        xmax = max(0, min(1, xmax / W))
        ymax = max(0, min(1, ymax / H))
        detections.append({
            "label": class_names[cls] if cls < len(class_names) else str(cls),
            "score": float(score),
            "xmin": xmin,
            "ymin": ymin,
            "xmax": xmax,
            "ymax": ymax
        })
    return detections

async def handler(ws):
    print("Client connected")
    async for message in ws:
        if isinstance(message, (bytes, bytearray)):
            # Expect header JSON + \n\n + JPEG bytes
            b = bytes(message)
            sp = b.find(b"\n\n")
            if sp == -1:
                continue
            header = json.loads(b[:sp].decode('utf-8'))
            jpeg = b[sp+2:]
            recv_ts = int(time.time()*1000)
            # decode jpeg
            if cv2 is None:
                continue
            arr = np.frombuffer(jpeg, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            x, meta = preprocess_bgr(img, 320)
            inference_ts = int(time.time()*1000)
            detections = []
            if session is not None:
                t0 = time.time()
                outs = session.run(None, {"images": x})
                inference_ts = int(time.time()*1000)
                detections = postprocess_yolo(outs, meta)
            payload = {
                "frame_id": header.get("frame_id"),
                "capture_ts": header.get("capture_ts"),
                "recv_ts": recv_ts,
                "inference_ts": inference_ts,
                "detections": detections
            }
            await ws.send(json.dumps(payload))
        else:
            # ignore text for now
            pass

async def main():
    load_model()
    async with websockets.serve(handler, "0.0.0.0", PORT, max_size=10*1024*1024):
        print(f"[py] inference WS on :{PORT}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
