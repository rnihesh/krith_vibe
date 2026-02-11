use tauri::Manager;
use std::process::Command;
use std::sync::Mutex;

struct BackendProcess(Mutex<Option<std::process::Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            let backend_dir = app
                .path()
                .resource_dir()
                .unwrap_or_default()
                .join("backend");

            // In dev mode, use the project's backend directory
            let backend_path = if cfg!(debug_assertions) {
                std::env::current_dir()
                    .unwrap_or_default()
                    .parent()
                    .unwrap_or(&std::path::PathBuf::from("."))
                    .to_path_buf()
                    .join("backend")
            } else {
                backend_dir
            };

            log::info!("Starting backend from: {:?}", backend_path);

            let child = Command::new("uv")
                .args(["run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8484"])
                .current_dir(&backend_path)
                .spawn();

            match child {
                Ok(process) => {
                    log::info!("Backend server started (PID: {})", process.id());
                    app.manage(BackendProcess(Mutex::new(Some(process))));
                }
                Err(e) => {
                    log::warn!("Could not start backend: {}. Make sure it's running separately.", e);
                    app.manage(BackendProcess(Mutex::new(None)));
                }
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
