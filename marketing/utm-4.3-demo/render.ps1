$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Assets = Join-Path $Root 'assets'
$Work = Join-Path $Root 'work'
$Frames = Join-Path $Root 'frames'
$Ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$Ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

$Width = 1920
$Height = 1080
$Fps = 30
$SceneDuration = 5.5
$TransitionDuration = 0.45
$FinalDuration = ($SceneDuration * 8) - ($TransitionDuration * 7)
$BoldFont = 'C\:/Windows/Fonts/seguisb.ttf'
$RegularFont = 'C\:/Windows/Fonts/segoeui.ttf'
$Background = 'gradients=s=1920x1080:c0=0x050914:c1=0x0a2235:x0=0:y0=0:x1=1920:y1=1080:r=30:d=5.5'

New-Item -ItemType Directory -Force -Path $Work, $Frames | Out-Null

function Invoke-Ffmpeg {
    param([Parameter(Mandatory)][string[]]$Arguments)
    & $Ffmpeg -hide_banner -loglevel warning @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg failed with exit code $LASTEXITCODE"
    }
}

function Assert-Asset {
    param([Parameter(Mandatory)][string]$Name)
    $Path = Join-Path $Assets $Name
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing pinned source asset: $Path"
    }
    return $Path
}

function Render-Scene {
    param(
        [Parameter(Mandatory)][int]$Number,
        [Parameter(Mandatory)][string[]]$Inputs,
        [Parameter(Mandatory)][string]$Filter
    )

    $Output = Join-Path $Work ("scene-{0:D2}.mp4" -f $Number)
    $Args = @('-y', '-f', 'lavfi', '-i', $Background)
    foreach ($InputPath in $Inputs) {
        $Args += @('-loop', '1', '-framerate', "$Fps", '-t', "$SceneDuration", '-i', $InputPath)
    }
    $Args += @(
        '-filter_complex', $Filter,
        '-map', '[out]',
        '-t', "$SceneDuration",
        '-r', "$Fps",
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '17',
        '-pix_fmt', 'yuv420p',
        '-an',
        '-movflags', '+faststart',
        $Output
    )
    Invoke-Ffmpeg -Arguments $Args
}

# Rasterize the two authored SVG assets deterministically when the pinned PNGs are absent.
if (-not (Test-Path -LiteralPath (Join-Path $Assets 'uem-mark.png'))) {
    if (-not (Test-Path -LiteralPath $Edge)) { throw "Microsoft Edge is required to rasterize uem-mark.svg" }
    & $Edge --headless=new --disable-gpu --hide-scrollbars `
        --user-data-dir="$Work\edge-profile-mark" --default-background-color=00000000 `
        --window-size=256,256 --screenshot="$Assets\uem-mark.png" `
        "file:///O:/UEFN%20Entitlement%20Manager/marketing/utm-4.3-demo/assets/uem-mark.svg"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to rasterize uem-mark.svg' }
}

if (-not (Test-Path -LiteralPath (Join-Path $Assets 'utm-mcp-workflow.png'))) {
    if (-not (Test-Path -LiteralPath $Edge)) { throw "Microsoft Edge is required to rasterize utm-mcp-workflow.svg" }
    & $Edge --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 `
        --user-data-dir="$Work\edge-profile-diagram" --window-size=1200,680 `
        --screenshot="$Assets\utm-mcp-workflow.png" `
        "file:///O:/UEFN%20Entitlement%20Manager/marketing/utm-4.3-demo/assets/utm-mcp-workflow.svg"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to rasterize utm-mcp-workflow.svg' }
}

$Mark = Assert-Asset 'uem-mark.png'
$Catalog = Assert-Asset 'catalog-overview.png'
$Offer = Assert-Asset 'offer-editor.png'
$Dynamic = Assert-Asset 'dynamic-transactions.png'
$Icons = Assert-Asset 'icon-texture.png'
$Bundles = Assert-Asset 'bundles-storefronts.png'
$Validation = Assert-Asset 'validation.png'
$Verse = Assert-Asset 'verse-integration.png'
$Agent = Assert-Asset 'agent-integration.png'
$Diagram = Assert-Asset 'utm-mcp-workflow.png'

