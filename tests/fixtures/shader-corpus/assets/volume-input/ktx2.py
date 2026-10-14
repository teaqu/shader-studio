"""Write uncompressed R8/RGBA8 KTX2 3D textures with a basic RGBSDA DFD."""
import struct

def volume(width, height, depth, channels, voxels):
    assert channels in (1, 4)
    assert len(voxels) == width * height * depth * channels
    descriptor = struct.pack('<IHH4B4B8B', 0, 2, 24 + 16 * channels,
                             1, 1, 1, 0, 0, 0, 0, 0, channels, 0, 0, 0, 0, 0, 0, 0)
    for c in range(channels):
        descriptor += struct.pack('<HBB4BII', c * 8, 7, 15 if c == 3 else c, 0, 0, 0, 0, 0, 255)
    dfd = struct.pack('<I', 4 + len(descriptor)) + descriptor
    header = bytes([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
    header += struct.pack('<13I2Q', 9 if channels == 1 else 37, 1, width, height, depth, 0, 1, 1, 0,
                          104, len(dfd), 0, 0, 0, 0)
    return header + struct.pack('<3Q', 104 + len(dfd), len(voxels), len(voxels)) + dfd + voxels
