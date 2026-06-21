//! 实时语音识别模块
//!
//! 基于 sherpa-onnx 的 Silero VAD + SenseVoice 分段识别策略：
//! VAD 检测语音段 → 每段调用 SenseVoice 离线识别 → 通过 Tauri event 推送结果。
//! 体验接近语音输入法：说完一句话（VAD 检测到尾端静音）后立即出字。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, Emitter, Manager, State};

// ============================================================
// 模型定义与镜像源
// ============================================================

/// 单个模型文件定义
#[derive(Debug, Clone, Serialize)]
struct ModelFileDef {
    /// 保存到本地的文件名
    filename: &'static str,
    /// GitHub 下载路径后缀
    github_path: &'static str,
    /// ModelScope 下载路径后缀（None = 该镜像不可用，回退 GitHub）
    #[serde(skip_serializing)]
    modelscope_path: Option<&'static str>,
    /// 近似大小（字节）
    approx_size: u64,
}

/// 可选模型定义
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDef {
    /// 模型 ID（唯一标识）
    id: &'static str,
    /// 显示名称
    name: &'static str,
    /// 描述
    description: &'static str,
    /// 支持的语言
    languages: &'static str,
    /// 模型类型：sense_voice / paraformer_streaming
    model_type: &'static str,
    /// 模型文件列表
    files: &'static [ModelFileDef],
}

/// 镜像源定义
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MirrorSource {
    id: &'static str,
    name: &'static str,
    /// base URL 前缀
    base_url: &'static str,
}

/// 可用模型列表
const MODELS: &[ModelDef] = &[
    ModelDef {
        id: "sense-voice-zh-en-ja-ko-yue",
        name: "SenseVoice (中英日韩粤)",
        description: "阿里达摩院 SenseVoice-Small，支持语音识别+标点恢复+情感识别",
        languages: "中/英/日/韩/粤",
        model_type: "sense_voice",
        files: &[
            ModelFileDef {
                filename: "model.int8.onnx",
                github_path: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx",
                modelscope_path: Some("model.int8.onnx"),
                approx_size: 234_000_000,
            },
            ModelFileDef {
                filename: "tokens.txt",
                github_path: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/tokens.txt",
                modelscope_path: Some("tokens.txt"),
                approx_size: 320_000,
            },
        ],
    },
];

/// VAD 模型（所有 ASR 模型共享，已打包到 App 资源中，无需下载）
const VAD_FILE: ModelFileDef = ModelFileDef {
    filename: "silero_vad.onnx",
    github_path: "",
    modelscope_path: None,
    approx_size: 644_000,
};

/// 可用镜像源
const MIRRORS: &[MirrorSource] = &[
    MirrorSource {
        id: "github",
        name: "GitHub (全球)",
        base_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models",
    },
    MirrorSource {
        id: "modelscope",
        name: "ModelScope (国内加速)",
        base_url: "https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master",
    },
];

/// 默认模型 ID
const DEFAULT_MODEL_ID: &str = "sense-voice-zh-en-ja-ko-yue";
/// 默认镜像 ID（ModelScope 对国内用户更快，且支持单文件下载）
const DEFAULT_MIRROR_ID: &str = "modelscope";

/// 配置文件名
const CONFIG_FILE: &str = "voice_config.json";

/// 语音配置（持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    /// 当前选中的模型 ID
    active_model_id: String,
    /// 当前选中的镜像源 ID
    mirror_id: String,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            active_model_id: DEFAULT_MODEL_ID.to_string(),
            mirror_id: DEFAULT_MIRROR_ID.to_string(),
        }
    }
}

/// 获取配置文件路径
fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {e}"))?;
    Ok(app_data.join(CONFIG_FILE))
}

/// 读取配置
fn read_config(app: &AppHandle) -> VoiceConfig {
    match get_config_path(app) {
        Ok(path) if path.exists() => {
            match std::fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => VoiceConfig::default(),
            }
        }
        _ => VoiceConfig::default(),
    }
}

/// 写入配置
fn write_config(app: &AppHandle, config: &VoiceConfig) -> Result<(), String> {
    let path = get_config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {e}"))
}

/// 根据 ID 获取模型定义
fn get_model_def(model_id: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.id == model_id)
}

