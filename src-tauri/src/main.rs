#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;

mod lib;
use lib::{init_rules_engine, RulesEngine, MatchResult};

/// Rust 命令：检测关键词
#[tauri::command]
fn detect_keywords(
    text: &str,
    state: tauri::State<Mutex<RulesEngine>>,
) -> Result<Option<MatchResult>, String> {
    let mut engine = state.lock().map_err(|e| e.to_string())?;
    Ok(engine.detect(text))
}

/// Rust 命令：重置防抖动
#[tauri::command]
fn reset_debounce(state: tauri::State<Mutex<RulesEngine>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|e| e.to_string())?;
    engine.reset_debounce();
    Ok(())
}

fn main() {
    // 初始化日志
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    // 初始化规则引擎
    let rules_engine = match init_rules_engine() {
        Ok(engine) => {
            log::info!("Rules engine initialized successfully");
            engine
        }
        Err(e) => {
            log::error!("Failed to initialize rules engine: {}", e);
            // 使用空规则引擎继续运行
            let empty_json = r#"{"version":"1.0","description":"Empty","debounce_seconds":60,"rules":[]}"#;
            RulesEngine::from_json(empty_json)
                .expect("Failed to create empty engine")
        }
    };

    tauri::Builder::default()
        .manage(Mutex::new(rules_engine))
        .invoke_handler(tauri::generate_handler![
            detect_keywords,
            reset_debounce
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
