import sys,json,struct,numpy as np
from collections import deque
from PIL import Image, ImageFilter
S=sys.argv[0].rsplit('/',1)[0]+'/' if '/' in sys.argv[0] else './'
def tolab(rgb):
    c=np.asarray(rgb,float)/255; c=np.where(c>0.04045,((c+0.055)/1.055)**2.4,c/12.92)
    M=np.array([[.4124,.3576,.1805],[.2126,.7152,.0722],[.0193,.1192,.9505]])
    X=c@M.T/np.array([.95047,1,1.08883]); f=np.where(X>0.008856,np.cbrt(X),7.787*X+16/116)
    return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],-1)
def bilateral(L,rad=2,ss=1.5,sr=8.0,it=1):
    H,W,_=L.shape
    for _ in range(it):
        P=np.pad(L,((rad,rad),(rad,rad),(0,0)),mode='edge'); acc=np.zeros_like(L); wsum=np.zeros((H,W,1))
        for dy in range(-rad,rad+1):
            for dx in range(-rad,rad+1):
                N=P[rad+dy:rad+dy+H,rad+dx:rad+dx+W]
                w=np.exp(-(dy*dy+dx*dx)/(2*ss*ss))*np.exp(-((N-L)**2).sum(-1,keepdims=True)/(2*sr*sr))
                acc+=w*N; wsum+=w
        L=acc/wsum
    return L
def blur(L,r=1):
    H,W=L.shape[:2]; P=np.pad(L,((r,r),(r,r))+((0,0),)*(L.ndim-2),mode='edge'); o=np.zeros_like(L)
    for dy in range(-r,r+1):
        for dx in range(-r,r+1): o+=P[r+dy:r+dy+H,r+dx:r+dx+W]
    return o/(2*r+1)**2
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
                    if 0<=ny<H and 0<=nx<W and lab[ny,nx]<0 and k[ny,nx]==c: lab[ny,nx]=len(sizes); q.append((ny,nx))
            sizes.append(n)
    return lab,np.array(sizes)
def run(pic,W,H,K,threads,chroma=1.1,contrast=0.8,sr=5.0,bit=1,cl=2,cd=14,fresh=0):
    im=Image.open(pic).convert('RGB')
    # 1) area-average down to 3x the stitch grid, edge-preserving smooth there, then to the grid
    big=np.asarray(im.resize((W*3,H*3),Image.LANCZOS),float)
    Lb=bilateral(tolab(big),rad=2,ss=2,sr=sr,it=bit)
    L=Lb.reshape(H,3,W,3,3).mean((1,3))
    # 2) enhance: stretch lightness, local contrast, chroma boost
    l=L[...,0]; lo,hi=np.percentile(l,[1,99.5]); l=(l-lo)/(hi-lo)*95+3
    l=l+contrast*(l-blur(l,2)); L[...,0]=np.clip(l,0,100)
    L[...,1:]*=chroma
    if fresh:
        l=L[...,0]/100; L[...,0]=100*(l+fresh*0.12*np.sin(np.pi*l)*l)  # lift mids/highlights, keep darks
        C=np.hypot(L[...,1],L[...,2])+1e-6; k=1+fresh*0.45*np.exp(-C/25)  # muted colours gain most
        L[...,1]*=k; L[...,2]*=k; L[...,2]-=fresh*1.5
        # 3) palette: k-means in Lab, snap centres to threads
    X=L.reshape(-1,3); rng=np.random.default_rng(1)
    C=X[rng.choice(len(X),K,replace=False)]
    for _ in range(20):
        d=((X[:,None,:]-C[None])**2).sum(-1); a=d.argmin(1)
        for k in range(K):
            m=a==k
            C[k]=X[m].mean(0) if m.any() else X[rng.integers(len(X))]
    TL=tolab(threads); sel=sorted(set(((TL[None]-C[:,None])**2).sum(-1).argmin(1).tolist()))
    PL=TL[sel]
    g=((X[:,None,:]-PL[None])**2).sum(-1).argmin(1).reshape(H,W)
    # 4) clean: blobs<=2 take the dominant 8-neighbour colour if close (dE<22); strong accents kept
    for _ in range(3):
        lab,sz=comps(g); out=g.copy(); ys,xs=np.nonzero(sz[lab]<=cl)
        for y,x in zip(ys,xs):
            me=g[y,x]; cnt={}
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    yy,xx=y+dy,x+dx
                    if (dy or dx) and 0<=yy<H and 0<=xx<W and g[yy,xx]!=me: cnt[g[yy,xx]]=cnt.get(g[yy,xx],0)+1
            if not cnt: continue
            n=max(cnt,key=cnt.get)
            dist=np.sqrt(((PL[n]-PL[me])**2).sum())
            if cnt[n]>=3 and (dist<cd or cnt[n]>=6): out[y,x]=n
        g=out
    # drop colours used < 30 stitches into nearest used colour
    used=np.bincount(g.ravel(),minlength=len(sel))
    for i in np.argsort(used):
        if 0<used[i]<30:
            alive=[j for j in range(len(sel)) if used[j]>=30]
            j=min(alive,key=lambda j:((PL[i]-PL[j])**2).sum()); g[g==i]=j; used[j]+=used[i]; used[i]=0
    return np.asarray(threads)[sel][g].astype(np.uint8)
if __name__=='__main__':
    pic,W,H,K,out=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5]
    p=json.load(open(S+'pal.json'))
    th=np.array([[e['r'],e['g'],e['b']] for e in p['lucas']])
    kw={k:float(v) for k,v in (a.split('=') for a in sys.argv[6:])}
    A=run(pic,W,H,K,th,**kw)
    k=(A[...,0].astype(int)<<16)|(A[...,1].astype(int)<<8)|A[...,2]
    lab,sz=comps(k); s=(sz[lab]==1).sum(); print(out,'colours',len(np.unique(k)),'singles %.1f%%'%(100*s/k.size),'blobs<=3 %.1f%%'%(100*(sz[lab]<=3).mean()))
    Image.fromarray(A).resize((W*4,H*4),Image.NEAREST).save(out)
