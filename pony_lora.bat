@echo off
chcp 65001 > nul
setlocal

echo ===================================================
echo Pony LoRA 学習実行スクリプト (UTF-8対応)
echo ===================================================
echo.

set "YAML_FILE=config\myscript_pony.yaml"

:: 事前にYAMLファイルが存在するかチェック
if not exist "%YAML_FILE%" (
    echo [エラー] 設定ファイルが見つかりません: %YAML_FILE%
    echo 実行場所が正しいか確認してください。
    pause
    exit /b
)

:: --- 1. LoRAの名前 ---
:INPUT_NAME_LOOP
set "INPUT_NAME="
set /p INPUT_NAME="1. LoRAの名前を入力してください (必須): "
if "%INPUT_NAME%"=="" (
    echo [エラー] LoRAの名前は必須です。
    goto INPUT_NAME_LOOP
)

:: --- 2. Ponyモデルのパス ---
:INPUT_MODEL_LOOP
echo.
set "INPUT_MODEL="
set /p INPUT_MODEL="2. Ponyモデル(.safetensors)のパスを入力してください (必須): "
if "%INPUT_MODEL%"=="" (
    echo [エラー] モデルのパスは必須です。
    goto INPUT_MODEL_LOOP
)
set "INPUT_MODEL=%INPUT_MODEL:"=%"
if not exist "%INPUT_MODEL%" (
    echo [エラー] 指定されたファイルが見つかりません: "%INPUT_MODEL%"
    goto INPUT_MODEL_LOOP
)

:: --- 3. 学習用画像フォルダのパス ---
:INPUT_IMAGES_LOOP
echo.
set "INPUT_IMAGES="
set /p INPUT_IMAGES="3. 学習用画像フォルダのパスを入力してください (必須): "
if "%INPUT_IMAGES%"=="" (
    echo [エラー] 画像フォルダのパスは必須です。
    goto INPUT_IMAGES_LOOP
)
set "INPUT_IMAGES=%INPUT_IMAGES:"=%"
if not exist "%INPUT_IMAGES%\" (
    echo [エラー] 指定されたフォルダが見つかりません: "%INPUT_IMAGES%"
    goto INPUT_IMAGES_LOOP
)

:: --- 4. パスの変換 (\ を / に変換) ---
set "INPUT_MODEL=%INPUT_MODEL:\=/%"
set "INPUT_IMAGES=%INPUT_IMAGES:\=/%"

echo.
echo ---------------------------------------------------
echo 以下の設定で %YAML_FILE% を書き換えます:
echo [LoRA Name]  %INPUT_NAME%
echo [Model Path] %INPUT_MODEL%
echo [Image Dir]  %INPUT_IMAGES%
echo ---------------------------------------------------

:: --- 5. PowerShellを使ってYAMLファイルを書き換え (UTF-8指定) ---
echo $yamlPath = "%YAML_FILE%" > temp_update.ps1
echo $newName = "%INPUT_NAME%" >> temp_update.ps1
echo $newModel = "%INPUT_MODEL%" >> temp_update.ps1
echo $newImages = "%INPUT_IMAGES%" >> temp_update.ps1
:: ファイルをUTF-8として読み込む
echo $content = Get-Content $yamlPath -Raw -Encoding UTF8 >> temp_update.ps1
:: 置換処理
echo $content = $content -replace '(?m)^(\s*name:\s*)\".*?\"', "`$1`"$newName`"" >> temp_update.ps1
echo $content = $content -replace '(?m)^(\s*name_or_path:\s*)\".*?\"', "`$1`"$newModel`"" >> temp_update.ps1
echo $content = $content -replace '(?m)^(\s*-\s*folder_path:\s*)\".*?\"', "`$1`"$newImages`"" >> temp_update.ps1
:: BOMなしのUTF-8で保存する (Pythonでエラーを出さないため)
echo $utf8NoBom = New-Object System.Text.UTF8Encoding $False >> temp_update.ps1
echo [System.IO.File]::WriteAllText($yamlPath, $content, $utf8NoBom) >> temp_update.ps1

powershell -NoProfile -ExecutionPolicy Bypass -File temp_update.ps1
del temp_update.ps1

echo YAMLファイルの更新が完了しました。
echo.
echo ===================================================
echo 学習処理を開始します...
echo ===================================================

:: --- 6. Pythonスクリプトの実行 ---
python run.py %YAML_FILE%

echo.
echo 処理が完了しました。
pause
