"""موسيقى خلفية بسيطة للإعلان (120 BPM) — تُولَّد بالكامل بالكود، بدون حقوق نشر."""
import sys, wave
import numpy as np

SR = 44100
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 22.0
BPM = 120
beat = 60 / BPM
n = int(SR * DUR)
t = np.arange(n) / SR
out = np.zeros(n)

def add(sig, start):
    i = int(start * SR)
    if i >= n: return
    j = min(n, i + len(sig))
    out[i:j] += sig[: j - i]

def env(length, attack=0.005, release=None):
    k = int(length * SR); e = np.ones(k)
    a = max(1, int(attack * SR)); e[:a] = np.linspace(0, 1, a)
    r = int((release or length * 0.6) * SR); r = min(r, k)
    e[-r:] *= np.linspace(1, 0, r)
    return e

# كيك
def kick():
    L = 0.35; tt = np.arange(int(L * SR)) / SR
    f = 120 * np.exp(-tt * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9) * 0.9

# هاي هات
rng = np.random.default_rng(7)
def hat():
    L = 0.06; k = int(L * SR)
    s = rng.standard_normal(k); s = np.diff(np.concatenate([[0], s]))
    return s * np.exp(-np.arange(k) / SR * 70) * 0.12

# باد (أكوردات) Am - F - C - G
def chord(freqs, L):
    tt = np.arange(int(L * SR)) / SR
    s = sum(np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt + 0.3) for f in freqs)
    return s / len(freqs) * env(L, 0.3, 0.6) * 0.16

chords = [[220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [261.6, 329.6, 392.0], [196.0, 246.9, 293.7]]
bar = beat * 4
i = 0; pos = 0.0
while pos < DUR:
    add(chord(chords[i % 4], bar + 0.4), pos); pos += bar; i += 1

# باص
bass_notes = [110.0, 87.3, 130.8, 98.0]
pos = 0.0; i = 0
while pos < DUR:
    f = bass_notes[(i // 4) % 4]; L = beat * 0.9; tt = np.arange(int(L * SR)) / SR
    add(np.sin(2 * np.pi * f * tt) * env(L, 0.01, 0.3) * 0.22, pos)
    pos += beat; i += 1

# إيقاع: يبدأ بعد أول ثانيتين (الهوك هادئ) ويتوقف قبل النهاية بقليل
pos = 0.0
while pos < DUR - 1.0:
    if pos >= 1.9:
        add(kick(), pos)
        add(hat(), pos + beat / 2)
    pos += beat

# ووش عند تغيير المشاهد
def whoosh():
    L = 0.5; k = int(L * SR); s = rng.standard_normal(k)
    s = np.convolve(s, np.ones(30) / 30, mode='same')
    return s * np.sin(np.linspace(0, np.pi, k)) ** 2 * 0.35
for ts in [3.15, 7.25, 11.05, 14.45, 18.15]:
    add(whoosh(), ts)

# صوت "دينغ" عند تأكيد الحجز وظهور رقم الهاتف
def ding(f=1318.5):
    L = 0.9; tt = np.arange(int(L * SR)) / SR
    return (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2 * tt)) * np.exp(-tt * 5) * 0.18
add(ding(), 16.95); add(ding(1568.0), 17.1); add(ding(1046.5), 19.5)

# تلاشي في البداية والنهاية
fade = int(0.3 * SR); out[:fade] *= np.linspace(0, 1, fade)
fo = int(1.5 * SR); out[-fo:] *= np.linspace(1, 0, fo)
out = out / np.max(np.abs(out)) * 0.85
pcm = (out * 32767).astype(np.int16)
stereo = np.repeat(pcm[:, None], 2, axis=1)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(stereo.tobytes())
