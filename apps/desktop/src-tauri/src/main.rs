#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use sha2::{Digest, Sha256};
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

/// 本地服务端口号。主窗口要等健康检查通过才创建，所以窗口创建前它必须已确定。
static SERVER_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();

/// 后端 sidecar 进程句柄。
struct BackendState(Mutex<Option<CommandChild>>);

/// 设备指纹：系统硬件 ID（用应用密钥保护哈希）优先，失败时退回 hostname+USER 的 sha256。
///
/// 同一应用内必须稳定不变：改了等于把所有已激活用户踢下线，禁止在版本迭代中变更。
fn device_id() -> String {
    let mut builder = machineid_rs::IdBuilder::new(machineid_rs::Encryption::SHA256);
    builder.add_component(machineid_rs::HWIDComponent::SystemID);
    if let Ok(id) = builder.build("land-a-job-desktop") {
        if !id.is_empty() {
            return id;
        }
    }
    let host = sys_info::hostname().unwrap_or_else(|_| "unknown".into());
    let user = std::env::var("USER").unwrap_or_else(|_| "unknown".into());
    let mut hasher = Sha256::new();
    hasher.update(format!("land-a-job-desktop:{host}:{user}").as_bytes());
    hex::encode(hasher.finalize())
}

fn device_name() -> String {
    sys_info::hostname().unwrap_or_else(|_| "unknown-device".into())
}

fn save_license(app: &AppHandle, key: &str) -> Result<(), String> {
    let store = app.store("license.dat").map_err(|e| e.to_string())?;
    store.set("license_key", serde_json::json!(key));
    store.set("activated", serde_json::json!(true));
    store.save().map_err(|e| e.to_string())
}

fn load_license(app: &AppHandle) -> Option<(String, bool)> {
    let store = app.store("license.dat").ok()?;
    let key = store.get("license_key")?.as_str()?.to_string();
    let activated = store
        .get("activated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Some((key, activated))
}

fn clear_license(app: &AppHandle) -> Result<(), String> {
    let store = app.store("license.dat").map_err(|e| e.to_string())?;
    store.delete("license_key");
    store.delete("activated");
    store.save().map_err(|e| e.to_string())
}

/// 读取本地已保存的授权信息。
#[tauri::command]
fn get_saved_license(app: AppHandle) -> serde_json::Value {
    match load_license(&app) {
        Some((key, activated)) => serde_json::json!({"key": key, "activated": activated}),
        None => serde_json::json!({"key": null, "activated": false}),
    }
}

/// 续费购买页地址（商城商品页），供 UI「续费」按钮打开。
#[tauri::command]
fn get_renew_url() -> String {
    config::SHOP_PRODUCT_URL.to_string()
}

/// 解绑当前设备并清除本地授权记录（更换授权码/换机时用）。
#[tauri::command]
async fn deactivate_license(app: AppHandle) -> Result<serde_json::Value, String> {
    let (key, _) = load_license(&app).ok_or("本地没有授权记录")?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{}/license/deactivate",
            config::SHOP_API_BASE_URL
        ))
        .json(&serde_json::json!({
            "key": key,
            "deviceId": device_id(),
        }))
        .send()
        .await
        .map_err(|e| format!("无法连接授权服务器：{e}"))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    if status.is_success() && body.get("success").and_then(|v| v.as_bool()) == Some(true) {
        clear_license(&app)?;
        Ok(serde_json::json!({"ok": true}))
    } else {
        let msg = body
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("解绑失败，请稍后重试");
        Err(format!("{msg}（HTTP {status}）"))
    }
}

/// 激活授权码：商城首次 verify 即绑定设备，成功则把 license_key 写入本地 store。
#[tauri::command]
async fn activate_license(app: AppHandle, key: String) -> Result<serde_json::Value, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("请输入授权码".into());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/license/verify", config::SHOP_API_BASE_URL))
        .json(&serde_json::json!({
            "key": key,
            "deviceId": device_id(),
            "deviceName": device_name(),
        }))
        .send()
        .await
        .map_err(|e| format!("无法连接授权服务器：{e}"))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    if status.is_success() && body.get("valid").and_then(|v| v.as_bool()) == Some(true) {
        save_license(&app, &key)?;
        Ok(serde_json::json!({"ok": true}))
    } else {
        let msg = body
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("激活失败，请检查授权码是否正确");
        Err(format!("{msg}（HTTP {status}）"))
    }
}