/// 根据 ID 获取镜像源
fn get_mirror(mirror_id: &str) -> Option<&'static MirrorSource> {
    MIRRORS.iter().find(|m| m.id == mirror_id)
}

/// 确保 VAD 文件存在（从打包资源复制）
fn ensure_vad_file(app: &AppHandle, model_dir: &PathBuf) -> Result<(), String> {
    let vad_dest = model_dir.join(VAD_FILE.filename);
    if vad_dest.exists() {
        return Ok(());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource_dir: {e}"))?;
    let vad_source = resource_dir.join("resources").join("silero_vad.onnx");

    if !vad_source.exists() {
        return Err(format!(
            "Bundled VAD model not found: {}",
            vad_source.display()
        ));
    }

    std::fs::copy(&vad_source, &vad_dest)
        .map_err(|e| format!("Failed to copy VAD model: {e}"))?;

    println!(
        "[voice] Copied bundled VAD model ({} bytes) to {}",
        std::fs::metadata(&vad_dest).map(|m| m.len()).unwrap_or(0),
        vad_dest.display()
    );
    Ok(())
}

/// 构建文件下载 URL：优先使用选中镜像，若文件在该镜像不可用则回退 GitHub
fn build_download_url(mirror: &MirrorSource, file: &ModelFileDef) -> String {
    if mirror.id == "modelscope" {
        if let Some(ms_path) = file.modelscope_path {
            // 完整 URL（文件在不同仓库）→ 直接使用
            if ms_path.starts_with("http") {
                return ms_path.to_string();
            }
            // 相对路径 → 拼接镜像 base_url
            return format!("{}/{}", mirror.base_url, ms_path);
        }
        // ModelScope 上不可用 → 回退 GitHub
        let github = MIRRORS
            .iter()
            .find(|m| m.id == "github")
            .expect("github mirror must exist");
        return format!("{}/{}", github.base_url, file.github_path);
    }
    format!("{}/{}", mirror.base_url, file.github_path)
}

/// 重新下载模型（删除现有文件后重新下载）
#[command]
pub fn asr_redownload_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let model_dir = get_model_dir(&app)?;
    let model_def = get_model_def(&model_id)
        .ok_or_else(|| format!("Unknown model: {model_id}"))?;

    // 删除现有模型文件
    for file in model_def.files {
        let path = model_dir.join(file.filename);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
            println!("[voice] Deleted {}", file.filename);
        }
    }
    // 删除 VAD 文件
    let vad_path = model_dir.join(VAD_FILE.filename);
    if vad_path.exists() {
        let _ = std::fs::remove_file(&vad_path);
        println!("[voice] Deleted {}", VAD_FILE.filename);
    }

    // 切换到目标模型
    let mut config = read_config(&app);
    config.active_model_id = model_id;
    write_config(&app, &config)?;

    // 触发下载（文件已删除，不会跳过）
    asr_ensure_model(app)
}

/// 语音段消息（从主线程发送到处理线程）
enum AudioMessage {
    /// 一块 PCM 音频数据（16kHz mono f32）
    Samples(Vec<f32>),
    /// 停止信号
    Stop,
}

/// 语音识别会话
struct VoiceSession {
    sender: Sender<AudioMessage>,
}

/// Tauri managed state
pub struct VoiceState {
    inner: Mutex<Option<VoiceSession>>,
}

/// ASR 状态查询结果
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AsrStatus {
    /// 模型状态：not_downloaded / downloading / ready
    pub model_state: String,
    /// 模型目录路径
    pub model_dir: String,
    /// 是否正在录音
    pub listening: bool,
}

/// 模型下载进度事件
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub file_name: String,
    pub file_index: usize,
    pub total_files: usize,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

/// 获取模型存放目录（app_data_dir/models/voice）
fn get_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {e}"))?;
    let model_dir = app_data.join("models").join("voice");
    Ok(model_dir)
}

/// 检查指定模型文件是否全部存在（含 VAD）
fn check_model_files(model_dir: &PathBuf, model_def: &ModelDef) -> bool {
    model_def.files.iter().all(|f| model_dir.join(&f.filename).exists())
        && model_dir.join(VAD_FILE.filename).exists()
}

/// 获取单个模型文件的完整路径
fn get_model_path(model_dir: &PathBuf, file_name: &str) -> PathBuf {
    model_dir.join(file_name)
}