$Scene1 = @"
[0:v]format=rgba,
 drawbox=x=90:y=80:w=8:h=920:color=0x55e6f0@0.85:t=fill,
 drawbox=x=112:y=80:w=420:h=2:color=0x55e6f0@0.55:t=fill,
 drawbox=x=1470:y=998:w=360:h=2:color=0x8b5cf6@0.65:t=fill[bg];
[1:v]scale=230:230:flags=lanczos,format=rgba,
 fade=t=in:st=0.20:d=0.65:alpha=1[mark];
[bg][mark]overlay=x=205:y=350:format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='UEFN TRANSACTION MANAGER':fontcolor=0xf8fafc:fontsize=64:x=520:y=300,
 drawtext=fontfile='$RegularFont':text='Build in-island transactions visually.':fontcolor=0xb9cbe0:fontsize=38:x=523:y=395,
 drawtext=fontfile='$BoldFont':text='ENTITLEMENTS   OFFERS   BUNDLES   STOREFRONTS':fontcolor=0x55e6f0:fontsize=22:x=526:y=485,
 drawbox=x=520:y=560:w=570:h=72:color=0x10273b@0.86:t=fill,
 drawtext=fontfile='$BoldFont':text='WINDOWS DESKTOP APP':fontcolor=0xf8fafc:fontsize=21:x=552:y=581,
 drawtext=fontfile='$BoldFont':text='4.3.0':fontcolor=0x8be9f1:fontsize=21:x=973:y=581,
 drawtext=fontfile='$RegularFont':text='Created by ADEPT Interactive':fontcolor=0x7f96b2:fontsize=20:x=520:y=695,
 fade=t=in:st=0:d=0.25,fade=t=out:st=5.15:d=0.35[out]
"@
Render-Scene -Number 1 -Inputs @($Mark) -Filter $Scene1

$Scene2 = @"
[0:v]format=rgba,
 drawbox=x=0:y=0:w=1920:h=8:color=0x55e6f0@0.75:t=fill,
 drawbox=x=250:y=223:w=1420:h=766:color=0x020711@0.58:t=fill[bg];
[1:v]scale=1380:740:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.15:d=0.45:alpha=1[shot];
[bg][shot]overlay=x='(W-w)/2+4*sin(t*0.45)':y='237+3*sin(t*0.35)':format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='BUILD YOUR CATALOG VISUALLY':fontcolor=0xf8fafc:fontsize=49:x=250:y=82,
 drawtext=fontfile='$RegularFont':text='See every offer, price, entitlement, and issue in one workspace.':fontcolor=0x9fb4cd:fontsize=27:x=253:y=150,
 drawtext=fontfile='$BoldFont':text='01  CATALOG':fontcolor=0x55e6f0:fontsize=18:x=1645:y=95,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.20:d=0.30[out]
"@
Render-Scene -Number 2 -Inputs @($Catalog) -Filter $Scene2

$Scene3 = @"
[0:v]format=rgba,
 drawbox=x=100:y=245:w=816:h=720:color=0x07101f@0.88:t=fill,
 drawbox=x=1004:y=245:w=816:h=720:color=0x07101f@0.88:t=fill[bg];
[1:v]scale=760:690:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.10:d=0.42:alpha=1[left];
[2:v]scale=760:690:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.34:d=0.46:alpha=1[right];
[bg][left]overlay=x='128+3*sin(t*0.40)':y=258:format=auto:shortest=1[tmp];
[tmp][right]overlay=x='1032-3*sin(t*0.42)':y=258:format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='CREATE THE OFFER. CONTROL THE RUNTIME.':fontcolor=0xf8fafc:fontsize=48:x=100:y=72,
 drawtext=fontfile='$RegularFont':text='A guided visual flow for creators. Dynamic pricing and quantities when the game needs them.':fontcolor=0x9fb4cd:fontsize=25:x=103:y=140,
 drawtext=fontfile='$BoldFont':text='GUIDED OFFER EDITOR':fontcolor=0x55e6f0:fontsize=18:x=128:y=985,
 drawtext=fontfile='$BoldFont':text='DYNAMIC TRANSACTIONS':fontcolor=0xb99cff:fontsize=18:x=1032:y=985,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.20:d=0.30[out]