/// 校验本地保存的授权码。
///
/// 返回 status：
/// - "none"    本地没有授权记录
/// - "ok"      服务端确认有效（附带 licenseType/expiresAt/daysRemaining）
/// - "expired" 授权已到期（附带 expiresAt）
/// - "invalid" 服务端明确判定无效（码不存在/已绑定其他设备等），回到授权页
/// - "error"   网络异常/服务端 5xx 无法完成校验。无离线宽限：必须联网校验通过才能使用
#[tauri::command]
async fn verify_license(app: AppHandle) -> serde_json::Value {
    let (key, _) = match load_license(&app) {
        Some(v) => v,
        None => return serde_json::json!({"status": "none"}),
    };
    let client = reqwest::Client::new();
    let resp = match client
        .post(format!("{}/license/verify", config::SHOP_API_BASE_URL))
        .json(&serde_json::json!({
            "key": key,
            "deviceId": device_id(),
            "deviceName": device_name(),
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return serde_json::json!({"status": "error"});
        }
    };
    if resp.status().is_server_error() {
        // 服务端故障：无法完成校验，按 error 处理（不放行）
        return serde_json::json!({"status": "error", "code": resp.status().as_u16()});
    }
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    if body.get("valid").and_then(|v| v.as_bool()) == Some(true) {
        serde_json::json!({
            "status": "ok",
            "licenseType": body.get("licenseType"),
            "expiresAt": body.get("expiresAt"),
            "daysRemaining": body.get("daysRemaining"),
        })
    } else if body.get("expired").and_then(|v| v.as_bool()) == Some(true) {
        serde_json::json!({
            "status": "expired",
            "expiresAt": body.get("expiresAt"),
            "message": body.get("message"),
        })
    } else {
        serde_json::json!({
            "status": "invalid",
            "message": body.get("message"),
        })
    }
}

/// resources/app 根目录：打包后读 resource_dir；开发模式（cargo/tauri dev 未打 bundle）
/// 回落到仓库 apps/desktop/resources/app（staging 产物）。
fn app_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bundled = resource_dir.join("app");
    if bundled.join("apps").join("server").join("dist").join("index.js").exists() {
        return Ok(bundled);
    }
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("app");
    if dev.join("apps").join("server").join("dist").join("index.js").exists() {
        return Ok(dev);
    }
    Ok(bundled)
}

/// 供「设置 → 数据和 Agent 连接」展示/复制：Agent 连桌面应用需要的本机路径。
#[tauri::command]
fn get_agent_setup_info(app: AppHandle) -> Result<serde_json::Value, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir = app_data.join("data");
    let app_root = app_root(&app)?;
    let port = SERVER_PORT.get().copied().unwrap_or(4399);

    // sidecar（Node 运行时）在打包后的位置因平台而异：macOS 在 Resources 下，
    // Windows 在安装根目录（与主 exe 同层）。逐个探测，返回真实存在的那个。
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let sidecar_name = format!("land-server{exe_suffix}");
    let mut candidates = vec![
        app_root.join(&sidecar_name),
        std::env::current_exe()
            .map(|p| p.parent().map(|d| d.join(&sidecar_name)).unwrap_or_default())
            .unwrap_or_default(),
    ];
    if cfg!(target_os = "macos") {
        // 开发模式：二进制文件名带 target triple
        candidates.push(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("land-server-{}{}", std::env::consts::ARCH, "-apple-darwin")),
        );
    }
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let server_bin = candidates
        .into_iter()
        .find(|p| !p.as_os_str().is_empty() && p.exists())
        .unwrap_or_else(|| resource_dir.join(&sidecar_name));

    Ok(serde_json::json!({
        "dataDir": data_dir,
        "skillsDir": app_root.join("skills"),
        "mcpEntry": app_root.join("apps").join("mcp").join("dist").join("index.js"),
        "serverBin": server_bin,
        "port": port,
    }))
}

/// 选一个可用端口：默认 4399（与 server 的 DEFAULT_PORT 一致），被占用则让系统分配。
fn pick_port() -> u16 {
    if TcpListener::bind(("127.0.0.1", 4399)).is_ok() {
        return 4399;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(4399)
}

/// 启动后端 sidecar（打包的 Node 运行时 + 服务端 dist），等待健康检查通过。
async fn start_backend(app: AppHandle) -> Result<u16, String> {
    if let Some(port) = SERVER_PORT.get() {
        return Ok(*port);
    }

    let port = pick_port();
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir = app_data.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let server_entry = app_root(&app)?
        .join("apps")
        .join("server")
        .join("dist")
        .join("index.js");

    let sidecar = app
        .shell()
        .sidecar("land-server")
        .map_err(|e| format!("找不到服务端程序：{e}"))?
        .args([server_entry.to_string_lossy().as_ref()])
        .env("LAND_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .env("LAND_PORT", port.to_string().as_str());
    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("启动服务端失败：{e}"))?;
    *app.state::<BackendState>().0.lock().map_err(|e| e.to_string())? = Some(child);

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    println!("[sidecar] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    println!("[sidecar] 已退出：{:?}", status.code);
                    break;
                }
                _ => {}
            }
        }
    });

    // 首次启动要建库跑迁移，给足 30 秒
    let client = reqwest::Client::new();
    for _ in 0..60 {
        if let Ok(resp) = client
            .get(format!("http://127.0.0.1:{port}/api/health"))
            .send()
            .await
        {
            if resp.status().is_success() {
                let _ = SERVER_PORT.set(port);
                return Ok(port);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err("本地服务启动超时，请重启应用".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 第二个实例：把已有窗口拉到前台
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(BackendState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_saved_license,
            activate_license,
            deactivate_license,
            verify_license,
            get_renew_url,
            get_agent_setup_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Ready = event {
                // v2 的 run 回调里 app 本身就是 &AppHandle
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let port = match start_backend(app_handle.clone()).await {
                        Ok(port) => port,
                        Err(e) => {
                            eprintln!("[backend] 启动失败：{e}");
                            4399
                        }
                    };
                    let url = format!("http://127.0.0.1:{port}");
                    match WebviewWindowBuilder::new(&app_handle, "main", WebviewUrl::External(url.parse().expect("invalid url")))
                        .title("Land a Job")
                        .inner_size(1280.0, 840.0)
                        .min_inner_size(960.0, 640.0)
                        .resizable(true)
                        .build()
                    {
                        Ok(_) => {}
                        Err(e) => eprintln!("[window] 创建失败：{e}"),
                    }
                });
            }
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<BackendState>();
                let child = match state.0.lock() {
                    Ok(mut guard) => guard.take(),
                    Err(_) => None,
                };
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        });
}
