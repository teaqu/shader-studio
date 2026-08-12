# Language-server foundation dependency and license audit

Audit date: 2026-08-11

This audit covers the third-party code and reference data introduced or newly
consumed by Shader Studio's browser-only language-server foundation. The
direct dependency versions below are exact in their workspace manifests. All
listed direct and transitive versions are resolved with integrity hashes in
`package-lock.json`. Re-run this audit when a listed version, source catalogue,
generated declaration source, or packaging strategy changes.

## Accepted dependency inventory

| Package | Relationship | Version | License | Upstream source | Runtime transitives |
| --- | --- | ---: | --- | --- | --- |
| `@shaderfrog/glsl-parser` | Direct runtime dependency of `@shader-studio/glsl-analysis` | 7.0.1 | ISC | [ShaderFrog/glsl-parser](https://github.com/ShaderFrog/glsl-parser) | None |
| `vscode-languageserver-protocol` | Direct, currently type-only dependency of both language-server packages | 3.18.2 | MIT | [microsoft/vscode-languageserver-node, `protocol`](https://github.com/microsoft/vscode-languageserver-node/tree/main/protocol) | The two exact packages below |
| `vscode-jsonrpc` | Transitive dependency of `vscode-languageserver-protocol` | 9.0.1 | MIT | [microsoft/vscode-languageserver-node, `jsonrpc`](https://github.com/microsoft/vscode-languageserver-node/tree/main/jsonrpc) | None |
| `vscode-languageserver-types` | Transitive dependency of `vscode-languageserver-protocol` | 3.18.0 | MIT | [microsoft/vscode-languageserver-node, `types`](https://github.com/microsoft/vscode-languageserver-node/tree/main/types) | None |

The lockfile records these npm integrity values:

- `@shaderfrog/glsl-parser@7.0.1`: `sha512-8mpfsoPeRhesY3pOrzNZBL8uG6N5GVX1EHLBYbd4gzKs+c7vaEIqpTNK5VrffU33qQN4cwpP2v3u4aPPBU32sw==`
- `vscode-languageserver-protocol@3.18.2`: `sha512-XRyDbT0Pp3sSNti3JmxVEUMySWCSi1hhM+/KUlCy1hV1zmrqpM1OwO12EAki8blhmLuIMpaJrYbo0OzGVfK2Qg==`
- `vscode-jsonrpc@9.0.1`: `sha512-rfuA6T75H6m5EkbhtEPzre9pT0HPcDI2MMy4+nPFIBks5J8JBAUHD4tRYSgaBOijIEC7SRkC1kKyXTLqbmh9jw==`
- `vscode-languageserver-types@3.18.0`: `sha512-8TsGPNMIMiiBdkORgRSvLjuiEIiAFtO+KssmYWxQ+uSVvlf7RjK8YKCOjPzZ+YA04jXEV7+7LvkSmHkhpNS99g==`

The installed Microsoft packages each include the same `License.txt`, naming
Microsoft Corporation and containing the MIT terms reproduced below. The
published ShaderFrog package metadata names Andrew Ray as author and declares
ISC, and the package has no runtime dependencies. Its 7.0.1 npm tarball and
upstream repository do not contain a separate license file; the attribution and
standard ISC terms are therefore retained explicitly in this audit rather than
inferred from a missing file.

No native binary, WASI module, WASM tooling, architecture-specific artifact, or
third-party documentation is added by this dependency graph. Package README
content is not copied into Shader Studio documentation.

## Reference-data origin and attribution decision

The GLSL ES keyword, type, and future-reserved-word sets in
`types/src/shader-environment/ShaderLanguageReservedTerms.ts` are
Shader Studio-maintained factual compatibility data. The individual identifier
and type spellings were checked against sections 3.8 and 4.1 of *The OpenGL ES
Shading Language*, language version 3.00, document revision 6, and their use in
global declaration-name validation is filtered by the repository's real
compiler-boundary tests. No specification prose, tables, figures, or complete
catalogue are copied into Shader Studio documentation.

Copyright © 2008–2016 The Khronos Group Inc. The verification source is
available from the [Khronos OpenGL ES
registry](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
Its copyright page permits using the specification to implement its
functionality but restricts reproduction and distribution, with a separate
unmodified-copy permission for current Khronos members. It does not grant a
Creative Commons Attribution 4.0 license. Shader Studio links to the PDF for
verification, does not redistribute it, and does not claim to relicense its
contents or derive documentation prose from it.

The short descriptions in `BuiltinUniforms.ts` are original repository text
written from Shader Studio's renderer and extension behavior. ShaderToy-style
uniform names and GLSL/Slang type spellings are factual compatibility/API data;
no ShaderToy, Khronos, or Slang explanatory prose was copied. The two Slang
reserved identifiers are compiler-probed behavior, not copied documentation.
No Shader Sense catalogue or GPL-licensed `glsl_analyzer` code or data is
present in this foundation.

The completed Slang language service reuses Shader Studio's pinned official
Slang 2026.10.2 browser runtime. Slang is licensed under Apache-2.0 WITH the
LLVM exception. Its distribution notice is retained at
`language-servers/slang/THIRD_PARTY_NOTICES.md` and copied beside the WASM in
the packaged extension. No native Slang executable is distributed.

## ISC notice for `@shaderfrog/glsl-parser`

Copyright (c) Andrew Ray

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## MIT notice for the VS Code language-server packages

Copyright (c) Microsoft Corporation

All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