/// 下载单个文件，返回写入的字节数
/// 使用 reqwest::blocking 在独立线程中下载
fn download_file_blocking(
    url: &str,
    dest: &PathBuf,
    app: &AppHandle,
    file_name: &str,
    file_index: usize,
    total_files: usize,
    expected_size: u64,
) -> Result<u64, String> {
    use std::io::{Read, Write};

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut response = client
        .get(url)
        .header("Referer", "https://www.modelscope.cn/")
        .send()
        .map_err(|e| format!("Download failed for {file_name}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("HTTP error for {file_name}: {e}"))?;

    let total_size = response
        .content_length()
        .unwrap_or(expected_size);

    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create file {dest:?}: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 65536];
    let mut last_progress = Instant::now();

    loop {
        let bytes_read = response
            .read(&mut buffer)
            .map_err(|e| format!("Read error: {e}"))?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += bytes_read as u64;

        // 每隔 200ms 推送一次进度
        if last_progress.elapsed() > Duration::from_millis(200) {
            let percent = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };
            let _ = app.emit(
                "asr://download_progress",
                DownloadProgress {
                    file_name: file_name.to_string(),
                    file_index,
                    total_files,
                    downloaded,
                    total: total_size,
                    percent,
                },
            );
            last_progress = Instant::now();
        }
    }

    file.flush().map_err(|e| format!("Flush error: {e}"))?;

    // 最终进度
    let _ = app.emit(
        "asr://download_progress",
        DownloadProgress {
            file_name: file_name.to_string(),
            file_index,
            total_files,
            downloaded,
            total: total_size,
            percent: 100.0,
        },
    );

    Ok(downloaded)
}

/// 查询 ASR 状态
#[command]
pub fn asr_status(app: AppHandle, state: State<'_, VoiceState>) -> AsrStatus {
    let model_dir = get_model_dir(&app).unwrap_or_else(|_| PathBuf::from(""));
    let config = read_config(&app);
    let model_def = get_model_def(&config.active_model_id);
    let model_state = match model_def {
        Some(def) if check_model_files(&model_dir, def) => "ready".to_string(),
        _ => "not_downloaded".to_string(),
    };
    let listening = state.inner.lock().unwrap().is_some();

    AsrStatus {
        model_state,
        model_dir: model_dir.to_string_lossy().to_string(),
        listening,
    }
}

