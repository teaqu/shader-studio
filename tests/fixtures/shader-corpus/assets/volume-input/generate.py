"""Generate an original XYZ ramp fixture; no third-party noise assets required."""
from pathlib import Path
from ktx2 import volume
size = 8
voxels = bytes(c for z in range(size) for y in range(size) for x in range(size)
               for c in (round(x * 255 / (size - 1)), round(y * 255 / (size - 1)), round(z * 255 / (size - 1)), 255))
Path(__file__).with_name('axis-ramp.ktx2').write_bytes(volume(size, size, size, 4, voxels))
