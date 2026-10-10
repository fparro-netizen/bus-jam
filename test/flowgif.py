import glob, sys
from PIL import Image
d = sys.argv[1] if len(sys.argv) > 1 else '/workspace/bus-jam/flow/'
fr = [Image.open(f).convert('RGB') for f in sorted(glob.glob(d + 'frame-*.png'))]
fr[0].save(d + '../rider-flow.gif', save_all=True, append_images=fr[1:], duration=160, loop=0)
w, h = fr[0].size; cols = 4; sel = fr[::3][:8]; rows = (len(sel) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w // 2, rows * h // 2), 'white')
for i, f in enumerate(sel): sheet.paste(f.resize((w // 2, h // 2)), ((i % cols) * w // 2, (i // cols) * h // 2))
sheet.save(d + '../rider-flow-frames.png'); print(len(fr), 'frames')