/// 确保模型已下载（如缺失则下载）
/// 根据配置中的 active_model_id 和 mirror_id 决定下载哪个模型、从哪个镜像下载。
/// 下载在后台线程中执行，通过 event 推送进度，命令立即返回。
#[command]
pub fn asr_ensure_model(app: AppHandle) -> Result<(), String> {
    let model_dir = get_model_dir(&app)?;
    std::fs::create_dir_all(&model_dir)
        .map_err(|e| format!("Failed to create model dir: {e}"))?;

    let config = read_config(&app);
    let model_def = get_model_def(&config.active_model_id)
        .ok_or_else(|| format!("Unknown model: {}", config.active_model_id))?;
    let mirror = get_mirror(&config.mirror_id)
        .ok_or_else(|| format!("Unknown mirror: {}", config.mirror_id))?;

    if check_model_files(&model_dir, model_def) {
        return Ok(());
    }

    println!("[voice] Starting model download to {}", model_dir.display());
    let _ = app.emit("asr://status", serde_json::json!({ "state": "downloading" }));

    // VAD 从打包资源复制（不参与下载）
    if let Err(e) = ensure_vad_file(&app, &model_dir) {
        let _ = app.emit("asr://status", serde_json::json!({ "state": "download_error", "error": e }));
        return Err(e);
    }

    // 准备下载文件列表（仅 ASR 模型文件，VAD 已从打包资源复制）
    let files_to_download: Vec<&'static ModelFileDef> = model_def.files.iter().collect();
    let total_files = files_to_download.len();
    let mirror_id = mirror.id;

    // 后台线程执行下载
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut downloaded_archives: std::collections::HashSet<String> = std::collections::HashSet::new();

        for (index, file_def) in files_to_download.iter().enumerate() {
            let dest = get_model_path(&model_dir, file_def.filename);
            if dest.exists() {
                println!("[voice] Skipping existing file: {}", file_def.filename);
                continue;
            }

            // GitHub 镜像：检查文件是否在 tar.bz2 压缩包内
            if mirror_id == "github" {
                if let Some(slash_pos) = file_def.github_path.find('/') {
                    let archive_name = &file_def.github_path[..slash_pos];

                    // 下载并解压压缩包（仅一次）
                    if !downloaded_archives.contains(archive_name) {
                        let github_mirror = MIRRORS.iter().find(|m| m.id == "github").unwrap();
                        let archive_url = format!("{}/{}.tar.bz2", github_mirror.base_url, archive_name);
                        let archive_path = model_dir.join(format!("{archive_name}.tar.bz2"));
                        println!("[voice] Downloading archive: {archive_url}");

                        match download_file_blocking(
                            &archive_url,
                            &archive_path,
                            &app_clone,
                            archive_name,
                            index + 1,
                            total_files,
                            file_def.approx_size,
                        ) {
                            Ok(_) => {
                                println!("[voice] Extracting archive: {archive_name}");
                                let output = std::process::Command::new("tar")
                                    .arg("xjf")
                                    .arg(&archive_path)
                                    .arg("-C")
                                    .arg(&model_dir)
                                    .output();
                                let _ = std::fs::remove_file(&archive_path);

                                match output {
                                    Ok(o) if o.status.success() => {
                                        println!("[voice] Archive extracted successfully");
                                        downloaded_archives.insert(archive_name.to_string());
                                    }
                                    Ok(o) => {
                                        let stderr = String::from_utf8_lossy(&o.stderr);
                                        let _ = app_clone.emit("asr://status",
                                            serde_json::json!({ "state": "download_error", "error": format!("Extraction failed: {stderr}") }));
                                        return;
                                    }
                                    Err(e) => {
                                        let _ = app_clone.emit("asr://status",
                                            serde_json::json!({ "state": "download_error", "error": format!("Failed to run tar: {e}") }));
                                        return;
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = std::fs::remove_file(&archive_path);
                                let _ = app_clone.emit("asr://status",
                                    serde_json::json!({ "state": "download_error", "error": e }));
                                return;
                            }
                        }
                    }

                    // 从解压目录移动文件到模型目录
                    let extracted_file = model_dir.join(archive_name).join(file_def.filename);
                    if extracted_file.exists() {
                        if let Err(e) = std::fs::rename(&extracted_file, &dest) {
                            if let Err(e2) = std::fs::copy(&extracted_file, &dest) {
                                let _ = app_clone.emit("asr://status",
                                    serde_json::json!({ "state": "download_error", "error": format!("Failed to move {}: {e}, copy: {e2}", file_def.filename) }));
                                return;
                            }
                            let _ = std::fs::remove_file(&extracted_file);
                        }
                        let size = dest.metadata().map(|m| m.len()).unwrap_or(0);
                        println!("[voice] Extracted {}: {} bytes", file_def.filename, size);
                    }
                    continue;
                }
            }

            // 直接下载（ModelScope 或 GitHub 独立文件如 VAD）
            let url = build_download_url(
                &MIRRORS.iter().find(|m| m.id == mirror_id).unwrap(),
                file_def,
            );
            println!(
                "[voice] Downloading {} ({}/{total_files}) from {url}",
                file_def.filename,
                index + 1
            );

            match download_file_blocking(
                &url,
                &dest,
                &app_clone,
                file_def.filename,
                index + 1,
                total_files,
                file_def.approx_size,
            ) {
                Ok(bytes) => {
                    println!("[voice] Downloaded {}: {} bytes", file_def.filename, bytes);
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&dest);
                    let _ = app_clone.emit(
                        "asr://status",
                        serde_json::json!({ "state": "download_error", "error": e }),
                    );
                    return;
                }
            }
        }

        // 清理解压后的临时目录
        for archive_name in &downloaded_archives {
            let dir = model_dir.join(archive_name);
            if dir.exists() {
                let _ = std::fs::remove_dir_all(&dir);
                println!("[voice] Cleaned up extracted dir: {archive_name}");
            }
        }

        println!("[voice] All model files downloaded successfully");
        let _ = app_clone.emit("asr://status", serde_json::json!({ "state": "ready" }));
    });

    Ok(())
}

