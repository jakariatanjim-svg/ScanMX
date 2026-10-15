"""
Train the built-in text enhancer used by Smart clean.

The model is a tiny residual CNN (3 convolution layers, 6 hidden channels, about
400 weights). It learns to map a blurred, low-contrast, noisy page crop back to
its crisp version. Training data is synthetic: text is rendered with DejaVu fonts,
then degraded with blur, downscaling, contrast loss, uneven light and noise.

Only numpy and Pillow are needed. Gradients are written by hand, so no deep
learning framework is required.

Usage:
    python3 tools/text-enhancer/train_text_enhancer.py

Outputs:
    src/model/text-enhancer.js            weights loaded by the app (JS module)
    test/fixtures/text-enhancer-golden.json  reference output for the JS tests
"""

import json
import random
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT_MODEL = ROOT / "src" / "model" / "text-enhancer.js"
OUT_GOLDEN = ROOT / "test" / "fixtures" / "text-enhancer-golden.json"

SEED = 7
HIDDEN = 6
PATCH = 40
PAGE = 160
PAGES = 700
CROPS_PER_PAGE = 8
ITERATIONS = 12000
# Halo penalty: output may not exceed the clean local maximum or fall below the clean local minimum.
HALO_WEIGHT = 0.5
BATCH = 64

FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
]
ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:-()"

rng = np.random.default_rng(SEED)
random.seed(SEED)


# Text scales: the same page content at different pixel sizes. Real phone photos have
# text (and blur) several times larger than the smallest training pages, so the model
# must see all of them.
TEXT_SCALES = [1.0, 1.5, 2.0, 2.5, 3.0]


def render_page(scale=1.0):
    """A crisp page of random text lines. Some pages are blank paper."""
    paper = rng.uniform(0.86, 1.0)
    img = Image.new("L", (PAGE, PAGE), int(paper * 255))
    if rng.uniform() < 0.1:
        return np.asarray(img, np.float32) / 255.0
    draw = ImageDraw.Draw(img)
    ink = rng.uniform(0.0, 0.3)
    y = int(rng.integers(4, 12) * scale)
    while y < PAGE - 10:
        size = int(rng.integers(9, 20) * scale)
        font = ImageFont.truetype(random.choice(FONTS), size)
        x = int(rng.integers(3, 12) * scale)
        while x < PAGE - 8:
            word = "".join(random.choice(ALPHABET) for _ in range(random.randint(1, 7)))
            draw.text((x, y), word, font=font, fill=int(ink * 255))
            x += draw.textlength(word, font=font) + size * rng.uniform(0.3, 0.8)
        y += int(size * rng.uniform(1.3, 1.8))
    return np.asarray(img, np.float32) / 255.0


def degrade(clean, scale=1.0):
    """Make a low-quality version of a crisp page. Blur grows with the text scale."""
    h, w = clean.shape
    img = Image.fromarray((clean * 255).astype(np.uint8))
    resample = rng.uniform(1.0, 1.8)
    if resample > 1.05:
        small = img.resize((max(8, round(w / resample)), max(8, round(h / resample))), Image.BILINEAR)
        img = small.resize((w, h), Image.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.5) * scale))
    x = np.asarray(img, np.float32) / 255.0
    paper = float(clean.max())
    x = x * (1 - rng.uniform(0, 0.3)) + paper * rng.uniform(0, 0.25)  # faded ink
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    slope = rng.uniform(-1, 1, size=2) * rng.uniform(0, 0.25)
    light = 1 - (slope[0] * (xx / w - 0.5) + slope[1] * (yy / h - 0.5))
    x = x * light
    x = x + rng.normal(0, rng.uniform(0, 0.035), size=x.shape).astype(np.float32)
    return np.clip(x, 0, 1).astype(np.float32)


def make_dataset():
    """Training pairs are sharpened crops; raw degraded crops are kept for honest validation."""
    inputs, targets, raws = [], [], []
    for _ in range(PAGES):
        scale = float(rng.choice(TEXT_SCALES))
        clean = render_page(scale)
        raw_page = degrade(clean, scale)
        sharp_page = sharpen(raw_page)
        for _ in range(CROPS_PER_PAGE):
            y = int(rng.integers(0, PAGE - PATCH))
            x = int(rng.integers(0, PAGE - PATCH))
            inputs.append(sharp_page[y:y + PATCH, x:x + PATCH])
            raws.append(raw_page[y:y + PATCH, x:x + PATCH])
            targets.append(clean[y:y + PATCH, x:x + PATCH])
    inputs = np.stack(inputs)[:, None]
    raws = np.stack(raws)[:, None]
    targets = np.stack(targets)[:, None]
    order = rng.permutation(len(inputs))
    split = int(len(inputs) * 0.9)
    tr, va = order[:split], order[split:]
    return (inputs[tr], targets[tr]), (inputs[va], targets[va]), raws[va]


# ---- network -------------------------------------------------------------

