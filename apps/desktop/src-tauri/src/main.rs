#[cfg(not(debug_assertions))]
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    thread,
    time::{Duration, Instant},
};
use std::{
    env, fs,
    ffi::OsString,
    path::{Path, PathBuf},
};
use std::sync::Mutex;

use serde_json::{Map, Value};
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
    token: Mutex<Option<String>>,
}

#[tauri::command]
fn hub_url(state: tauri::State<'_, HubSidecarState>) -> Result<String, String> {
    let port = state
        .port
        .lock()
        .map_err(|_| "Hub sidecar state is unavailable".to_string())?;

    Ok(format!("http://127.0.0.1:{port}"))
}

#[tauri::command]
fn hub_token(state: tauri::State<'_, HubSidecarState>) -> Result<Option<String>, String> {
    state
        .token
        .lock()
        .map(|token| token.clone())
        .map_err(|_| "Hub sidecar state is unavailable".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(HubSidecarState {
            child: Mutex::new(None),
            port: Mutex::new(configured_hub_port()),
            token: Mutex::new(configured_hub_token()),
        })
        .invoke_handler(tauri::generate_handler![hub_url, hub_token])
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
    let token = state
        .token
        .lock()
        .map_err(|_| tauri::Error::Anyhow(anyhow::anyhow!("Hub sidecar state is unavailable")))?
        .clone()
        .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("Hub token is unavailable")))?;
    let command = app
        .shell()
        .sidecar("aspex-hub")
        .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?
        .args(["hub"])
        .env("ASPEX_HUB_PORT", &port_string)
        .env("ASPEX_HUB_TOKEN", &token);
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

    wait_for_hub(port, &token).map_err(|message| {
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
fn wait_for_hub(port: u16, token: &str) -> Result<(), String> {
    let started_at = Instant::now();

    while started_at.elapsed() < HUB_STARTUP_TIMEOUT {
        if health_check(port, token) {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(200));
    }

    Err(format!(
        "Aspex Hub did not become healthy on http://127.0.0.1:{port}/health"
    ))
}

#[cfg(not(debug_assertions))]
fn health_check(port: u16, token: &str) -> bool {
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
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );

    if stream.write_all(request.as_bytes()).is_err() {
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

fn configured_hub_token() -> Option<String> {
    let env_token = std::env::var("ASPEX_HUB_TOKEN").ok();

    #[cfg(not(debug_assertions))]
    {
        let path = default_hub_config_path().expect("failed to resolve Hub config path");
        return Some(resolve_hub_token(env_token.as_deref(), &path, generate_hub_token)
            .expect("failed to resolve Hub token"));
    }

    #[cfg(debug_assertions)]
    {
        if let Some(token) = trimmed_hub_token(env_token.as_deref()) {
            return Some(token);
        }

        default_hub_config_path()
            .and_then(|path| read_hub_token_from_config(&path).ok().flatten())
    }
}

fn trimmed_hub_token(token: Option<&str>) -> Option<String> {
    let trimmed = token?.trim();

    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}

fn generate_hub_token() -> String {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes).expect("failed to generate Hub token");

    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn default_hub_config_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".aspex").join("config.json"))
}

fn home_dir() -> Option<PathBuf> {
    home_dir_from_env(env::var_os, cfg!(windows))
}

fn home_dir_from_env<F>(mut var: F, windows: bool) -> Option<PathBuf>
where
    F: FnMut(&str) -> Option<OsString>,
{
    if windows {
        return var("USERPROFILE")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                let drive = var("HOMEDRIVE")?;
                let path = var("HOMEPATH")?;

                if drive.is_empty() || path.is_empty() {
                    return None;
                }

                let mut home = drive;
                home.push(path);
                Some(PathBuf::from(home))
            });
    }

    var("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_hub_token<F>(
    env_token: Option<&str>,
    path: &Path,
    generate: F,
) -> Result<String, String>
where
    F: FnOnce() -> String,
{
    if let Some(token) = trimmed_hub_token(env_token) {
        return Ok(token);
    }

    persisted_or_generated_hub_token_with(path, generate)
}

fn persisted_or_generated_hub_token_with<F>(path: &Path, generate: F) -> Result<String, String>
where
    F: FnOnce() -> String,
{
    if let Some(token) = read_hub_token_from_config(path)? {
        return Ok(token);
    }

    let token = generate();
    persist_hub_token(path, &token)?;

    Ok(token)
}

fn read_hub_token_from_config(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read Hub config {}: {error}", path.display()))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse Hub config {}: {error}", path.display()))?;
    let Some(auth) = parsed.get("auth") else {
        return Ok(None);
    };
    let Some(token) = auth.get("token").and_then(Value::as_str) else {
        return Ok(None);
    };
    let trimmed = token.trim();

    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(Some(trimmed.to_string()))
}

