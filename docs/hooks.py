"""Register the Slang lexer for Pygments so mkdocs highlights ```slang code fences."""

import os
import sys

# mkdocs loads hooks from the project root, not from docs/. Add docs/ to the
# path so we can import the lexer module.
_docs_dir = os.path.dirname(os.path.abspath(__file__))
if _docs_dir not in sys.path:
    sys.path.insert(0, _docs_dir)

from _slang_lexer import SlangLexer  # noqa: E402
from pygments.lexers._mapping import LEXERS  # noqa: E402

LEXERS["SlangLexer"] = (
    "docs._slang_lexer",
    SlangLexer.name,
    SlangLexer.aliases,
    SlangLexer.filenames,
    SlangLexer.mimetypes,
)
