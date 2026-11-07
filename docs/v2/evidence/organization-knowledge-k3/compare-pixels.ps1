Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'public static class K3Pixels { public static long[] Compare(byte[] a, byte[] b, int w) { long n=0, x0=w, y0=100000, x1=-1, y1=-1, max=0; for(int i=0;i<a.Length;i+=4) { bool d=false; for(int c=0;c<4;c++) { int v=System.Math.Abs(a[i+c]-b[i+c]); if(v>max)max=v; if(v>0)d=true; } if(d) {n++; int x=(i/4)%w, y=(i/4)/w; if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y;} } return new long[]{n,x0,y0,x1,y1,max}; } }'
$base = Join-Path (Get-Location) 'docs/v2/evidence/organization-knowledge-k3/preflight-screenshots'
$a = [System.Drawing.Bitmap]::new((Join-Path $base 'formal-first-before-dag.png'))
$b = [System.Drawing.Bitmap]::new((Join-Path $base 'formal-first-after-dag.png'))
$rect = [System.Drawing.Rectangle]::new(0,0,$a.Width,$a.Height)
$da = $a.LockBits($rect,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$db = $b.LockBits($rect,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$ba = [byte[]]::new($da.Stride*$a.Height)
$bb = [byte[]]::new($db.Stride*$b.Height)
[System.Runtime.InteropServices.Marshal]::Copy($da.Scan0,$ba,0,$ba.Length)
[System.Runtime.InteropServices.Marshal]::Copy($db.Scan0,$bb,0,$bb.Length)
$result = [K3Pixels]::Compare($ba,$bb,$a.Width)
$a.UnlockBits($da)
$b.UnlockBits($db)
$a.Dispose()
$b.Dispose()
@{ differentPixels=$result[0]; minX=$result[1]; minY=$result[2]; maxX=$result[3]; maxY=$result[4]; maximumChannelDelta=$result[5]; comparison='Unmodified PNGs decoded using System.Drawing; no pixel threshold applied to acceptance.' } | ConvertTo-Json