def conv_forward(inp, weight, bias):
    # Edge-replicate padding: a zero border would read as black ink at page edges.
    n, _, h, w = inp.shape
    pad = np.pad(inp, ((0, 0), (0, 0), (1, 1), (1, 1)), mode="edge")
    out = np.broadcast_to(bias.reshape(1, -1, 1, 1), (n, weight.shape[0], h, w)).copy()
    for dy in range(3):
        for dx in range(3):
            out += np.einsum("nchw,oc->nohw", pad[:, :, dy:dy + h, dx:dx + w], weight[:, :, dy, dx])
    return out


def conv_backward(dout, inp, weight):
    n, _, h, w = inp.shape
    pad = np.pad(inp, ((0, 0), (0, 0), (1, 1), (1, 1)), mode="edge")
    dpad = np.zeros_like(pad)
    dweight = np.zeros_like(weight)
    for dy in range(3):
        for dx in range(3):
            patch = pad[:, :, dy:dy + h, dx:dx + w]
            dweight[:, :, dy, dx] = np.einsum("nohw,nchw->oc", dout, patch)
            dpad[:, :, dy:dy + h, dx:dx + w] += np.einsum("nohw,oc->nchw", dout, weight[:, :, dy, dx])
    dbias = dout.sum(axis=(0, 2, 3))
    # Fold the padded-border gradients back onto the edge pixels they were copied from.
    rows = np.clip(np.arange(-1, h + 1), 0, h - 1)
    cols = np.clip(np.arange(-1, w + 1), 0, w - 1)
    dinp = np.zeros_like(inp)
    np.add.at(dinp, (slice(None), slice(None), rows[:, None], cols[None, :]), dpad)
    return dinp, dweight, dbias


def init_params():
    def he(shape):
        fan_in = shape[1] * 9
        return rng.normal(0, np.sqrt(2.0 / fan_in), size=shape).astype(np.float32)
    return {
        "w1": he((HIDDEN, 1, 3, 3)), "b1": np.zeros(HIDDEN, np.float32),
        "w2": he((HIDDEN, HIDDEN, 3, 3)), "b2": np.zeros(HIDDEN, np.float32),
        "w3": he((1, HIDDEN, 3, 3)) * 0.1, "b3": np.zeros(1, np.float32),
    }


def forward(params, x, keep=False):
    a1 = conv_forward(x, params["w1"], params["b1"])
    r1 = np.maximum(a1, 0)
    a2 = conv_forward(r1, params["w2"], params["b2"])
    r2 = np.maximum(a2, 0)
    residual = conv_forward(r2, params["w3"], params["b3"])
    raw = x + residual
    y = np.clip(raw, 0, 1)
    if keep:
        return y, (x, a1, r1, a2, r2, raw)
    return y


def local_extreme(x, fn):
    """3x3 max or min over the last two axes, with edge replication."""
    h, w = x.shape[-2:]
    padded = np.pad(x, [(0, 0)] * (x.ndim - 2) + [(1, 1), (1, 1)], mode="edge")
    out = x.copy()
    for dy in range(3):
        for dx in range(3):
            out = fn(out, padded[..., dy:dy + h, dx:dx + w])
    return out


def train(params, train_set):
    inputs, targets = train_set
    upper = local_extreme(targets, np.maximum)
    lower = local_extreme(targets, np.minimum)
    m = {k: np.zeros_like(v) for k, v in params.items()}
    v = {k: np.zeros_like(p) for k, p in params.items()}
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    count = len(inputs)
    start = time.time()
    for step in range(1, ITERATIONS + 1):
        lr = 3e-3 * (0.05 ** (step / ITERATIONS))
        idx = rng.integers(0, count, size=BATCH)
        x, t = inputs[idx], targets[idx]
        y, (x0, a1, r1, a2, r2, raw) = forward(params, x, keep=True)
        grad_y = 2 * (y - t) / t.size
        grad_y = grad_y * ((raw > 0) & (raw < 1))  # no gradient through clipped values
        # Halo penalty on the clean local range. It acts on the batch rows picked above.
        up = upper[idx]
        low = lower[idx]
        over = np.maximum(y - up, 0)
        under = np.maximum(low - y, 0)
        grad_y = grad_y + HALO_WEIGHT * 2 * (over - under) / t.size
        d_r2, dw3, db3 = conv_backward(grad_y, r2, params["w3"])
        d_a2 = d_r2 * (a2 > 0)
        d_r1, dw2, db2 = conv_backward(d_a2, r1, params["w2"])
        d_a1 = d_r1 * (a1 > 0)
        _, dw1, db1 = conv_backward(d_a1, x0, params["w1"])
        grads = {"w1": dw1, "b1": db1, "w2": dw2, "b2": db2, "w3": dw3, "b3": db3}
        for k in params:
            m[k] = beta1 * m[k] + (1 - beta1) * grads[k]
            v[k] = beta2 * v[k] + (1 - beta2) * grads[k] ** 2
            m_hat = m[k] / (1 - beta1 ** step)
            v_hat = v[k] / (1 - beta2 ** step)
            params[k] -= lr * m_hat / (np.sqrt(v_hat) + eps)
        if step % 1500 == 0:
            val_loss = float(np.mean((forward(params, train_set_val[0][:512]) - train_set_val[1][:512]) ** 2))
            print(f"step {step:5d}  batch mse {float(np.mean((y - t) ** 2)):.5f}  val mse {val_loss:.5f}  {time.time() - start:.0f}s", flush=True)
    return params