"@
Render-Scene -Number 3 -Inputs @($Offer, $Dynamic) -Filter $Scene3

$Scene4 = @"
[0:v]format=rgba,
 drawbox=x=770:y=130:w=920:h=820:color=0x07101f@0.88:t=fill,
 drawbox=x=175:y=276:w=74:h=4:color=0x55e6f0@0.95:t=fill,
 drawbox=x=175:y=742:w=410:h=1:color=0x29465e@0.85:t=fill[bg];
[1:v]scale=850:710:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.20:d=0.45:alpha=1[shot];
[bg][shot]overlay=x='805+4*sin(t*0.42)':y='182+3*sin(t*0.36)':format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='YOUR ICONS.':fontcolor=0xf8fafc:fontsize=59:x=175:y=318,
 drawtext=fontfile='$BoldFont':text='YOUR PROJECT.':fontcolor=0x55e6f0:fontsize=59:x=175:y=390,
 drawtext=fontfile='$RegularFont':text='Adopt existing UEFN Texture2Ds.':fontcolor=0xc1d1e3:fontsize=28:x=178:y=510,
 drawtext=fontfile='$RegularFont':text='Import ordinary images safely.':fontcolor=0xc1d1e3:fontsize=28:x=178:y=558,
 drawtext=fontfile='$RegularFont':text='Keep moving with a clear placeholder.':fontcolor=0xc1d1e3:fontsize=28:x=178:y=606,
 drawtext=fontfile='$BoldFont':text='NATIVE TEXTURE2D WORKFLOW':fontcolor=0x8b9fba:fontsize=18:x=178:y=770,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.20:d=0.30[out]
"@
Render-Scene -Number 4 -Inputs @($Icons) -Filter $Scene4

$Scene5 = @"
[0:v]format=rgba,
 drawbox=x=260:y=230:w=1400:h=740:color=0x020711@0.58:t=fill[bg];
[1:v]scale=1360:720:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.14:d=0.46:alpha=1[shot];
[bg][shot]overlay=x='(W-w)/2+4*sin(t*0.36)':y='240+2*sin(t*0.48)':format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='COMPOSE MORE THAN A SINGLE OFFER':fontcolor=0xf8fafc:fontsize=48:x=260:y=78,
 drawtext=fontfile='$RegularFont':text='Bundle value. Curate storefronts. Keep every relationship visible.':fontcolor=0xa8bad1:fontsize=27:x=263:y=146,
 drawtext=fontfile='$BoldFont':text='BUNDLES + STOREFRONTS':fontcolor=0x55e6f0:fontsize=18:x=1392:y=985,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.20:d=0.30[out]
"@
Render-Scene -Number 5 -Inputs @($Bundles) -Filter $Scene5

$Scene6 = @"
[0:v]format=rgba,
 drawbox=x=86:y=286:w=702:h=610:color=0x07101f@0.90:t=fill,
 drawbox=x=834:y=220:w=1000:h=694:color=0x07101f@0.90:t=fill[bg];
[1:v]scale=650:520:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.12:d=0.42:alpha=1[val];
[2:v]scale=950:660:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.30:d=0.46:alpha=1[verse];
[bg][val]overlay=x=112:y=330:format=auto:shortest=1[tmp];
[tmp][verse]overlay=x='859+3*sin(t*0.40)':y=238:format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='VALIDATE. GENERATE. COMPILE.':fontcolor=0xf8fafc:fontsize=50:x=86:y=73,
 drawtext=fontfile='$RegularFont':text='Actionable guidance and generated Verse keep transaction plumbing understandable.':fontcolor=0xa8bad1:fontsize=26:x=89:y=142,
 drawtext=fontfile='$BoldFont':text='CREATOR-FACING VALIDATION':fontcolor=0x55e6f0:fontsize=18:x=112:y=918,
 drawtext=fontfile='$BoldFont':text='MANAGED VERSE':fontcolor=0xb99cff:fontsize=18:x=858:y=936,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.20:d=0.30[out]
