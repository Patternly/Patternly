import sys,struct,numpy as np
from collections import Counter,deque
from PIL import Image
def load(fn):
    b=open(fn,'rb').read(); W,H=struct.unpack_from('<II',b,0x25)
    a=np.frombuffer(b,dtype=np.uint8,count=W*H*4,offset=0x2d).reshape(W,H,4)[:,:,:3].transpose(1,0,2)
    return a
def ids(a):
    k=(a[:,:,0].astype(np.int32)<<16)|(a[:,:,1].astype(np.int32)<<8)|a[:,:,2]
    return k
def comps(k):
    H,W=k.shape; lab=-np.ones((H,W),int); sizes=[]
    for y in range(H):
        for x in range(W):
            if lab[y,x]>=0: continue
            c=k[y,x]; q=deque([(y,x)]); lab[y,x]=len(sizes); n=0
            while q:
                yy,xx=q.popleft(); n+=1
                for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny,nx=yy+dy,xx+dx
                    if 0<=ny<H and 0<=nx<W and lab[ny,nx]<0 and k[ny,nx]==c:
                        lab[ny,nx]=len(sizes); q.append((ny,nx))
            sizes.append(n)
    return lab,np.array(sizes)
def rgb(v): return ((v>>16)&255,(v>>8)&255,v&255)
def lab_(c):
    r,g,b=[x/255 for x in c]
    f=lambda u: ((u+0.055)/1.055)**2.4 if u>0.04045 else u/12.92
    r,g,b=f(r),f(g),f(b)
    X=(r*.4124+g*.3576+b*.1805)/.95047; Y=r*.2126+g*.7152+b*.0722; Z=(r*.0193+g*.1192+b*.9505)/1.08883
    h=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
    return (116*h(Y)-16, 500*(h(X)-h(Y)), 200*(h(Y)-h(Z)))
def dE(a,b):
    A,B=lab_(rgb(a)),lab_(rgb(b)); return sum((p-q)**2 for p,q in zip(A,B))**.5
name=sys.argv[1]; R=ids(load(sys.argv[2])); E=ids(load(sys.argv[3]))
H,W=R.shape; N=H*W
lr,sr=comps(R); le,se=comps(E)
def stats(k,lab,s,tag):
    cnt=Counter(k.ravel().tolist())
    single=(s[lab]==1).sum(); small=(s[lab]<=3).sum()
    print(f"{tag}: colours {len(cnt)}, single stitches {single} ({100*single/N:.1f}%), cells in blobs<=3 {small} ({100*small/N:.1f}%), blobs {len(s)}, median colour use {int(np.median(list(cnt.values())))}, colours<50 stitches {sum(1 for v in cnt.values() if v<50)}")
    return cnt
print(f"== {name} {W}x{H} = {N} stitches")
cr=stats(R,lr,sr,'raw'); ce=stats(E,le,se,'edited')
ch=R!=E; nch=ch.sum(); print(f"changed cells {nch} ({100*nch/N:.1f}%)")
kept=set(cr)&set(ce); dropped=set(cr)-set(ce); new=set(ce)-set(cr)
print(f"colours kept {len(kept)}, dropped {len(dropped)}, new in edited {len(new)}")
print("dropped colours: stitches total", sum(cr[c] for c in dropped), "max single dropped colour use", max([cr[c] for c in dropped] or [0]))
print("kept colours raw use: min", min(cr[c] for c in kept), "median", int(np.median([cr[c] for c in kept])))
# changed cell classification
blob=sr[lr]
cat=Counter(); dlist=[]
ys,xs=np.nonzero(ch)
for y,x in zip(ys,xs):
    o,n=R[y,x],E[y,x]
    nb=set()
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            if (dy or dx) and 0<=y+dy<H and 0<=x+dx<W: nb.add(R[y+dy,x+dx])
    src='dropped-colour' if o in dropped else 'kept-colour'
    how='to-neighbour' if n in nb else ('to-new' if n in new else 'other')
    bs=blob[y,x]; bsz='blob1' if bs==1 else 'blob2-3' if bs<=3 else 'blob4-10' if bs<=10 else 'blob>10'
    cat[(src,how)]+=1; cat[bsz]+=1
    dlist.append(dE(o,n))
for k,v in sorted(cat.items(),key=lambda t:-t[1]): print(' ',k,v,f"{100*v/nch:.1f}%")
d=np.array(dlist); print(f"colour distance of change dE: median {np.median(d):.1f}, p90 {np.percentile(d,90):.1f}, >20: {100*(d>20).mean():.1f}%")
# mapping of dropped colours
mp={}
for c in dropped:
    m=Counter(E[R==c].tolist()).most_common(1)[0][0]; mp[c]=(dE(c,m),cr[c])
dd=np.array([v[0] for v in mp.values()])
if len(dd): print(f"dropped colour -> main replacement dE: median {np.median(dd):.1f}, max {dd.max():.1f}")
# nearest kept colour distance for dropped
nk=[min(dE(c,k) for k in ce) for c in dropped]
print(f"dropped colour nearest remaining colour dE median {np.median(nk):.1f}; replacement == nearest remaining: {sum(1 for c in dropped if Counter(E[R==c].tolist()).most_common(1)[0][0]==min(ce,key=lambda k:dE(c,k)))}/{len(dropped)}")
# new colours
for c in new: print('  new colour', rgb(c), ce[c])
# images
def img(k,s=4):
    a=np.stack([(k>>16)&255,(k>>8)&255,k&255],-1).astype(np.uint8)
    return Image.fromarray(a).resize((W*s,H*s),Image.NEAREST)
img(R).save(f'{name}_raw.png'); img(E).save(f'{name}_edited.png')
g=np.stack([(R>>16)&255,(R>>8)&255,R&255],-1).astype(float)
gr=(g.mean(-1,keepdims=True)*0.35+170).repeat(3,-1); gr[ch]=[230,30,60]
Image.fromarray(gr.astype(np.uint8)).resize((W*4,H*4),Image.NEAREST).save(f'{name}_changes.png')