/// 后台音频处理线程：VAD 分段 + 离线识别
#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
fn audio_processing_thread(
    app: AppHandle,
    receiver: Receiver<AudioMessage>,
    model_dir: PathBuf,
    model_def: &'static ModelDef,
) {
    println!("[voice] Processing thread started, model: {}", model_def.id);

    // --- 初始化 VAD ---
    let mut vad_config = sherpa_onnx::VadModelConfig::default();
    vad_config.silero_vad.model =
        Some(get_model_path(&model_dir, VAD_FILE.filename).to_string_lossy().to_string());
    vad_config.silero_vad.threshold = 0.5;
    vad_config.silero_vad.min_silence_duration = 0.5; // 500ms 静音判定句尾
    vad_config.silero_vad.min_speech_duration = 0.25;
    vad_config.silero_vad.max_speech_duration = 15.0;
    vad_config.silero_vad.window_size = 512;
    vad_config.sample_rate = 16000;
    vad_config.debug = false;

    let vad = match sherpa_onnx::VoiceActivityDetector::create(&vad_config, 20.0) {
        Some(v) => v,
        None => {
            eprintln!("[voice] Failed to create VAD");
            let _ = app.emit("asr://error", serde_json::json!({ "error": "VAD init failed" }));
            return;
        }
    };

    // --- 初始化离线识别器（根据 model_type 配置）---
    let model_file = model_def
        .files
        .iter()
        .find(|f| f.filename.ends_with(".onnx"))
        .expect("model .onnx file not found in model def");
    let tokens_file = model_def
        .files
        .iter()
        .find(|f| f.filename == "tokens.txt")
        .expect("tokens.txt not found in model def");

    let mut asr_config = sherpa_onnx::OfflineRecognizerConfig::default();
    match model_def.model_type {
        "sense_voice" => {
            asr_config.model_config.sense_voice.model =
                Some(get_model_path(&model_dir, model_file.filename).to_string_lossy().to_string());
            asr_config.model_config.sense_voice.language = Some("auto".to_string());
            asr_config.model_config.sense_voice.use_itn = true; // 启用标点与 ITN
        }
        other => {
            eprintln!("[voice] Unsupported model type: {other}");
            let _ = app.emit(
                "asr://error",
                serde_json::json!({ "error": format!("Unsupported model type: {other}") }),
            );
            return;
        }
    }
    asr_config.model_config.tokens =
        Some(get_model_path(&model_dir, tokens_file.filename).to_string_lossy().to_string());
    asr_config.model_config.num_threads = 2;
    asr_config.model_config.debug = false;

    let recognizer = match sherpa_onnx::OfflineRecognizer::create(&asr_config) {
        Some(r) => r,
        None => {
            eprintln!("[voice] Failed to create recognizer");
            let _ = app.emit("asr://error", serde_json::json!({ "error": "Recognizer init failed" }));
            return;
        }
    };

    println!("[voice] VAD + {} initialized, ready to receive audio", model_def.name);

    // --- 处理循环 ---
    let sample_rate: i32 = 16000;
    let window_size: usize = 512;

    let mut buffer: Vec<f32> = Vec::new();
    let mut offset: usize = 0;
    let mut speech_started = false;
    let mut last_interim_time: Option<Instant> = None;

    loop {
        match receiver.recv() {
            Ok(AudioMessage::Samples(samples)) => {
                buffer.extend_from_slice(&samples);

                // 按 window_size 分块喂给 VAD
                while offset + window_size <= buffer.len() {
                    vad.accept_waveform(&buffer[offset..offset + window_size]);

                    if !speech_started && vad.detected() {
                        speech_started = true;
                        last_interim_time = Some(Instant::now());
                        println!("[voice] Speech detected");
                    }
                    offset += window_size;
                }

                // 如果语音未开始且 buffer 过大，裁剪前面的数据
                if !speech_started && buffer.len() > 10 * window_size {
                    let trim_amount = buffer.len() - 10 * window_size;
                    offset = offset.saturating_sub(trim_amount);
                    buffer = buffer[buffer.len() - 10 * window_size..].to_vec();
                }

                // 语音进行中：每 300ms 做一次中间识别（partial）
                if speech_started {
                    if let Some(ref last) = last_interim_time {
                        if last.elapsed() > Duration::from_millis(300) {
                            let stream = recognizer.create_stream();
                            stream.accept_waveform(sample_rate, &buffer);
                            recognizer.decode(&stream);
                            if let Some(result) = stream.get_result() {
                                let text = result.text.trim().to_string();
                                if !text.is_empty() {
                                    let _ = app.emit(
                                        "asr://partial",
                                        serde_json::json!({ "text": text, "isFinal": false }),
                                    );
                                }
                            }
                            last_interim_time = Some(Instant::now());
                        }
                    }
                }

                // 处理 VAD 完成的语音段（final 结果）
                while !vad.is_empty() {
                    if let Some(segment) = vad.front() {
                        vad.pop();
                        let segment_samples = segment.samples();
                        if !segment_samples.is_empty() {
                            let stream = recognizer.create_stream();
                            stream.accept_waveform(sample_rate, segment_samples);
                            recognizer.decode(&stream);
                            if let Some(result) = stream.get_result() {
                                let text = result.text.trim().to_string();
                                if !text.is_empty() {
                                    println!("[voice] Final: {text}");
                                    let _ = app.emit(
                                        "asr://final",
                                        serde_json::json!({ "text": text }),
                                    );
                                }
                            }
                        }
                    }
                    // 段处理完成后重置 buffer
                    buffer.clear();
                    offset = 0;
                    speech_started = false;
                    last_interim_time = None;
                }
            }
            Ok(AudioMessage::Stop) => {
                println!("[voice] Stop signal received, flushing remaining audio");

                // Flush 剩余 buffer
                if !buffer.is_empty() && speech_started {
                    let stream = recognizer.create_stream();
                    stream.accept_waveform(sample_rate, &buffer);
                    recognizer.decode(&stream);
                    if let Some(result) = stream.get_result() {
                        let text = result.text.trim().to_string();
                        if !text.is_empty() {
                            println!("[voice] Final (flush): {text}");
                            let _ = app.emit(
                                "asr://final",
                                serde_json::json!({ "text": text }),
                            );
                        }
                    }
                }

                // 处理 VAD 中残留的段
                while !vad.is_empty() {
                    if let Some(segment) = vad.front() {
                        vad.pop();
                        let segment_samples = segment.samples();
                        if !segment_samples.is_empty() {
                            let stream = recognizer.create_stream();
                            stream.accept_waveform(sample_rate, segment_samples);
                            recognizer.decode(&stream);
                            if let Some(result) = stream.get_result() {
                                let text = result.text.trim().to_string();
                                if !text.is_empty() {
                                    let _ = app.emit(
                                        "asr://final",
                                        serde_json::json!({ "text": text }),
                                    );
                                }
                            }
                        }
                    }
                }

                break;
            }
            Err(_) => {
                // Channel closed
                println!("[voice] Channel closed, exiting");
                break;
            }
        }
    }

    println!("[voice] Processing thread exited");
}

