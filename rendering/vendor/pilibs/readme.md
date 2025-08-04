# piLibs-JS

------

A super simple and minimal set of libraries to do 3D rendering (WebGL 2.0 only), reading files and other related tasks. It's 47 kilobytes minified, but you can probably only include the modules you need and make a much smaller distributable. These are all the modules in it by fault:

|module|description|
|---|---|
|piRenderer|An renderer abstraction and simplification over WebGL 2.0|
|piMesh|Useful functions to manipulate and render meshes|
|piFile|Module to read binary files conveniently|
|piShading|Some useful shading functions|
|piVR|A module that takes care of VR rendering|
|piVecTypes|Simple math types|
|piWebUtils|Simple helpers to work-around browser differences|
|piCamera|Simple 3D camera controller|

## Usage

* src\ contains the source files
* lib\ constins the built library ready for use created by build.bat (source aggregated but not minimized)
* examples\flames contains a cool animated effect made of lots of textured quads - [see online demo](https://iquilezles.org/code/piLibsJS/demos/flames/demo.html)
* examples\objViewer shows how to display a 3D model with shadow maps and multisampling - [see online demo](https://iquilezles.org/code/piLibsJS/demos/model/demo.html)

## License

MIT

## Credits

[Inigo Quilez](https://iquilezles.org)
