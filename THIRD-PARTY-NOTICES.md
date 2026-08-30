# Third-party notices

Shader Studio is distributed under the MIT License (see `LICENSE`). It also
redistributes the components below, each under its own terms. Those terms
apply to the components themselves, not to Shader Studio as a whole.

## Slang (`slang-wasm.js`, `slang-wasm.wasm`)

The Slang shader compiler, built to WebAssembly. Downloaded unmodified at build
time from the official release archive by `ui/scripts/ensure-slang-wasm.mjs`,
and redistributed inside the packaged extension and web build.

- Project: https://github.com/shader-slang/slang
- License: Apache License 2.0, with the LLVM exception where it applies
- Copyright: The Slang Authors

The full licence text ships with the upstream release archive and is retained
in the packaged artifacts.

## piLibs-JS (`vendor/pilibs`)

A minimal WebGL 2.0 rendering and math library, vendored into this repository
and used by the WebGL renderer.

- Project: https://iquilezles.org/code/piLibsJS
- License: MIT
- Copyright: Inigo Quilez

## Bundled npm dependencies

The packaged extension and web build also include code from the project's npm
dependencies - among them Monaco Editor, Svelte and Dockview - each of which
carries its own licence in its published package. Those licences are preserved
in the dependency tree and are unaffected by this project's own licence.
