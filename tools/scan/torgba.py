# photo → raw RGBA for the Node harness:  python3 torgba.py photo.jpg out.rgba [maxSide] [quarterTurnsClockwise]
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
for _ in range(int(sys.argv[4]) if len(sys.argv) > 4 else 0): im = im.transpose(Image.ROTATE_270)
m = int(sys.argv[3]) if len(sys.argv) > 3 else 0
if m and max(im.size) > m:
    k = m / max(im.size); im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
open(sys.argv[2], 'wb').write(im.tobytes()); print(im.size[0], im.size[1])
