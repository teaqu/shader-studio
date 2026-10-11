"""Original 32³ uniform noise volumes, functionally equivalent to Shadertoy noise inputs.

Every voxel/channel is a random byte. LINEAR + REPEAT supplies periodic 3D
value noise on the GPU; the asset itself is neither Perlin nor a baked cloud.
Independent fixed-seed xorshift32 streams keep output reproducible.
"""
from pathlib import Path
from ktx2 import volume

SEEDS = (0xA341316C, 0xC8013EA4, 0xAD90777D, 0x7E95761E)

def noise(channels, size=32):
    states = list(SEEDS[:channels])
    pixels = bytearray()
    for _ in range(size ** 3):
        for c in range(channels):
            x = states[c]
            x ^= (x << 13) & 0xffffffff
            x ^= x >> 17
            x ^= (x << 5) & 0xffffffff
            states[c] = x
            pixels.append(x >> 24)
    return bytes(pixels)

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    for name, channels in [('noise-grey', 1), ('noise-rgba', 4)]:
        (root / (name + '.ktx2')).write_bytes(volume(32, 32, 32, channels, noise(channels)))
