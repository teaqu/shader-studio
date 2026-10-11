"""Regenerate the original baked cloud density used by both sample shaders."""
from pathlib import Path
import math
from ktx2 import volume
root=Path(__file__).resolve().parent
n=48
voxels=bytearray()
for z in range(n):
 for y in range(n):
  for x in range(n):
   a,b,c=[(v/(n-1)-.5)*2 for v in (x,y,z)]
   envelope=max(0,1-(a*a*1.1+b*b*1.4+c*c*1.1))
   noise=(math.sin(a*9+math.sin(c*7))*math.cos(b*11-c*5)+math.sin(b*18+a*13)*math.cos(c*19+a*5)*.35)
   density=max(0,min(1,envelope*(.48+.37*noise)))
   voxels.append(round(density*255))
(root/'cloud-density.ktx2').write_bytes(volume(n, n, n, 1, voxels))