def psnr(a, b):
    mse = float(np.mean((a - b) ** 2)) + 1e-12
    return 10 * np.log10(1.0 / mse)


SHARPEN_SIGMA = 2.0
SHARPEN_AMOUNT = 1.5


def gaussian_kernel(sigma):
    radius = int(np.ceil(3 * sigma))
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-(offsets ** 2) / (2 * sigma * sigma))
    return kernel / kernel.sum()


def gaussian_blur(img):
    """Separable Gaussian on a (..., H, W) array with edge-clamped borders."""
    kernel = gaussian_kernel(SHARPEN_SIGMA)
    radius = (len(kernel) - 1) // 2
    h, w = img.shape[-2:]
    padded = np.pad(img, [(0, 0)] * (img.ndim - 2) + [(radius, radius), (radius, radius)], mode="edge")
    tmp = sum(kernel[k] * padded[..., k:k + h, :] for k in range(len(kernel)))
    return sum(kernel[k] * tmp[..., :, k:k + w] for k in range(len(kernel)))


def sharpen(img):
    """Unsharp mask on a (..., H, W) array."""
    blur = gaussian_blur(img)
    return np.clip(img + SHARPEN_AMOUNT * (img - blur), 0, 1).astype(np.float32)


# Inference-time gate: the correction is applied only where the page has local detail.
# Flat areas (paper, plain grey, shadows) are left exactly as they are.
GATE_SCALE = 0.01


def enhance(plane, weights):
    """Full pipeline on one (H, W) plane: sharpen, network residual, detail gate."""
    sharp = sharpen(plane)
    detail = np.abs(sharp - gaussian_blur(sharp))
    gate = np.clip(detail / GATE_SCALE, 0, 1)
    full = forward(weights, sharp[None, None])[0, 0]
    return np.clip(sharp + (full - sharp) * gate, 0, 1).astype(np.float32)


def export(params, metrics):
    OUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
    layers = []
    for name in ("1", "2", "3"):
        weight = params["w" + name]
        bias = params["b" + name]
        layers.append({
            "shape": list(weight.shape),
            "weight": [round(float(value), 4) for value in weight.reshape(-1)],
            "bias": [round(float(value), 4) for value in bias.reshape(-1)],
        })
    model = {
        "name": "scanmx-text-enhancer",
        "version": 1,
        "description": "Tiny residual CNN that sharpens blurred or faded text. Trained on synthetic pages.",
        "activation": "relu",
        "residual": True,
        "sharpen": {"sigma": SHARPEN_SIGMA, "amount": SHARPEN_AMOUNT},
        "layers": layers,
        "metrics": metrics,
    }
    body = json.dumps(model, separators=(",", ":"), indent=None)
    OUT_MODEL.write_text(
        "// Generated by tools/text-enhancer/train_text_enhancer.py. Do not edit by hand.\n"
        f"export default {body};\n",
        encoding="utf-8",
    )
    print("wrote", OUT_MODEL, OUT_MODEL.stat().st_size, "bytes")


def export_golden(params):
    """A fixed input and the numpy output, so the JS forward pass can be checked against it."""
    raw = np.linspace(0, 1, 36, dtype=np.float32).reshape(6, 6)
    y = enhance(raw, params)
    OUT_GOLDEN.parent.mkdir(parents=True, exist_ok=True)
    OUT_GOLDEN.write_text(json.dumps({
        "width": 6,
        "height": 6,
        "input": [round(float(v), 6) for v in raw.reshape(-1)],
        "output": [round(float(v), 6) for v in y.reshape(-1)],
    }) + "\n", encoding="utf-8")
    print("wrote", OUT_GOLDEN)


def main():
    global train_set_val
    print("building synthetic dataset ...", flush=True)
    train_set, val_set, val_raw = make_dataset()
    train_set_val = val_set
    print("train", len(train_set[0]), "val", len(val_set[0]), flush=True)

    params = init_params()
    params = train(params, train_set)
    # Round to the precision stored in the app, so the JS and the metrics use the same weights.
    params = {key: np.round(value, 4).astype(np.float32) for key, value in params.items()}

    val_x, val_t = val_set
    enhanced = np.stack([enhance(x[0], params)[None] for x in val_raw])
    metrics = {
        "psnr_degraded": round(float(np.mean([psnr(a, b) for a, b in zip(val_raw, val_t)])), 2),
        "psnr_sharpen_only": round(float(np.mean([psnr(a, b) for a, b in zip(val_x, val_t)])), 2),
        "psnr_enhancer": round(float(np.mean([psnr(a, b) for a, b in zip(enhanced, val_t)])), 2),
        "gate_scale": GATE_SCALE,
        "hidden_channels": HIDDEN,
        "parameters": int(sum(p.size for p in params.values())),
        "training_patches": int(len(train_set[0])),
    }
    print("metrics", metrics, flush=True)
    export(params, metrics)
    export_golden(params)


if __name__ == "__main__":
    main()
