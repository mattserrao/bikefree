#!/usr/bin/env python3
"""Share of pixels that differ by more than 32 levels (any channel) between two same-size images. [blocks] guard helper."""
import sys
from PIL import Image
import numpy as np
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
b = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(int)
print(1.0 if a.shape != b.shape else float((np.abs(a - b).max(axis=2) > 32).mean()))
