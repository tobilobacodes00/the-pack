param([string]$in,[string]$out,[int]$margin=48)
Add-Type -AssemblyName System.Drawing
$img=[System.Drawing.Bitmap]::FromFile($in)
$w=$img.Width;$h=$img.Height
$bottom=0;$right=0
# scan for content (any channel < 248)
for($y=$h-1;$y -ge 0;$y--){ $hit=$false
  for($x=0;$x -lt $w;$x+=5){ $p=$img.GetPixel($x,$y); if($p.R -lt 248 -or $p.G -lt 248 -or $p.B -lt 248){$hit=$true;break} }
  if($hit){$bottom=$y;break} }
for($x=$w-1;$x -ge 0;$x--){ $hit=$false
  for($y=0;$y -lt $h;$y+=5){ $p=$img.GetPixel($x,$y); if($p.R -lt 248 -or $p.G -lt 248 -or $p.B -lt 248){$hit=$true;break} }
  if($hit){$right=$x;break} }
$nw=[Math]::Min($w,$right+$margin);$nh=[Math]::Min($h,$bottom+$margin)
$crop=New-Object System.Drawing.Bitmap($nw,$nh)
$g=[System.Drawing.Graphics]::FromImage($crop)
$g.DrawImage($img,(New-Object System.Drawing.Rectangle(0,0,$nw,$nh)),(New-Object System.Drawing.Rectangle(0,0,$nw,$nh)),[System.Drawing.GraphicsUnit]::Pixel)
$crop.Save($out,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$crop.Dispose();$img.Dispose()
Write-Output "cropped $nw x $nh -> $out"
