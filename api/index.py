"""Vercel serverless entry: import the FastAPI app from backend/.

Vercel serves this file's `app` at /api/* (see vercel.json rewrites).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app import create_app  # noqa: E402

app = create_app()
