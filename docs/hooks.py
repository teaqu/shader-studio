"""Register `slang` as a Pygments language alias for `glsl` so mkdocs highlights
Slang code fences with the GLSL lexer."""

from pygments.lexers._mapping import LEXERS

entry = LEXERS["GLShaderLexer"]
# entry is (module, display_name, (aliases,), (file_patterns,), (mime_types,))
LEXERS["GLShaderLexer"] = (
    entry[0],
    entry[1],
    entry[2] + ("slang",),
    entry[3] + ("*.slang",),
    entry[4] + ("text/x-slang",),
)
