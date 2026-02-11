use tauri::Manager;
use std::process::Command;
use std::sync::Mutex;
use std::path::{Path, PathBuf};

struct BackendProcess(Mutex<Option<std::process::Child>>);

#[tauri::command]
fn notify_native(title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            esc(&body),
            esc(&title)
        );
        Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("notify-send")
            .args([&title, &body])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let ps = format!(
            "$t='{}';$b='{}';[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]>$null;$x=New-Object Windows.Data.Xml.Dom.XmlDocument;$x.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>\");$n=[Windows.UI.Notifications.ToastNotification]::new($x);[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('SEFS').Show($n);",
            title.replace('\'', "''"),
            body.replace('\'', "''")
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

fn spawn_backend(backend_path: &std::path::Path) -> Option<std::process::Child> {
    if !backend_path.exists() {
        log::warn!("Backend path does not exist: {:?}", backend_path);
        return None;
    }
    if !backend_path.join("app").join("main.py").exists() {
        log::warn!(
            "Backend path is missing app/main.py: {:?}",
            backend_path
        );
        return None;
    }

    // Try uv from PATH + common install locations.
    let uv_candidates = ["uv", "/opt/homebrew/bin/uv", "/usr/local/bin/uv", "/usr/bin/uv"];
    for uv_bin in uv_candidates {
        match Command::new(uv_bin)
            .args(["run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8484"])
            .current_dir(backend_path)
            .spawn()
        {
            Ok(child) => {
                log::info!("Backend started via {} (PID: {})", uv_bin, child.id());
                return Some(child);
            }
            Err(e) => {
                log::warn!("{} failed: {}", uv_bin, e);
            }
        }
    }

    // Fallback to python3 from PATH + common macOS locations.
    let py_candidates = ["python3", "/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
    for py_bin in py_candidates {
        match Command::new(py_bin)
            .args(["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8484"])
            .current_dir(backend_path)
            .spawn()
        {
            Ok(child) => {
                log::info!("Backend started via {} (PID: {})", py_bin, child.id());
                return Some(child);
            }
            Err(e) => {
                log::warn!("{} failed: {}", py_bin, e);
            }
        }
    }

    log::warn!("No uv/python3 launcher worked. Run backend manually.");
    None
}

fn is_backend_root(path: &Path) -> bool {
    path.join("app").join("main.py").exists()
}

fn resolve_dev_backend_path() -> PathBuf {
    // Most reliable in tauri dev: compile-time manifest dir is <repo>/frontend/src-tauri
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let from_manifest = manifest_dir
        .parent() // frontend
        .and_then(|p| p.parent()) // repo root
        .map(|p| p.join("backend"))
        .unwrap_or_else(|| manifest_dir.clone());
    if is_backend_root(&from_manifest) {
        return from_manifest;
    }

    // Fallbacks from runtime cwd
    let cwd = std::env::current_dir().unwrap_or_default();
    let candidates = [
        cwd.join("backend"),
        cwd.parent().map(|p| p.join("backend")).unwrap_or_default(),
        cwd.parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("backend"))
            .unwrap_or_default(),
    ];
    for c in candidates {
        if is_backend_root(&c) {
            return c;
        }
    }
    from_manifest
}

fn resolve_release_backend_path(resource_dir: &Path) -> PathBuf {
    let candidates = [
        resource_dir.join("backend"),
        resource_dir.to_path_buf(),
        resource_dir.join("resources").join("backend"),
    ];
    for c in candidates {
        if is_backend_root(&c) {
            return c;
        }
    }
    resource_dir.join("backend")
}

fn wait_for_backend_ready() {
    let url = "http://localhost:8484/api/status";
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap();

    for i in 0..30 {
        match client.get(url).send() {
            Ok(resp) if resp.status().is_success() => {
                log::info!("Backend ready after {}s", i);
                return;
            }
            _ => {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    }
    log::warn!("Backend did not become ready within 30s");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![notify_native])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn the Python backend server
            let resource_dir = app.path().resource_dir().unwrap_or_default();

            // In dev mode, use the project's backend directory
            let backend_path = if cfg!(debug_assertions) {
                resolve_dev_backend_path()
            } else {
                resolve_release_backend_path(&resource_dir)
            };

            log::info!("Starting backend from: {:?}", backend_path);

            let child = spawn_backend(&backend_path);
            let has_child = child.is_some();
            app.manage(BackendProcess(Mutex::new(child)));

            // Poll for backend readiness only if we launched a child.
            if has_child {
                std::thread::spawn(|| {
                    wait_for_backend_ready();
                });
            } else {
                log::warn!("Backend process was not started by Tauri.");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill backend when app closes
                if let Some(state) = window.try_state::<BackendProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.as_mut() {
                            log::info!("Shutting down backend server...");
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
