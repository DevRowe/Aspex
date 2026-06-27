#[cfg(not(debug_assertions))]
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    thread,
    time::{Duration, Instant},
};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

const DEFAULT_HUB_PORT: u16 = 4317;
#[cfg(not(debug_assertions))]
const HUB_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Default)]
struct HubSidecarState {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<u16>,
}

#[tauri::command]
fn hub_url(state: tauri::State<'_, HubSidecarState>) -> Result<String, String> {
    let port = state
        .port
        .lock()
        .map_err(|_| "Hub sidecar state is unavailable".to_string())?;

    Ok(format!("http://127.0.0.1:{port}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(HubSidecarState {
            child: Mutex::new(None),
            port: Mutex::new(configured_hub_port()),
        })
        .invoke_handler(tauri::generate_handler![hub_url])
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            start_hub_sidecar(_app.handle())?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Aspex desktop shell")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_hub_sidecar(app_handle),
            _ => {}
        });
}

#[cfg(not(debug_assertions))]
fn start_hub_sidecar(app: &tauri::AppHandle) -> tauri::Result<()> {
    let state = app.state::<HubSidecarState>();
    let port = *state
        .port
        .lock()
        .map_err(|_| tauri::Error::Anyhow(anyhow::anyhow!("Hub sidecar state is unavailable")))?;
    let port_string = port.to_string();
    let command = app
        .shell()
        .sidecar("aspex-hub")
        .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?
        .args(["hub"])
        .env("ASPEX_HUB_PORT", &port_string);
    let (mut events, child) = command
        .spawn()
        .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;

    {
        let mut stored_child = state
            .child
            .lock()
            .map_err(|_| tauri::Error::Anyhow(anyhow::anyhow!("Hub sidecar state is unavailable")))?;
        *stored_child = Some(child);
    }

    thread::spawn(move || {
        tauri::async_runtime::block_on(async move {
            while let Some(event) = events.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Error(message) => {
                        eprintln!("Aspex Hub sidecar error: {message}");
                    }
                    tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                        eprintln!(
                            "Aspex Hub sidecar exited with code {:?} and signal {:?}",
                            payload.code, payload.signal
                        );
                    }
                    _ => {}
                }
            }
        });
    });

    wait_for_hub(port).map_err(|message| {
        stop_hub_sidecar(app);
        tauri::Error::Anyhow(anyhow::anyhow!(message))
    })
}

fn stop_hub_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<HubSidecarState>();

    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            if let Err(error) = child.kill() {
                eprintln!("Failed to stop Aspex Hub sidecar: {error}");
            }
        }
    };
}

#[cfg(not(debug_assertions))]
fn wait_for_hub(port: u16) -> Result<(), String> {
    let started_at = Instant::now();

    while started_at.elapsed() < HUB_STARTUP_TIMEOUT {
        if health_check(port) {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(200));
    }

    Err(format!(
        "Aspex Hub did not become healthy on http://127.0.0.1:{port}/health"
    ))
}

#[cfg(not(debug_assertions))]
fn health_check(port: u16) -> bool {
    let addr = match ("127.0.0.1", port).to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(addr) => addr,
            None => return false,
        },
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";

    if stream.write_all(request).is_err() {
        return false;
    }

    let mut response = [0_u8; 64];
    match stream.read(&mut response) {
        Ok(read) => response[..read].starts_with(b"HTTP/1.1 200")
            || response[..read].starts_with(b"HTTP/1.0 200"),
        Err(_) => false,
    }
}

fn configured_hub_port() -> u16 {
    std::env::var("ASPEX_HUB_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_HUB_PORT)
}