/// Windows ARM64 stub：sherpa-onnx 不提供该平台预编译库
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn audio_processing_thread(
    app: AppHandle,
    receiver: Receiver<AudioMessage>,
    _model_dir: PathBuf,
    _model_def: &'static ModelDef,
) {
    eprintln!("[voice] Voice recognition is not supported on this platform (Windows ARM64)");
    let _ = app.emit("asr://error", serde_json::json!({
        "error": "Voice recognition is not supported on Windows ARM64"
    }));
    // Drain messages until Stop
    while let Ok(msg) = receiver.recv() {
        if matches!(msg, AudioMessage::Stop) {
            break;
        }
    }
}

/// 开始语音识别会话
#[command]
pub fn asr_start(app: AppHandle, state: State<'_, VoiceState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();

    // 如果已有会话在运行，先停止
    if let Some(ref session) = *guard {
        let _ = session.sender.send(AudioMessage::Stop);
    }
    *guard = None;

    // 检查模型是否就绪
    let model_dir = get_model_dir(&app)?;
    let config = read_config(&app);
    let model_def = get_model_def(&config.active_model_id)
        .ok_or_else(|| format!("Unknown model: {}", config.active_model_id))?;
    if !check_model_files(&model_dir, model_def) {
        return Err("Model not downloaded. Please call asr_ensure_model first.".to_string());
    }

    // 创建 channel 和后台处理线程
    let (sender, receiver) = mpsc::channel::<AudioMessage>();
    let app_clone = app.clone();
    let model_dir_clone = model_dir.clone();

    std::thread::spawn(move || {
        audio_processing_thread(app_clone, receiver, model_dir_clone, model_def);
    });

    *guard = Some(VoiceSession { sender });

    let _ = app.emit("asr://status", serde_json::json!({ "state": "listening" }));
    println!("[voice] Session started");
    Ok(())
}

