# printer/print_image.py

import sys
from escpos.printer import Usb

image_path = sys.argv[1]

p = Usb(0x0483, 0x5743, 0, profile="TM-T88III")
p.image(image_path)
p.text("\n\n\n")
p.cut()
p.close()