"@
Render-Scene -Number 6 -Inputs @($Validation, $Verse) -Filter $Scene6

$Scene7 = @"
[0:v]format=rgba,
 drawbox=x=92:y=260:w=630:h=710:color=0x07101f@0.90:t=fill,
 drawbox=x=754:y=280:w=1080:h=650:color=0x07101f@0.90:t=fill[bg];
[1:v]scale=580:645:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.14:d=0.44:alpha=1[agent];
[2:v]crop=1160:640:20:20,scale=1030:568:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,
 fade=t=in:st=0.34:d=0.46:alpha=1[diagram];
[bg][agent]overlay=x=117:y=290:format=auto:shortest=1[tmp];
[tmp][diagram]overlay=x='779+3*sin(t*0.38)':y=320:format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='AGENT-READY. STILL VISUAL-FIRST.':fontcolor=0xf8fafc:fontsize=49:x=92:y=69,
 drawtext=fontfile='$RegularFont':text='UTM MCP owns transactions. Unreal MCP owns editor automation. Your gameplay stays yours.':fontcolor=0xa8bad1:fontsize=25:x=95:y=136,
 drawbox=x=92:y=195:w=217:h=46:color=0x0d3342@0.90:t=fill,
 drawtext=fontfile='$BoldFont':text='AGENTS OPTIONAL':fontcolor=0x72e5ed:fontsize=17:x=114:y=208,
 drawtext=fontfile='$BoldFont':text='EXISTING-PROJECT MIGRATION':fontcolor=0xb99cff:fontsize=18:x=1491:y=957,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.20:d=0.30[out]
"@
Render-Scene -Number 7 -Inputs @($Agent, $Diagram) -Filter $Scene7

$Scene8 = @"
[0:v]format=rgba,
 drawbox=x=90:y=80:w=8:h=920:color=0x8b5cf6@0.85:t=fill,
 drawbox=x=112:y=998:w=440:h=2:color=0x55e6f0@0.60:t=fill,
 drawbox=x=1510:y=80:w=320:h=2:color=0x8b5cf6@0.65:t=fill[bg];
[1:v]scale=210:210:flags=lanczos,format=rgba,
 fade=t=in:st=0.15:d=0.52:alpha=1[mark];
[bg][mark]overlay=x=250:y=382:format=auto:shortest=1,
 drawtext=fontfile='$BoldFont':text='BUILD VISUALLY.':fontcolor=0xf8fafc:fontsize=74:x=560:y=280,
 drawtext=fontfile='$BoldFont':text='AUTOMATE WHEN IT HELPS.':fontcolor=0x55e6f0:fontsize=74:x=560:y=375,
 drawtext=fontfile='$RegularFont':text='UEFN Transaction Manager 4.3':fontcolor=0xc3d2e4:fontsize=35:x=565:y=520,
 drawtext=fontfile='$RegularFont':text='A Windows app by ADEPT Interactive':fontcolor=0x8299b5:fontsize=25:x=566:y=582,
 drawbox=x=560:y=670:w=530:h=72:color=0x10273b@0.86:t=fill,
 drawtext=fontfile='$BoldFont':text='VISUAL FIRST  ·  AGENT READY':fontcolor=0xf8fafc:fontsize=21:x=604:y=692,
 fade=t=in:st=0:d=0.18,fade=t=out:st=5.15:d=0.35[out]
"@
Render-Scene -Number 8 -Inputs @($Mark) -Filter $Scene8

$SceneFiles = 1..8 | ForEach-Object { Join-Path $Work ("scene-{0:D2}.mp4" -f $_) }
$CombineArgs = @('-y')
foreach ($SceneFile in $SceneFiles) { $CombineArgs += @('-i', $SceneFile) }

$Offsets = 1..7 | ForEach-Object { [math]::Round(($_ * ($SceneDuration - $TransitionDuration)), 2) }
$Xfade = "[0:v][1:v]xfade=transition=fadeblack:duration=$TransitionDuration`:offset=$($Offsets[0])[x1];"
for ($Index = 2; $Index -le 7; $Index++) {
    $InputIndex = $Index
    $Prior = "x$($Index - 1)"
    $Next = if ($Index -eq 7) { 'video' } else { "x$Index" }
    $Xfade += "[$Prior][$InputIndex`:v]xfade=transition=fadeblack:duration=$TransitionDuration`:offset=$($Offsets[$Index - 1])[$Next];"
}
$Xfade = $Xfade.TrimEnd(';')

