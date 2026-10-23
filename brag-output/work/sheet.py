import sys,glob
from PIL import Image, ImageDraw
fs=sorted(glob.glob('stills/*.jpg'),key=lambda f:float(f.split('t')[-1][:-4]))
W,H=640,360; cols=4; rows=(len(fs)+cols-1)//cols
s=Image.new('RGB',(W*cols,H*rows))
for i,f in enumerate(fs):
    im=Image.open(f).resize((W,H)); ImageDraw.Draw(im).text((8,8),__import__('os').path.basename(f),fill='yellow'); s.paste(im,((i%cols)*W,(i//cols)*H))
s.save('sheet.jpg',quality=85)