/// 喂入一块 PCM 音频数据
///
/// samples: 小端 f32 字节序列（前端通过 AudioWorklet 采集并重采样到 16kHz）
#[command]
pub fn asr_feed_chunk(
    state: State<'_, VoiceState>,
    samples: Vec<u8>,
) -> Result<(), String> {
    let guard = state.inner.lock().unwrap();
    let session = guard
        .as_ref()
        .ok_or_else(|| "No active voice session".to_string())?;

    // bytes → f32 (little-endian)
    let f32_samples: Vec<f32> = samples
        .chunks_exact(4)
        .map(|chunk| {
            let arr: [u8; 4] = [chunk[0], chunk[1], chunk[2], chunk[3]];
            f32::from_le_bytes(arr)
        })
        .collect();

    session
        .sender
        .send(AudioMessage::Samples(f32_samples))
        .map_err(|_| "Failed to send audio data (processing thread may have exited)".to_string())?;

    Ok(())
}

/// 停止语音识别会话
#[command]
pub fn asr_stop(app: AppHandle, state: State<'_, VoiceState>) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap();

    if let Some(session) = guard.take() {
        let _ = session.sender.send(AudioMessage::Stop);
    }

    let _ = app.emit("asr://status", serde_json::json!({ "state": "idle" }));
    println!("[voice] Session stopped");
    Ok(())
}

// ============================================================
// 多模型管理命令
// ============================================================

/// 模型列表项（含下载状态）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    name: String,
    description: String,
    languages: String,
    model_type: String,
    downloaded: bool,
    files: Vec<FileInfo>,
}

/// 镜像源信息
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorInfo {
    id: String,
    name: String,
}

/// 文件信息
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    filename: String,
    approx_size: u64,
}

/// 模型列表 + 镜像源 + 当前配置
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResult {
    models: Vec<ModelInfo>,
    mirrors: Vec<MirrorInfo>,
    active_model_id: String,
    mirror_id: String,
}

/// 列出所有可用模型和镜像源
#[command]
pub fn asr_list_models(app: AppHandle) -> Result<ModelListResult, String> {
    let model_dir = get_model_dir(&app).unwrap_or_else(|_| PathBuf::from(""));
    let config = read_config(&app);

    let models: Vec<ModelInfo> = MODELS.iter().map(|m| {
        let downloaded = check_model_files(&model_dir, m);
        ModelInfo {
            id: m.id.to_string(),
            name: m.name.to_string(),
            description: m.description.to_string(),
            languages: m.languages.to_string(),
            model_type: m.model_type.to_string(),
            downloaded,
            files: m.files.iter().map(|f| FileInfo {
                filename: f.filename.to_string(),
                approx_size: f.approx_size,
            }).collect(),
        }
    }).collect();

    let mirrors: Vec<MirrorInfo> = MIRRORS.iter().map(|m| MirrorInfo {
        id: m.id.to_string(),
        name: m.name.to_string(),
    }).collect();

    Ok(ModelListResult {
        models,
        mirrors,
        active_model_id: config.active_model_id,
        mirror_id: config.mirror_id,
    })
}

/// 获取当前语音配置
#[command]
pub fn asr_get_config(app: AppHandle) -> Result<VoiceConfig, String> {
    Ok(read_config(&app))
}

/// 设置语音配置（切换模型 / 镜像源）
#[command]
pub fn asr_set_config(
    app: AppHandle,
    active_model_id: Option<String>,
    mirror_id: Option<String>,
) -> Result<VoiceConfig, String> {
    let mut config = read_config(&app);

    if let Some(ref model_id) = active_model_id {
        if get_model_def(model_id).is_none() {
            return Err(format!("Unknown model: {model_id}"));
        }
        config.active_model_id = model_id.clone();
    }

    if let Some(ref mid) = mirror_id {
        if get_mirror(mid).is_none() {
            return Err(format!("Unknown mirror: {mid}"));
        }
        config.mirror_id = mid.clone();
    }

    write_config(&app, &config)?;
    Ok(config)
}