$SilentVideo = Join-Path $Work 'utm-4.3-demo-video.mp4'
$CombineArgs += @(
    '-filter_complex', $Xfade,
    '-map', '[video]',
    '-t', "$FinalDuration",
    '-r', "$Fps",
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    $SilentVideo
)
Invoke-Ffmpeg -Arguments $CombineArgs

# A restrained, deterministic ambient bed. It is generated from pure tones, uses no
# third-party recording, and remains quiet enough for the text-first social cut.
$FinalVideo = Join-Path $Root 'utm-4.3-demo.mp4'
$AudioFilter = "[1:a]volume=0.600,tremolo=f=0.12:d=0.45[a1];[2:a]volume=0.360,tremolo=f=0.11:d=0.30[a2];[3:a]volume=0.240,tremolo=f=0.13:d=0.25[a3];[a1][a2][a3]amix=inputs=3:normalize=0,highpass=f=38,lowpass=f=420,afade=t=in:st=0:d=1.2,afade=t=out:st=$([math]::Round($FinalDuration - 1.6, 2)):d=1.6[audio]"
Invoke-Ffmpeg -Arguments @(
    '-y',
    '-i', $SilentVideo,
    '-f', 'lavfi', '-i', "sine=frequency=55:sample_rate=48000:duration=$FinalDuration",
    '-f', 'lavfi', '-i', "sine=frequency=82.4069:sample_rate=48000:duration=$FinalDuration",
    '-f', 'lavfi', '-i', "sine=frequency=110:sample_rate=48000:duration=$FinalDuration",
    '-filter_complex', $AudioFilter,
    '-map', '0:v:0', '-map', '[audio]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k',
    '-shortest',
    '-movflags', '+faststart',
    $FinalVideo
)

$Poster = Join-Path $Root 'utm-4.3-demo-poster.png'
Invoke-Ffmpeg -Arguments @('-y', '-ss', '2.4', '-i', $FinalVideo, '-frames:v', '1', '-update', '1', $Poster)

$Times = @(2.4, 7.8, 12.9, 18.1, 23.2, 28.3, 33.4, 38.4)
for ($Index = 0; $Index -lt $Times.Count; $Index++) {
    $Frame = Join-Path $Frames ("review-{0:D2}.png" -f ($Index + 1))
    Invoke-Ffmpeg -Arguments @('-y', '-ss', "$($Times[$Index])", '-i', $FinalVideo, '-frames:v', '1', '-update', '1', $Frame)
}

$ProbePath = Join-Path $Root 'ffprobe.json'
& $Ffprobe -v error -show_format -show_streams -of json $FinalVideo | Set-Content -LiteralPath $ProbePath -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'ffprobe validation failed' }

$Hashes = Get-ChildItem -LiteralPath $Assets -File | Sort-Object Name | ForEach-Object {
    $Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
    "{0}  assets/{1}" -f $Hash.Hash.ToLowerInvariant(), $_.Name
}
$Hashes | Set-Content -LiteralPath (Join-Path $Root 'assets.sha256') -Encoding ascii

$Probe = Get-Content -LiteralPath $ProbePath -Raw | ConvertFrom-Json
$VideoStream = $Probe.streams | Where-Object codec_type -eq 'video' | Select-Object -First 1
$AudioStream = $Probe.streams | Where-Object codec_type -eq 'audio' | Select-Object -First 1
Write-Output ("Rendered {0}" -f $FinalVideo)
Write-Output ("Video: {0} {1}x{2} {3} fps, {4}s" -f $VideoStream.codec_name, $VideoStream.width, $VideoStream.height, $VideoStream.avg_frame_rate, $Probe.format.duration)
Write-Output ("Audio: {0} {1} Hz" -f $AudioStream.codec_name, $AudioStream.sample_rate)
