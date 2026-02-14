@echo off
chcp 65001 > nul
echo ===================================================
echo Intel XPU (Arc GPU) 用環境セットアップを開始します
echo ===================================================

echo.
echo [1/6] pipのアップグレード...
python -m pip install --upgrade pip

echo.
echo [2/6] PyTorch (XPU版) のインストール...
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu

echo.
echo [3/6] IPEX と psutil のインストール...
pip install intel-extension-for-pytorch
pip install psutil
pip show psutil
pip install intel-extension-for-pytorch --index-url https://pytorch-extension.intel.com/release-whl/stable/xpu/us/

echo.
echo [4/6] PyTorchのバージョン確認...
python -c "import torch; print('PyTorch Version:', torch.__version__)"

echo.
echo [5/6] requirements.txt から bitsandbytes を除外してインストール...
:: findstrコマンドを使って bitsandbytes を含まない行だけを抽出し、上書きします
findstr /V /I "bitsandbytes" requirements.txt > requirements_temp.txt
move /Y requirements_temp.txt requirements.txt
pip install -r requirements.txt

echo.
echo [6/6] Pythonファイル内の cuda を xpu に書き換え...
:: バッチファイル内からPowerShellスクリプトを一時生成して実行します
echo Get-ChildItem -Path . -Filter "*.py" -Recurse ^| ForEach-Object { > temp_replace.ps1
echo     $content = Get-Content $_.FullName -Raw >> temp_replace.ps1
echo     $newContent = $content -replace '"cuda"', '"xpu"' -replace "'cuda'", "'xpu'" -replace '\.cuda\(\)', '.to("xpu")' >> temp_replace.ps1
echo     if ($content -ne $newContent) { >> temp_replace.ps1
echo         Write-Host "Modifying: $($_.FullName)" >> temp_replace.ps1
echo         $newContent ^| Set-Content $_.FullName -NoNewline >> temp_replace.ps1
echo     } >> temp_replace.ps1
echo } >> temp_replace.ps1

:: 生成したPowerShellスクリプトを実行
powershell -NoProfile -ExecutionPolicy Bypass -File temp_replace.ps1

:: 実行後に一時ファイルを削除
del temp_replace.ps1

echo.
echo ===================================================
echo すべてのセットアップと書き換えが完了しました！
echo ===================================================
pause