fn persist_hub_token(path: &Path, token: &str) -> Result<(), String> {
    let mut config = if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("failed to read Hub config {}: {error}", path.display()))?;
        match serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("failed to parse Hub config {}: {error}", path.display()))?
        {
            Value::Object(object) => object,
            _ => return Err("Hub config must contain a JSON object".to_string()),
        }
    } else {
        Map::new()
    };

    let mut auth = match config.remove("auth") {
        Some(Value::Object(object)) => object,
        _ => Map::new(),
    };
    auth.insert("token".to_string(), Value::String(token.to_string()));
    config.insert("auth".to_string(), Value::Object(auth));

    let parent = path
        .parent()
        .ok_or_else(|| format!("Hub config path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create Hub config directory: {error}"))?;
    set_secure_directory_permissions(parent)?;

    let serialized = serde_json::to_string_pretty(&Value::Object(config))
        .map_err(|error| format!("failed to serialize Hub config: {error}"))?;
    write_secure_config_file(path, &format!("{serialized}\n"))?;
    set_secure_file_permissions(path)?;

    Ok(())
}

#[cfg(unix)]
fn write_secure_config_file(path: &Path, content: &str) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    let parent = path
        .parent()
        .ok_or_else(|| format!("Hub config path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Hub config path has no file name: {}", path.display()))?
        .to_string_lossy();
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to create Hub config temp name: {error}"))?
        .as_nanos();
    let temp_path = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        unique
    ));

    let mut file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temp_path)
    {
        Ok(file) => file,
        Err(error) => {
            return Err(format!(
                "failed to write Hub config {}: {error}",
                path.display()
            ));
        }
    };

    if let Err(error) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "failed to write Hub config {}: {error}",
            path.display()
        ));
    }

    if let Err(error) = file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "failed to write Hub config {}: {error}",
            path.display()
        ));
    }

    drop(file);

    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "failed to write Hub config {}: {error}",
            path.display()
        ));
    }

    Ok(())
}

#[cfg(not(unix))]
fn write_secure_config_file(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content)
        .map_err(|error| format!("failed to write Hub config {}: {error}", path.display()))
}

#[cfg(unix)]
fn set_secure_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("failed to set Hub config directory permissions: {error}"))
}

#[cfg(not(unix))]
fn set_secure_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_secure_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to set Hub config permissions: {error}"))
}

#[cfg(not(unix))]
fn set_secure_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reads_existing_hub_token_from_config() {
        let dir = temp_dir("read");
        let path = dir.join("config.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            &path,
            r#"{"hubPort":5555,"auth":{"token":"stored-token"}}"#,
        )
        .unwrap();

        let token = read_hub_token_from_config(&path).unwrap();

        assert_eq!(token.as_deref(), Some("stored-token"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn env_hub_token_is_not_persisted_to_config() {
        let dir = temp_dir("env");
        let path = dir.join("config.json");

        let token = resolve_hub_token(Some(" env-token "), &path, || "generated-token".to_string())
            .unwrap();

        assert_eq!(token, "env-token");
        assert!(!path.exists());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn config_hub_token_is_reused_when_env_is_absent() {
        let dir = temp_dir("reuse");
        let path = dir.join("config.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            &path,
            r#"{"hubPort":5555,"auth":{"token":"stored-token"}}"#,
        )
        .unwrap();

        let token = resolve_hub_token(None, &path, || "generated-token".to_string()).unwrap();
        let config = fs::read_to_string(&path).unwrap();

        assert_eq!(token, "stored-token");
        assert!(config.contains(r#""token":"stored-token""#));
        assert!(!config.contains("generated-token"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn generated_hub_token_is_persisted_to_config() {
        let dir = temp_dir("generate");
        let path = dir.join("config.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, r#"{"hubPort":5555}"#).unwrap();

        let token =
            persisted_or_generated_hub_token_with(&path, || "generated-token".to_string())
                .unwrap();
        let config = fs::read_to_string(&path).unwrap();

        assert_eq!(token, "generated-token");
        assert!(config.contains(r#""hubPort": 5555"#));
        assert!(config.contains(r#""token": "generated-token""#));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn windows_home_dir_matches_node_home_precedence() {
        let vars = HashMap::from([
            ("HOME", OsString::from("/msys/home/user")),
            ("USERPROFILE", OsString::from("C:\\Users\\aspex")),
        ]);

        let home = home_dir_from_env(|key| vars.get(key).cloned(), true).unwrap();

        assert_eq!(home, PathBuf::from("C:\\Users\\aspex"));
    }

    #[test]
    fn unix_home_dir_uses_home() {
        let vars = HashMap::from([
            ("HOME", OsString::from("/home/aspex")),
            ("USERPROFILE", OsString::from("C:\\Users\\aspex")),
        ]);

        let home = home_dir_from_env(|key| vars.get(key).cloned(), false).unwrap();

        assert_eq!(home, PathBuf::from("/home/aspex"));
    }

    #[cfg(unix)]
    #[test]
    fn generated_hub_token_file_is_created_with_secure_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("secure");
        let path = dir.join(".aspex").join("config.json");

        persisted_or_generated_hub_token_with(&path, || "generated-token".to_string()).unwrap();

        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn generated_hub_token_replaces_permissive_config_securely() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("secure-existing");
        let path = dir.join(".aspex").join("config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"hubPort":5555}"#).unwrap();
        fs::set_permissions(path.parent().unwrap(), fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();

        let token =
            persisted_or_generated_hub_token_with(&path, || "generated-token".to_string())
                .unwrap();
        let config = fs::read_to_string(&path).unwrap();

        assert_eq!(token, "generated-token");
        assert!(config.contains(r#""hubPort": 5555"#));
        assert!(config.contains(r#""token": "generated-token""#));
        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(dir).unwrap();
    }

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("aspex-desktop-{name}-{unique}"))
    }
}
