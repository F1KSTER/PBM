#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_updater::Builder as UpdaterBuilder;

fn main() {
    tauri::Builder::default()
        .plugin(UpdaterBuilder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
