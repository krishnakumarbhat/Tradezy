"""
Logging utility singleton.
Why: Consistent logging across all modules with structured output.
"""

import logging
import sys
from typing import Optional


class LoggerFactory:
    """Factory for creating module-scoped loggers."""

    _configured = False

    @classmethod
    def _configure_root(cls) -> None:
        if cls._configured:
            return
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "[%(asctime)s] %(levelname)-8s %(name)-25s │ %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        root = logging.getLogger("finresearcher")
        root.setLevel(logging.INFO)
        root.addHandler(handler)
        cls._configured = True

    @classmethod
    def get(cls, name: str) -> logging.Logger:
        cls._configure_root()
        return logging.getLogger(f"finresearcher.{name}")
