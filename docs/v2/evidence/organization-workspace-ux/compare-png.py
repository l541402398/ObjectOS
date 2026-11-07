import struct,zlib,json,sys
from pathlib import Path
def decode(path):
 b=Path(path).read_bytes(); chunks=[]; off=8
 while off<len(b):
  n,=struct.unpack('>I',b[off:off+4]);t=b[off+4:off+8];v=b[off+8:off+8+n];off+=n+12
  if t==b'IHDR': w,h,depth,color,_,_,inter=struct.unpack('>IIBBBBB',v)
  if t==b'IDAT':chunks.append(v)
 assert depth==8 and color in (2,6) and inter==0,(depth,color,inter)
 pixel=4 if color==6 else 3;stride=w*pixel;raw=zlib.decompress(b''.join(chunks));out=[];prior=bytearray(stride)
 for y in range(h):
  f=raw[y*(stride+1)];row=bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)])
  for x in range(stride):
   a=row[x-pixel] if x>=pixel else 0;c=prior[x-pixel] if x>=pixel else 0;u=prior[x]
   if f==1:k=a
   elif f==2:k=u
   elif f==3:k=(a+u)//2
   elif f==4:
    v=a+u-c;pa=abs(v-a);pb=abs(v-u);pc=abs(v-c);k=a if pa<=pb and pa<=pc else u if pb<=pc else c
   else:k=0
   row[x]=(row[x]+k)%256
  out.append(row);prior=row
 return w,h,pixel,out
aw,ah,ap,a=decode(sys.argv[1]);bw,bh,bp,b=decode(sys.argv[2]);assert (aw,ah,ap)==(bw,bh,bp)
points=[];maximum=0
for y in range(ah):
 for x in range(aw):
  at=x*ap;dif=max(abs(a[y][at+i]-b[y][at+i]) for i in range(3))
  if dif:points.append((x,y));maximum=max(maximum,dif)
result={'pixels':len(points),'maximumChannelDifference':maximum,'bbox': [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)] if points else None}
print(json.dumps(result))
