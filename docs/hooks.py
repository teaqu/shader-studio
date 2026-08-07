"""Register the Slang lexer for Pygments so mkdocs highlights ```slang code fences."""

import importlib.util
import os


def _import_lexer():
    """Import the SlangLexer by file path, bypassing Python's package system."""
    lexer_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_slang_lexer.py")
    spec = importlib.util.spec_from_file_location("docs._slang_lexer", lexer_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Register in sys.modules so Pygments' lazy import finds it
    import sys
    sys.modules["docs._slang_lexer"] = mod
    # Also ensure the docs "package" is available
    import types
    docs_pkg = types.ModuleType("docs")
    docs_pkg.__path__ = [os.path.dirname(lexer_path)]
    sys.modules["docs"] = docs_pkg
    return mod.SlangLexer


def on_startup(*, command, dirty):
    """Register the Slang lexer in Pygments' LEXERS dict before the build."""
    from pygments.lexers._mapping import LEXERS

    SlangLexer = _import_lexer()

    LEXERS["SlangLexer"] = (
        "docs._slang_lexer",
        SlangLexer.name,
        SlangLexer.aliases,
        SlangLexer.filenames,
        SlangLexer.mimetypes,
    )
