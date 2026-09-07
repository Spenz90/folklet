$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$crewImages = [Collections.Generic.List[byte[]]]::new()
$crewSizes = @(16,24,32,48,64,128,256)
foreach ($crewSize in $crewSizes) {
    $crewBitmap = [Drawing.Bitmap]::new($crewSize,$crewSize)
    $crewGraphics = [Drawing.Graphics]::FromImage($crewBitmap)
    $crewGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $crewGraphics.ScaleTransform(($crewSize / 256.0),($crewSize / 256.0))
    $crewBackground = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(34,36,35))
    $crewGraphics.FillEllipse($crewBackground,0,0,256,256)
    $crewPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(248,248,245),27)
    $crewPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
    $crewPen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $crewGraphics.DrawArc($crewPen,61,61,134,134,42,276)
    $crewAccent = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(161,192,161))
    $crewGraphics.FillEllipse($crewAccent,173,63,26,26)
    $crewStream = [IO.MemoryStream]::new()
    $crewBitmap.Save($crewStream,[Drawing.Imaging.ImageFormat]::Png)
    $crewImages.Add($crewStream.ToArray())
    $crewStream.Dispose(); $crewAccent.Dispose(); $crewPen.Dispose(); $crewBackground.Dispose(); $crewGraphics.Dispose(); $crewBitmap.Dispose()
}
$crewIcon = [IO.File]::Create((Join-Path $PSScriptRoot 'crew.ico'))
$crewWriter = [IO.BinaryWriter]::new($crewIcon)
$crewWriter.Write([uint16]0); $crewWriter.Write([uint16]1); $crewWriter.Write([uint16]$crewSizes.Count)
$crewOffset = 6 + 16 * $crewSizes.Count
for ($crewIndex = 0; $crewIndex -lt $crewSizes.Count; $crewIndex++) {
    $crewDimension = if ($crewSizes[$crewIndex] -eq 256) { 0 } else { $crewSizes[$crewIndex] }
    $crewWriter.Write([byte]$crewDimension); $crewWriter.Write([byte]$crewDimension); $crewWriter.Write([byte]0); $crewWriter.Write([byte]0)
    $crewWriter.Write([uint16]1); $crewWriter.Write([uint16]32); $crewWriter.Write([uint32]$crewImages[$crewIndex].Length); $crewWriter.Write([uint32]$crewOffset)
    $crewOffset += $crewImages[$crewIndex].Length
}
foreach ($crewImage in $crewImages) { $crewWriter.Write($crewImage) }
$crewWriter.Dispose(); $crewIcon.Dispose()
