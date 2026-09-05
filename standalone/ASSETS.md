# Desert cubemap

`public/assets/desert-cubemap-cross.png` is a cubemap projection of
[Rogland Sunset](https://polyhaven.com/a/rogland_sunset) by Greg Zaal / Poly Haven,
provided under [CC0](https://polyhaven.com/license).

The source is Poly Haven's
[tonemapped panorama](https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/rogland_sunset.jpg).
All six faces come from the same spherical environment, so terrain and sky
continue across the cube edges. The 2048 × 1536 T-cross contains 512 × 512 faces:

```text
       +Y
 -X    +Z    +X    -Z
       -Y
```

Reproduce with FFmpeg (download the source as `rogland-sunset.jpg` first):

```sh
ffmpeg -i rogland-sunset.jpg -filter_complex '
  [0:v]v360=input=equirect:output=c6x1:w=12288:h=2048:out_forder=lfrbud:out_frot=000000:interp=lanczos,format=rgb24,split=3[m][u][d];
  [m]crop=8192:2048:0:0,scale=2048:512:flags=area,pad=2048:1536:0:512:black[base];
  [u]crop=2048:2048:8192:0,scale=512:512:flags=area[top];
  [d]crop=2048:2048:10240:0,scale=512:512:flags=area[bottom];
  [base][top]overlay=512:0:format=rgb[sky];
  [sky][bottom]overlay=512:1024:format=rgb,format=rgb24[out]
' -map '[out]' -frames:v 1 public/assets/desert-cubemap-cross.png
```

Projection is supersampled before reducing each strip/face to avoid aliasing in
the detailed ground. RGB composition prevents chroma subsampling from bleeding
the unused black tiles into face boundaries. Do not add grid lines or gutters.

`src/test/defaultCubemap.test.js` checks all twelve physical edges of the shipped
image. The standalone browser suite checks the visible ground and sky while
dragging the default shader and after reloading the workspace.
