"""Make the `pipeline` directory importable as the package root for tests.

Adds the pipeline directory to sys.path so tests can `import common`,
`import generate_questions`, etc., without installing anything.
"""

import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))
