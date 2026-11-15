import sys,json,numpy as np
from PIL import Image
from prototype import tolab,bilateral,blur,comps
def smooth01(x,a,b): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def run(pic,W,H,K,threads,fresh=0,cl=2,cd=14,dith=1,dT=13,bg=1,dr=1,dt=0.25,ret=False):
    im=Image.open(pic).convert('RGB')
    big=np.asarray(im.resize((W*3,H*3),Image.LANCZOS),float)
    Lb=bilateral(tolab(big),rad=2,ss=2,sr=5,it=1)
    L=Lb.reshape(H,3,W,3,3).mean((1,3))
    # detail map -> soft subject mask S (1 = detailed subject, 0 = calm background)
    l0=blur(L[...,0],1); gy,gx=np.gradient(l0); ga=np.hypot(*np.gradient(blur(L[...,1],1))); gb=np.hypot(*np.gradient(blur(L[...,2],1)))
    G=np.hypot(gx,gy)+0.5*(ga+gb)
    D=blur(blur(G,4),4); D=D/np.percentile(D,90)
    S=smooth01(D,0.25,0.7)[...,None]
    if bg:
        Lblur=blur(blur(L,2),2); L=S*L+(1-S)*Lblur
    # tone
    l=L[...,0]; lo,hi=np.percentile(l,[0.5,99.8]); l=(l-lo)/(hi-lo)*(min(96,hi+4)-max(4,lo-4))+max(4,lo-4)
    l=l+0.45*S[...,0]*(l-blur(l,2)); 
    ch=1.0+0.12*S[...,0]
    if fresh:
        u=l/100; l=l+fresh*(1-S[...,0])*6*np.sin(np.pi*np.clip(u,0,1))   # lighter calm background
        ch=ch+fresh*0.15*S[...,0]
        w=(1-S); m=(L[...,1:]*w).sum((0,1))/w.sum()      # calm background: pull its colours together
        L[...,1:]=L[...,1:]-fresh*0.4*w*(L[...,1:]-m)
    L[...,0]=np.clip(l,0,100); L[...,1]*=ch; L[...,2]*=ch
    # palette: weighted k-means
    X=L.reshape(-1,3); wt=(1+3*S).reshape(-1); rng=np.random.default_rng(1)
    C=X[rng.choice(len(X),K,replace=False,p=wt/wt.sum())].copy()
    for _ in range(25):
        a=((X[:,None,:]-C[None])**2).sum(-1).argmin(1)
        for k in range(K):
            m=a==k
            C[k]=(X[m]*wt[m,None]).sum(0)/wt[m].sum() if m.any() else X[rng.integers(len(X))]
    TL=tolab(threads); sel=sorted(set(((TL[None]-C[:,None])**2).sum(-1).argmin(1).tolist())); PL=TL[sel]; P=len(sel)
    d=((X[:,None,:]-PL[None])**2).sum(-1); c1=d.argmin(1)
    g=c1.copy(); prot=np.zeros(len(X),bool)
    if dith:
        # ordered checker between two close shades where the picture is smooth
        PD=np.sqrt(((PL[:,None]-PL[None])**2).sum(-1))
        best_t=np.zeros(len(X)); c2=c1.copy(); bestd=d[np.arange(len(X)),c1].copy()
        for q in range(P):
            ok=(PD[c1,q]<dT)&(c1!=q)
            if not ok.any(): continue
            A=PL[c1[ok]]; B=PL[q]; AB=B-A; t=((X[ok]-A)*AB).sum(1)/(AB**2).sum(1); t=np.clip(t,0,0.5)
            dd=((X[ok]-(A+t[:,None]*AB))**2).sum(1)
            idx=np.nonzero(ok)[0]; better=dd<bestd[idx]-1e-9
            bi=idx[better]; bestd[bi]=dd[better]; c2[bi]=q; best_t[bi]=t[better]
        yy,xx=np.divmod(np.arange(len(X)),W); par=((yy+xx)&1)==0
        smoothmask=(G.reshape(-1)<np.percentile(G,60))
        # only in a narrow band next to the border with that second shade
        c1g=c1.reshape(H,W); c2g=c2.reshape(H,W); near=np.zeros((H,W),bool); r=int(dr)
        Pd=np.pad(c1g,r,constant_values=-1)
        for dy in range(-r,r+1):
            for dx in range(-r,r+1): near|=Pd[r+dy:r+dy+H,r+dx:r+dx+W]==c2g
        use=(best_t>dt)&smoothmask&near.reshape(-1)
        # canonical checker: lower index colour on even cells so neighbouring cells agree
        lo_=np.minimum(c1,c2); hi_=np.maximum(c1,c2)
        g=np.where(use,np.where(par,lo_,hi_),c1); prot=use.copy()
    g=g.reshape(H,W); prot=prot.reshape(H,W)
    # tidy: checker cells without a diagonal partner fall back to nearest colour
    def diag_same(g):
        P_=np.pad(g,1,constant_values=-1); return (P_[:-2,:-2]==g)|(P_[:-2,2:]==g)|(P_[2:,:-2]==g)|(P_[2:,2:]==g)
    for _ in range(2):
        lone=prot&~diag_same(g); g=np.where(lone,c1.reshape(H,W),g); prot&=~lone
    for _ in range(3):
        lab,sz=comps(g); out=g.copy(); ys,xs=np.nonzero((sz[lab]<=cl)&~prot)
        for y,x in zip(ys,xs):
            me=g[y,x]; cnt={}
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    y2,x2=y+dy,x+dx
                    if (dy or dx) and 0<=y2<H and 0<=x2<W and g[y2,x2]!=me: cnt[g[y2,x2]]=cnt.get(g[y2,x2],0)+1
            if not cnt: continue
            n=max(cnt,key=cnt.get); dist=np.sqrt(((PL[n]-PL[me])**2).sum())
            if cnt[n]>=3 and (dist<cd or cnt[n]>=6): out[y,x]=n
        g=out
    used=np.bincount(g.ravel(),minlength=P)
    for i in np.argsort(used):
        if 0<used[i]<30:
            alive=[j for j in range(P) if used[j]>=30]; j=min(alive,key=lambda j:((PL[i]-PL[j])**2).sum()); g[g==i]=j; used[j]+=used[i]; used[i]=0
    A=np.asarray(threads)[sel][g].astype(np.uint8)
    return (A,g,S) if ret else A
def stats(A):
    k=(A[...,0].astype(int)<<16)|(A[...,1].astype(int)<<8)|A[...,2]
    lab,sz=comps(k); single=sz[lab]==1
    P_=np.pad(k,1,constant_values=-1); diag=(P_[:-2,:-2]==k)|(P_[:-2,2:]==k)|(P_[2:,:-2]==k)|(P_[2:,2:]==k)
    return len(np.unique(k)),100*single.mean(),100*(single&~diag).mean()
if __name__=='__main__':
    pic,W,H,K,out=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),int(sys.argv[4]),sys.argv[5]
    kw={k:float(v) for k,v in (a.split('=') for a in sys.argv[6:])}
    p=json.load(open('pal.json')); th=np.array([[e['r'],e['g'],e['b']] for e in p['lucas']])
    A,g,S=run(pic,W,H,K,th,ret=True,**kw)
    print(out,'colours %d, singles %.1f%%, stray singles %.1f%%'%stats(A))
    Image.fromarray(A).resize((W*4,H*4),Image.NEAREST).save(out)
    Image.fromarray((S[...,0]*255).astype(np.uint8)).resize((W*4,H*4)).save(out.replace('.png','_S.png'))
